"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import BarcodeScanModal from "@/components/BarcodeScanModal";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import { useConfirm } from "@/components/ConfirmDialog";
import { ACTION_LABELS } from "@/lib/purchaseFlowLabels";
import { 处理到货明细, 确认到货单, 补录到货单信息, 添加采购外货品, 删除采购外货品 } from "@/app/arrivals/actions";
import { 撤销收货处理 } from "@/app/procurement/actions";

/* 2026-08-20 待收货改造二期：到货验货工作台（手机/电脑共用，响应式）
   逐件填实收数量+选仓位（手填/扫仓位码）+拍照，差异处理复用现有十种动作；
   全程不显示价格（规划决策3：手机端不做价格开关） */

export interface 到货单 {
  id: string;
  receipt_no: string;
  status: string;
  supplier_order_no: string | null;
  photos: string[] | null;
  suppliers: { name: string } | null;
  logistics_waybills: { tracking_no: string } | null;
}

export interface 到货明细 {
  id: string;
  purchase_order_item_id: string | null;
  /* 撤销要采购单 id，服务端查询时从 purchase_order_items 带出来 */
  order_id: string | null;
  part_name_snapshot: string;
  expected_qty: number;
  received_qty: number | null;
  handling: string | null;
  warehouse_id: string | null;
  location: string | null;
  photos: string[] | null;
}

interface 仓库 {
  id: string;
  name: string;
}

function 解决图片地址(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return path;
  return `${base}/storage/v1/object/public/work-order-media/${path}`;
}

/* ─── 逐件处理弹窗（必须定义在父组件外部） ─── */
function ArrivalHandleModal({
  明细,
  仓库列表,
  提交中,
  onClose,
  onSubmit,
}: {
  明细: 到货明细;
  仓库列表: 仓库[];
  提交中: boolean;
  onClose: () => void;
  onSubmit: (参数: {
    动作: string;
    数量: number;
    仓库id: string | null;
    仓位: string | null;
    照片: string[] | null;
    更新照片: boolean;
  }) => void;
}) {
  const supabase = createClient();
  const [数量, set数量] = useState(明细.expected_qty === 1 ? "1" : (明细.received_qty?.toString() ?? ""));
  const [问题, set问题] = useState<"" | "broken" | "wrong">("");
  const [破损选项, set破损选项] = useState<"" | "exchange" | "discard">("");
  const [错发选项, set错发选项] = useState<"" | "exchange" | "discard">("");
  const [多发选项, set多发选项] = useState<"" | "return" | "keep">("");
  const [多发付款, set多发付款] = useState<"" | "paid" | "free">("");
  const [少发选项, set少发选项] = useState<"" | "repurchase" | "discard">("");
  const [照片, set照片] = useState<string[]>(明细.photos || []);
  const [仓库id, set仓库id] = useState(明细.warehouse_id || "");
  const [仓位, set仓位] = useState(明细.location || "");
  const [仓位列表, set仓位列表] = useState<string[]>([]);
  const [扫码开, set扫码开] = useState(false);

  /* 选了仓库后拉出该仓库的仓位做候选（手填优先，扫码也可以） */
  useEffect(() => {
    async function 加载仓位() {
      if (!仓库id) {
        set仓位列表([]);
        return;
      }
      const { data } = await supabase
        .from("warehouse_locations")
        .select("name")
        .eq("warehouse_id", 仓库id)
        .order("name");
      set仓位列表(((data || []) as { name: string }[]).map((l) => l.name));
    }
    加载仓位();
  }, [仓库id, supabase]);

  /* 扫仓位码：二维码内容是 warehouse_locations 的 id，反查仓库+仓位名 */
  async function 扫码结果(码: string) {
    set扫码开(false);
    const { data } = await supabase
      .from("warehouse_locations")
      .select("id, name, warehouse_id")
      .eq("id", 码)
      .limit(1);
    if (data && data.length > 0) {
      const loc = data[0] as { id: string; name: string; warehouse_id: string };
      set仓库id(loc.warehouse_id);
      set仓位(loc.name);
    } else {
      /* 不是系统仓位码 → 当手填文本用 */
      set仓位(码);
    }
  }

  function 提交() {
    const qtyRaw = 数量.trim();
    if (!qtyRaw) {
      alert("请填写实际到货数量(没到货请填 0)");
      return;
    }
    const qty = parseInt(qtyRaw, 10);
    if (isNaN(qty) || qty < 0) {
      alert("到货数量必须 ≥ 0");
      return;
    }
    const ordered = 明细.expected_qty;
    const 仓位参数 = 仓位.trim() || null;
    const 仓库参数 = 仓库id || null;

    if (qty === ordered) {
      if (问题 === "broken") {
        if (!破损选项) { alert("请选择破损处理方式"); return; }
        onSubmit({
          动作: 破损选项 === "exchange" ? "broken_exchange" : "broken_discard",
          数量: qty, 仓库id: 仓库参数, 仓位: 仓位参数,
          照片: 照片.length > 0 ? 照片 : null, 更新照片: true,
        });
      } else if (问题 === "wrong") {
        if (!错发选项) { alert("请选择错发处理方式"); return; }
        onSubmit({
          动作: 错发选项 === "exchange" ? "wrong_exchange" : "wrong_discard",
          数量: 错发选项 === "exchange" ? qty : 0, 仓库id: 仓库参数, 仓位: 仓位参数,
          照片: null, 更新照片: false,
        });
      } else {
        onSubmit({ 动作: "normal", 数量: qty, 仓库id: 仓库参数, 仓位: 仓位参数, 照片: null, 更新照片: false });
      }
    } else if (qty > ordered) {
      if (!多发选项) { alert("请选择多发处理方式"); return; }
      if (多发选项 === "keep" && !多发付款) { alert("请选择是否对供应商付款"); return; }
      const 动作 = 多发选项 === "return" ? "excess_return" : 多发付款 === "paid" ? "excess_paid" : "excess_free";
      onSubmit({ 动作, 数量: qty, 仓库id: 仓库参数, 仓位: 仓位参数, 照片: null, 更新照片: false });
    } else {
      if (!少发选项) { alert("请选择少发处理方式"); return; }
      if (少发选项 === "discard" && 照片.length === 0) {
        if (!window.confirm("少发弃货建议上传聊天截图作为凭证,确定不上传吗?")) return;
      }
      onSubmit({
        动作: 少发选项 === "repurchase" ? "short_repurchase" : "short_discard",
        数量: qty, 仓库id: 仓库参数, 仓位: 仓位参数,
        照片: 照片.length > 0 ? 照片 : null, 更新照片: 少发选项 === "discard",
      });
    }
  }

  const 数量数 = 数量.trim() === "" ? null : parseInt(数量.trim(), 10);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-base font-semibold text-gray-900">验货</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-sm text-gray-700">
            配件:<span className="font-medium ml-1">{明细.part_name_snapshot}</span>
            <span className="text-xs text-gray-500 ml-2">应收 {明细.expected_qty}</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">实际到货数量</label>
            <input
              type="number"
              min={0}
              value={数量}
              onChange={(e) => set数量(e.target.value)}
              placeholder="没到货请填 0"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {数量数 !== null && !isNaN(数量数) && (
              <p className={`text-xs mt-1 ${数量数 === 明细.expected_qty ? "text-green-600" : 数量数 > 明细.expected_qty ? "text-blue-600" : "text-red-600"}`}>
                {数量数 === 明细.expected_qty
                  ? "数量正常,可直接确认"
                  : 数量数 > 明细.expected_qty
                    ? `多发 ${数量数 - 明细.expected_qty} 件,请在下方选择处理方式`
                    : `少发 ${明细.expected_qty - 数量数} 件,请在下方选择处理方式`}
              </p>
            )}
          </div>

          {/* 仓位：手填或扫仓位二维码（规划决策4） */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">仓库</label>
              <select
                value={仓库id}
                onChange={(e) => set仓库id(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">暂不指定</option>
                {仓库列表.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">仓位</label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={仓位}
                  onChange={(e) => set仓位(e.target.value)}
                  placeholder="手填或扫码"
                  list="arrival-location-options"
                  className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <datalist id="arrival-location-options">
                  {仓位列表.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={() => set扫码开(true)}
                  title="扫仓位二维码"
                  className="shrink-0 w-10 rounded-lg border border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 flex items-center justify-center"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7V5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2m4-9h2m4 0h2m-8 4h2m4 0h2m-8 4h8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* 数量正常 → 破损/错发反馈 */}
          {数量数 !== null && !isNaN(数量数) && 数量数 === 明细.expected_qty && (
            <div className="border-t border-gray-100 pt-3">
              <div className="text-xs text-gray-500 mb-2">反馈问题(可选,二选一)</div>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer flex-1 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <input type="radio" name="arrivalProblem" checked={问题 === "broken"} onChange={() => set问题(问题 === "broken" ? "" : "broken")} />
                  <span className="text-sm text-gray-900">配件破损</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer flex-1 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <input type="radio" name="arrivalProblem" checked={问题 === "wrong"} onChange={() => set问题(问题 === "wrong" ? "" : "wrong")} />
                  <span className="text-sm text-gray-900">配件错发</span>
                </label>
              </div>

              {问题 === "broken" && (
                <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                  <div className="text-xs text-gray-500 mb-1">请选择破损处理方式</div>
                  <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                    <input type="radio" name="arrivalBroken" checked={破损选项 === "exchange"} onChange={() => set破损选项("exchange")} className="mt-0.5" />
                    <div className="text-sm">
                      <div className="font-medium text-gray-900">换货(破损补发)</div>
                      <div className="text-gray-500 text-xs mt-0.5">正常入库 + 生成「破损退货」 + 自动加一条「破损补发」待采购</div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                    <input type="radio" name="arrivalBroken" checked={破损选项 === "discard"} onChange={() => set破损选项("discard")} className="mt-0.5" />
                    <div className="text-sm">
                      <div className="font-medium text-gray-900">不需要了</div>
                      <div className="text-gray-500 text-xs mt-0.5">先入库 + 生成「破损退货」(不补货)</div>
                    </div>
                  </label>
                </div>
              )}

              {问题 === "wrong" && (
                <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                  <div className="text-xs text-gray-500 mb-1">请选择错发处理方式</div>
                  <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                    <input type="radio" name="arrivalWrong" checked={错发选项 === "exchange"} onChange={() => set错发选项("exchange")} className="mt-0.5" />
                    <div className="text-sm">
                      <div className="font-medium text-gray-900">换货</div>
                      <div className="text-gray-500 text-xs mt-0.5">先入库 + 生成「错发退货」 + 自动加一条「错发换货」待采购</div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                    <input type="radio" name="arrivalWrong" checked={错发选项 === "discard"} onChange={() => set错发选项("discard")} className="mt-0.5" />
                    <div className="text-sm">
                      <div className="font-medium text-gray-900">不需要了</div>
                      <div className="text-gray-500 text-xs mt-0.5">直接生成「错发退货」,不入库</div>
                    </div>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* 多发 */}
          {数量数 !== null && !isNaN(数量数) && 数量数 > 明细.expected_qty && (
            <div className="border-t border-gray-100 pt-3">
              <div className="text-xs text-blue-600 font-medium mb-2">多发处理 — 应收 {明细.expected_qty},实际到货 {数量数}</div>
              <div className="space-y-2">
                <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input type="radio" name="arrivalExcess" checked={多发选项 === "return"} onChange={() => set多发选项("return")} className="mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">多出退货</div>
                    <div className="text-gray-500 text-xs mt-0.5">按应收数入库,多出部分生成「多发退货」</div>
                  </div>
                </label>
                <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input type="radio" name="arrivalExcess" checked={多发选项 === "keep"} onChange={() => set多发选项("keep")} className="mt-0.5" />
                  <div className="text-sm flex-1">
                    <div className="font-medium text-gray-900">入库留作备用</div>
                    <div className="text-gray-500 text-xs mt-0.5">全部入库,多出部分按「多发备用」处理</div>
                    {多发选项 === "keep" && (
                      <div className="mt-2 space-y-2">
                        <label className="flex items-center gap-2 text-xs">
                          <input type="radio" name="arrivalExcessPaid" checked={多发付款 === "paid"} onChange={() => set多发付款("paid")} />
                          对供应商付款(按原单价计入应付款)
                        </label>
                        <label className="flex items-center gap-2 text-xs">
                          <input type="radio" name="arrivalExcessPaid" checked={多发付款 === "free"} onChange={() => set多发付款("free")} />
                          不付款(零价入库,作赠品)
                        </label>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* 少发 */}
          {数量数 !== null && !isNaN(数量数) && 数量数 < 明细.expected_qty && (
            <div className="border-t border-gray-100 pt-3">
              <div className="text-xs text-red-600 font-medium mb-2">少发处理 — 应收 {明细.expected_qty},实际到货 {数量数}</div>
              <div className="space-y-2">
                <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input type="radio" name="arrivalShort" checked={少发选项 === "repurchase"} onChange={() => set少发选项("repurchase")} className="mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">{数量数 === 0 ? "重新采购" : "少发补货"}</div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      {数量数 === 0
                        ? "未入库,按原应收数自动生成「少发补货」待采购"
                        : "按实际到货数入库,差额自动生成「少发补货」待采购"}
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input type="radio" name="arrivalShort" checked={少发选项 === "discard"} onChange={() => set少发选项("discard")} className="mt-0.5" />
                  <div className="text-sm flex-1">
                    <div className="font-medium text-gray-900">不需要了</div>
                    <div className="text-gray-500 text-xs mt-0.5">按实际数量入库,建议附上聊天记录截图作为凭证</div>
                    {少发选项 === "discard" && (
                      <div className="mt-2">
                        <label className="block text-xs text-gray-600 mb-1">聊天记录截图</label>
                        <ImageUploader
                          onUpload={set照片}
                          existingImages={照片}
                          maxImages={5}
                          bucket="work-order-media"
                          folder="purchase-evidence"
                        />
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* 货物照片（破损取证等，任何分支都可拍） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">货物照片</label>
            <ImageUploader
              onUpload={set照片}
              existingImages={照片}
              maxImages={5}
              bucket="work-order-media"
              folder="arrival-items"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button
            type="button"
            onClick={提交}
            disabled={提交中}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {提交中 ? "处理中..." : "确认"}
          </button>
        </div>
      </div>

      <BarcodeScanModal open={扫码开} onClose={() => set扫码开(false)} onScan={扫码结果} />
    </div>
  );
}

/* ─── 补录采购单外货品弹窗（错发/多发了采购单上没有的货） ─── */
const 外货品处理方式 = [
  { code: "wrong_discard", 名称: "错发退回", 说明: "发错的货，现场退回供应商，不入库" },
  { code: "excess_return", 名称: "多发退回", 说明: "多给的货，退回供应商，不入库" },
  { code: "excess_paid", 名称: "折价留下", 说明: "留下入库，按配件最近采购价计入应付款" },
  { code: "excess_free", 名称: "免费留下", 说明: "留下入库，零价作赠品" },
];

function ExtraItemModal({
  仓库列表,
  提交中,
  onClose,
  onSubmit,
}: {
  仓库列表: 仓库[];
  提交中: boolean;
  onClose: () => void;
  onSubmit: (参数: {
    名称: string;
    配件id: string | null;
    数量: number;
    处理方式: string;
    仓库id: string | null;
    仓位: string | null;
    照片: string[] | null;
  }) => void;
}) {
  const [名称, set名称] = useState("");
  const [配件id, set配件id] = useState<string | null>(null);
  const [配件编码, set配件编码] = useState("");
  const [数量, set数量] = useState("");
  const [处理方式, set处理方式] = useState("");
  const [仓库id, set仓库id] = useState("");
  const [仓位, set仓位] = useState("");
  const [照片, set照片] = useState<string[]>([]);

  const 是留下 = 处理方式 === "excess_paid" || 处理方式 === "excess_free";

  function 提交() {
    if (!名称.trim()) {
      alert("请填写货品名称");
      return;
    }
    const qty = parseInt(数量, 10);
    if (!数量.trim() || isNaN(qty) || qty <= 0) {
      alert("数量必须是大于 0 的整数");
      return;
    }
    if (!处理方式) {
      alert("请选择处理方式");
      return;
    }
    if (是留下 && !配件id) {
      alert("留下的货品要入库，必须关联配件档案（编码搜索选择）");
      return;
    }
    onSubmit({
      名称: 名称.trim(),
      配件id,
      数量: qty,
      处理方式,
      仓库id: 仓库id || null,
      仓位: 仓位.trim() || null,
      照片: 照片.length > 0 ? 照片 : null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-base font-semibold text-gray-900">补录采购单外货品</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500">供应商错发/多发了采购单上没有的货，在这里补一条记录。</p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关联配件档案（留下入库时必选）</label>
            <PartSearchDropdown
              value={配件编码}
              onChange={set配件编码}
              onSelect={(part) => {
                set配件id(part.id);
                set配件编码(part.part_number || "");
                set名称(part.part_names?.name || part.name || "");
              }}
              onCreateNew={() => alert("请先到「配件库存」新建配件档案，再回来选择")}
              onClear={() => { set配件id(null); set配件编码(""); }}
              placeholder="编码/条码搜索"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">货品名称 *</label>
            <input
              type="text"
              value={名称}
              onChange={(e) => set名称(e.target.value)}
              placeholder="选了配件会自动带入，也可手填"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">数量 *</label>
              <input
                type="number"
                min={1}
                value={数量}
                onChange={(e) => set数量(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">仓库</label>
              <select
                value={仓库id}
                onChange={(e) => set仓库id(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">暂不指定</option>
                {仓库列表.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">仓位</label>
              <input
                type="text"
                value={仓位}
                onChange={(e) => set仓位(e.target.value)}
                placeholder="手填"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">处理方式 *</label>
            <div className="space-y-2">
              {外货品处理方式.map((opt) => (
                <label key={opt.code} className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="extraHandling"
                    checked={处理方式 === opt.code}
                    onChange={() => set处理方式(opt.code)}
                    className="mt-0.5"
                  />
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">{opt.名称}</div>
                    <div className="text-gray-500 text-xs mt-0.5">{opt.说明}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">货物照片</label>
            <ImageUploader
              onUpload={set照片}
              existingImages={照片}
              maxImages={5}
              bucket="work-order-media"
              folder="arrival-items"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button
            type="button"
            onClick={提交}
            disabled={提交中}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {提交中 ? "保存中..." : "补录"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── 工作台主组件 ─── */
const 状态徽章: Record<string, { 文字: string; 样式: string }> = {
  receiving: { 文字: "验货中", 样式: "bg-orange-100 text-orange-700" },
  confirmed: { 文字: "已确认到货", 样式: "bg-green-100 text-green-700" },
  inbounded: { 文字: "已入库", 样式: "bg-gray-100 text-gray-600" },
};

export function ArrivalWorkbench({
  到货单,
  明细列表,
  仓库列表,
  待入库链接,
}: {
  到货单: 到货单;
  明细列表: 到货明细[];
  仓库列表: 仓库[];
  待入库链接: string;
}) {
  const router = useRouter();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [提交中, set提交中] = useState<string | null>(null);
  const [处理中明细, set处理中明细] = useState<到货明细 | null>(null);
  const [补录开, set补录开] = useState(false);

  /* 供应商销售单号/截图后补（规划决策1） */
  const [补录模式, set补录模式] = useState(false);
  const [补录单号, set补录单号] = useState(到货单.supplier_order_no || "");
  const [补录照片, set补录照片] = useState<string[]>(到货单.photos || []);

  const 验货中 = 到货单.status === "receiving";
  const 已处理数 = useMemo(() => 明细列表.filter((i) => i.handling && i.handling !== "skipped").length, [明细列表]);
  const 未处理数 = 明细列表.length - 已处理数;

  async function 提交处理(参数: { 动作: string; 数量: number; 仓库id: string | null; 仓位: string | null; 照片: string[] | null; 更新照片: boolean }) {
    if (!处理中明细) return;
    set提交中(`item-${处理中明细.id}`);
    try {
      const res = await 处理到货明细(
        处理中明细.id, 参数.动作, 参数.数量, 参数.仓库id, 参数.仓位, 参数.照片, 参数.更新照片
      );
      if (!res.success) throw new Error(res.error || "收货失败");
      set处理中明细(null);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("收货失败: " + msg);
    } finally {
      set提交中(null);
    }
  }

  async function 撤销(明细: 到货明细) {
    if (!明细.order_id || !明细.purchase_order_item_id) return;
    if (!(await 请求确认(`确认撤销「${明细.part_name_snapshot}」的收货处理?`))) return;
    set提交中(`revoke-${明细.id}`);
    try {
      const res = await 撤销收货处理(明细.order_id, 明细.purchase_order_item_id);
      if (!res.success) throw new Error(res.error || "撤销失败");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("撤销失败: " + msg);
    } finally {
      set提交中(null);
    }
  }

  async function 提交补录(参数: { 名称: string; 配件id: string | null; 数量: number; 处理方式: string; 仓库id: string | null; 仓位: string | null; 照片: string[] | null }) {
    set提交中("extra");
    try {
      const res = await 添加采购外货品(
        到货单.id, 参数.名称, 参数.配件id, 参数.数量, 参数.处理方式, 参数.仓库id, 参数.仓位, 参数.照片
      );
      if (!res.success) throw new Error(res.error || "补录失败");
      set补录开(false);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("补录失败: " + msg);
    } finally {
      set提交中(null);
    }
  }

  async function 删除外行(明细: 到货明细) {
    if (!(await 请求确认(`确认删除补录的「${明细.part_name_snapshot}」？`))) return;
    set提交中(`del-${明细.id}`);
    try {
      const res = await 删除采购外货品(明细.id);
      if (!res.success) throw new Error(res.error || "删除失败");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("删除失败: " + msg);
    } finally {
      set提交中(null);
    }
  }

  async function 确认到货() {
    if (!(await 请求确认(
      未处理数 > 0
        ? `已处理 ${已处理数} 件，还有 ${未处理数} 件未处理（将作废，下次到货再收）。确认后库存立即上架、工单配件即可领料，是否确认到货？`
        : `共 ${已处理数} 件全部处理完。确认后库存立即上架、工单配件即可领料，是否确认到货？`
    ))) return;
    set提交中("confirm");
    try {
      const res = await 确认到货单(到货单.id);
      if (!res.success) throw new Error(res.error || "确认到货失败");
      alert(`到货单 ${res.receipt_no} 已确认，库存已上架`);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("确认到货失败: " + msg);
    } finally {
      set提交中(null);
    }
  }

  async function 保存补录() {
    set提交中("patch");
    try {
      const res = await 补录到货单信息(到货单.id, 补录单号.trim() || null, 补录照片.length > 0 ? 补录照片 : null);
      if (!res.success) throw new Error(res.error || "保存失败");
      set补录模式(false);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("保存失败: " + msg);
    } finally {
      set提交中(null);
    }
  }

  const 徽章 = 状态徽章[到货单.status] || { 文字: 到货单.status, 样式: "bg-gray-100 text-gray-600" };

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {/* 头部信息卡 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-gray-900">{到货单.receipt_no}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${徽章.样式}`}>{徽章.文字}</span>
        </div>
        <div className="text-sm text-gray-600">供应商：{到货单.suppliers?.name || "-"}</div>
        {到货单.logistics_waybills?.tracking_no && (
          <div className="text-sm text-gray-600">运单：{到货单.logistics_waybills.tracking_no}</div>
        )}
        <div className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
          <span>供应商销售单：{到货单.supplier_order_no || <span className="text-gray-400">未填</span>}</span>
          {到货单.status !== "inbounded" && !补录模式 && (
            <button type="button" onClick={() => set补录模式(true)} className="text-xs text-blue-600 hover:underline">
              {到货单.supplier_order_no ? "修改" : "补录单号/截图"}
            </button>
          )}
        </div>
        {到货单.photos && 到货单.photos.length > 0 && !补录模式 && (
          <div className="flex gap-2 flex-wrap">
            {到货单.photos.map((p, i) => (
              <a key={i} href={解决图片地址(p)} target="_blank" rel="noreferrer">
                <img src={解决图片地址(p)} alt="" loading="lazy" className="w-14 h-14 object-cover rounded border border-gray-100" />
              </a>
            ))}
          </div>
        )}
        {补录模式 && (
          <div className="border-t border-gray-100 pt-3 space-y-3">
            <input
              type="text"
              value={补录单号}
              onChange={(e) => set补录单号(e.target.value)}
              placeholder="供应商销售单号"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <ImageUploader onUpload={set补录照片} existingImages={补录照片} maxImages={5} bucket="work-order-media" folder="arrival-receipts" />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => set补录模式(false)} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg">取消</button>
              <button
                type="button"
                onClick={保存补录}
                disabled={提交中 === "patch"}
                className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
              >
                {提交中 === "patch" ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 明细列表 */}
      {明细列表.map((明细) => {
        const 动作 = 明细.handling && 明细.handling !== "skipped" ? ACTION_LABELS[明细.handling] : null;
        const 作废 = 明细.handling === "skipped";
        return (
          <div key={明细.id} className={`bg-white rounded-xl border border-gray-200 p-4 ${作废 ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{明细.part_name_snapshot}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  应收 {明细.expected_qty}
                  {明细.received_qty !== null && ` · 实收 ${明细.received_qty}`}
                  {明细.location && ` · 仓位 ${明细.location}`}
                  {!明细.purchase_order_item_id && " · 采购单外货品"}
                </div>
              </div>
              <div className="shrink-0">
                {作废 ? (
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">未处理作废</span>
                ) : 动作 ? (
                  <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${动作.color}`}>{动作.text}</span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">待验货</span>
                )}
              </div>
            </div>
            {明细.photos && 明细.photos.length > 0 && (
              <div className="flex gap-1 mt-2">
                {明细.photos.slice(0, 4).map((p, i) => (
                  <img key={i} src={解决图片地址(p)} alt="" loading="lazy" className="w-10 h-10 object-cover rounded border border-gray-100" />
                ))}
              </div>
            )}
            {验货中 && !作废 && (
              <div className="flex gap-2 mt-3">
                {动作 ? (
                  /* 已处理的行不给"修改"：直接调收货函数会重复克隆补货分支，
                     必须先撤销（复位到货明细+删补货分支）再重新验货；
                     采购单外货品没有采购行，走删除而非撤销 */
                  明细.purchase_order_item_id ? (
                    <button
                      type="button"
                      onClick={() => 撤销(明细)}
                      disabled={提交中 === `revoke-${明细.id}`}
                      className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                    >
                      {提交中 === `revoke-${明细.id}` ? "撤销中..." : "撤销"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => 删除外行(明细)}
                      disabled={提交中 === `del-${明细.id}`}
                      className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                    >
                      {提交中 === `del-${明细.id}` ? "删除中..." : "删除"}
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => set处理中明细(明细)}
                    className="px-4 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    验货
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 底部操作 */}
      {验货中 && (
        <div className="sticky bottom-0 py-3 bg-gray-50 space-y-2">
          <button
            type="button"
            onClick={() => set补录开(true)}
            className="w-full py-2.5 rounded-xl border border-dashed border-orange-300 text-orange-600 text-sm hover:bg-orange-50"
          >
            + 补录采购单外货品（错发/多发的货）
          </button>
          <button
            type="button"
            onClick={确认到货}
            disabled={已处理数 === 0 || 提交中 === "confirm"}
            className="w-full py-3 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {提交中 === "confirm" ? "确认中..." : `确认到货（已验 ${已处理数}/${明细列表.length} 件）`}
          </button>
          <p className="text-xs text-gray-400 text-center mt-1">确认后库存立即上架，工单配件即可领料</p>
        </div>
      )}
      {到货单.status === "confirmed" && (
        <a
          href={待入库链接}
          className="block w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-medium text-center hover:bg-blue-700"
        >
          去待入库办理入库（账务收尾）
        </a>
      )}

      {处理中明细 && (
        <ArrivalHandleModal
          明细={处理中明细}
          仓库列表={仓库列表}
          提交中={提交中 === `item-${处理中明细.id}`}
          onClose={() => set处理中明细(null)}
          onSubmit={提交处理}
        />
      )}
      {补录开 && (
        <ExtraItemModal
          仓库列表={仓库列表}
          提交中={提交中 === "extra"}
          onClose={() => set补录开(false)}
          onSubmit={提交补录}
        />
      )}
      {确认弹窗}
    </div>
  );
}
