"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import BarcodeScanModal from "@/components/BarcodeScanModal";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { ACTION_LABELS } from "@/lib/purchaseFlowLabels";
import { 撤销收货处理, 删除采购明细, 撤销作废采购单, 保存采购明细图片, 保存供应商销售单, 暂存收货, 撤销暂存收货, 提交暂存收货 } from "@/app/procurement/actions";
import { 关联运单到采购单, 关联运单到采购单或配件, 设置运单豁免 } from "@/app/logistics/actions";

/* 2026-08-21 手机端待收货管理（老流程采购单）：
   商品上下排列、收货按钮不用滑屏直接可见；
   顶部新建批量运单入口 + 选择/批量关联运单；
   手机端不显示价格（规划决策3） */

export interface 待收明细 {
  id: string;
  part_id: string | null;
  name: string;
  brand: string | null;
  specification: string | null;
  quantity: number;
  unit: string | null;
  notes: string | null;
  photos: string[] | null;
  part_number: string | null;
  supplier_part_name: string | null;
  handle_action: string | null;
  /* 配件级运单关联/豁免（2026-08-21） */
  waybill_id: string | null;
  waybill_exempt: boolean | null;
  /* 收货暂存（2026-09-04）：确认收货先暂存不入账，手动提交统一入账 */
  staged_qty: number | null;
  staged_action: string | null;
  staged_at: string | null;
}

export interface 待收订单 {
  id: string;
  order_no: string | null;
  status: string;
  created_at: string;
  /* 供应商 id（2026-09-04 跨单收货提交用） */
  supplier_id: string | null;
  waybill_id: string | null;
  /* 整单运单豁免（2026-08-21） */
  waybill_exempt: boolean | null;
  /* 供应商销售单（2026-08-21） */
  supplier_order_no: string | null;
  supplier_order_amount: number | null;
  supplier_slip_photos: string[] | null;
  suppliers: { name: string; region?: string | null } | null;
  logistics_waybills: { id: string; tracking_no: string; logistics_company_name: string | null; logistics_companies: { name: string } | null } | null;
  purchase_order_items: 待收明细[];
}

export interface 待签收运单 {
  id: string;
  tracking_no: string;
  supplier_name: string | null;
  logistics_company_name: string | null;
  logistics_companies: { name: string } | null;
}

function 解决图片地址(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return path;
  return `${base}/storage/v1/object/public/work-order-media/${path}`;
}

function 需要运单(单: 待收订单): boolean {
  const region = 单.suppliers?.region;
  return !!region && region !== "local";
}

/* 行级可收货口径（2026-08-21，与桌面端一致）：本地供应商直接可收；
   外阜单需 单头已关联运单/已豁免，或该配件行自己已关联/已豁免 */
function 行可收货(单: 待收订单, 明细: 待收明细): boolean {
  if (!需要运单(单)) return true;
  return !!(单.waybill_id || 单.waybill_exempt || 明细.waybill_id || 明细.waybill_exempt);
}

/* ─── 收货弹窗（竖排，十种差异处理与电脑端一致） ─── */
function ReceiveModal({
  明细,
  订单,
  提交中,
  外部数量,
  on请求扫码,
  onClose,
  onSubmit,
}: {
  明细: 待收明细;
  /* 订单（2026-08-21）：销售单录入读写采购单字段 */
  订单: 待收订单;
  提交中: boolean;
  /* 扫码收货：连续扫码时父组件传入递增的数量，弹窗跟着变 */
  外部数量?: number | null;
  /* 扫码收货：弹窗里点「继续扫码」重新打开扫码 */
  on请求扫码?: () => void;
  onClose: () => void;
  onSubmit: (参数: { 动作: string; 数量: number; 凭证: string[] | null; 更新凭证: boolean; 弃货删行?: boolean }) => void;
}) {
  const { showToast } = useToast();
  const { 请求确认, 确认弹窗 } = useConfirm();
  /* 数量不预填（对齐桌面端 2026-08-20 口径）：按实际点数手动填；扫码场景由外部数量覆盖 */
  const [数量, set数量] = useState("");
  const [问题, set问题] = useState<"" | "broken" | "wrong">("");
  const [破损选项, set破损选项] = useState<"" | "exchange" | "discard">("");
  const [错发选项, set错发选项] = useState<"" | "exchange" | "discard">("");
  const [多发选项, set多发选项] = useState<"" | "return" | "keep">("");
  const [多发付款, set多发付款] = useState<"" | "paid" | "free">("");
  const [少发选项, set少发选项] = useState<"" | "repurchase" | "discard">("");
  const [凭证, set凭证] = useState<string[]>([]);
  /* 配件图片（2026-08-21 需求5）：收货时可补拍实物图，追加到采购明细 photos，上传即落库 */
  const [配件图, set配件图] = useState<string[]>(明细.photos || []);
  /* 供应商销售单（2026-08-21）：选填，随采购单保存 */
  const [slipNo, setSlipNo] = useState(订单.supplier_order_no || "");
  const [slipAmount, setSlipAmount] = useState(订单.supplier_order_amount != null ? String(订单.supplier_order_amount) : "");
  const [slipPhotos, setSlipPhotos] = useState<string[]>(订单.supplier_slip_photos || []);

  /* 扫码连续加一：外部数量变化时同步进输入框 */
  useEffect(() => {
    if (外部数量 != null) {
      set数量(String(外部数量));
    }
  }, [外部数量]);

  const 订购 = 明细.quantity;
  const 数量数 = 数量.trim() === "" ? null : parseInt(数量.trim(), 10);

  /* 配件图片上传即落库（追加到采购明细 photos，入库后工单/库存也能看到实物图） */
  async function 保存配件图片(paths: string[]) {
    set配件图(paths);
    /* 写库走 Server Action */
    const 结果 = await 保存采购明细图片({ itemId: 明细.id, paths });
    if (!结果.success) showToast("图片保存失败: " + (结果.error || "未知错误"), "error");
  }

  async function 提交() {
    if (数量.trim() === "") {
      showToast("请填写实际到货数量(没到货请填 0)", "warning");
      return;
    }
    const qty = parseInt(数量.trim(), 10);
    if (isNaN(qty) || qty < 0) {
      showToast("到货数量必须 ≥ 0", "warning");
      return;
    }

    /* 销售单顺带保存（2026-08-21，选填不阻塞收货） */
    const 新金额 = slipAmount.trim() === "" ? null : parseFloat(slipAmount);
    if (slipAmount.trim() !== "" && (isNaN(新金额 as number) || (新金额 as number) < 0)) {
      showToast("销售单总金额无效", "warning");
      return;
    }
    if (slipNo.trim() || 新金额 !== null || slipPhotos.length > 0) {
      /* 销售单顺带保存走 Server Action（选填不阻塞收货） */
      await 保存供应商销售单({
        orderId: 订单.id,
        slipNo,
        slipAmount: 新金额,
        slipPhotos,
      });
    }

    if (qty === 订购) {
      if (问题 === "broken") {
        if (!破损选项) { showToast("请选择破损处理方式", "warning"); return; }
        onSubmit({
          动作: 破损选项 === "exchange" ? "broken_exchange" : "broken_discard",
          数量: qty, 凭证: 凭证.length > 0 ? 凭证 : null, 更新凭证: true,
        });
      } else if (问题 === "wrong") {
        if (!错发选项) { showToast("请选择错发处理方式", "warning"); return; }
        onSubmit({
          动作: 错发选项 === "exchange" ? "wrong_exchange" : "wrong_discard",
          数量: 错发选项 === "exchange" ? qty : 0, 凭证: 凭证.length > 0 ? 凭证 : null, 更新凭证: 凭证.length > 0,
        });
      } else {
        onSubmit({ 动作: "normal", 数量: qty, 凭证: null, 更新凭证: false });
      }
    } else if (qty > 订购) {
      if (!多发选项) { showToast("请选择多发处理方式", "warning"); return; }
      if (多发选项 === "keep" && !多发付款) { showToast("请选择是否对供应商付款", "warning"); return; }
      const 动作 = 多发选项 === "return" ? "excess_return" : 多发付款 === "paid" ? "excess_paid" : "excess_free";
      onSubmit({ 动作, 数量: qty, 凭证: null, 更新凭证: false });
    } else {
      if (!少发选项) { showToast("请选择少发处理方式", "warning"); return; }
      if (少发选项 === "repurchase") {
        onSubmit({ 动作: "short_repurchase", 数量: qty, 凭证: null, 更新凭证: false });
      } else {
        if (凭证.length === 0) {
          if (!(await 请求确认("少发弃货建议上传聊天截图作为凭证,确定不上传吗?"))) return;
        }
        if (qty === 0) {
          if (!(await 请求确认("确认删除该配件?这会同时清除采购流程和工单中的记录。"))) return;
          onSubmit({ 动作: "short_discard", 数量: 0, 凭证: null, 更新凭证: false, 弃货删行: true });
        } else {
          onSubmit({ 动作: "short_discard", 数量: qty, 凭证, 更新凭证: true });
        }
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-base font-semibold text-gray-900">收货 — {明细.name}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="p-4 space-y-4">
          <div className="text-xs text-gray-500">订购 {订购} {明细.unit || ""}</div>

          {/* 配件图片（2026-08-21 需求5）：收货时补拍实物图，随采购明细存档 */}
          <div>
            <label className="block text-xs text-gray-600 mb-1">配件图片（可拍照补充实物图）</label>
            <ImageUploader onUpload={保存配件图片} existingImages={配件图} maxImages={5} bucket="work-order-media" folder="purchase-item-photos" />
          </div>

          {/* 供应商销售单（2026-08-21）：选填，作用于本采购单；入库按单执行对账 */}
          <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-blue-800">供应商销售单（选填）</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={slipNo}
                onChange={(e) => setSlipNo(e.target.value)}
                placeholder="销售单号"
                className="flex-1 px-2.5 py-2 text-sm rounded-lg border border-blue-200 bg-white"
              />
              <input
                type="number"
                step="0.01"
                min={0}
                value={slipAmount}
                onChange={(e) => setSlipAmount(e.target.value)}
                placeholder="总金额¥"
                className="w-28 px-2.5 py-2 text-sm text-right rounded-lg border border-blue-200 bg-white"
              />
            </div>
            <ImageUploader onUpload={setSlipPhotos} existingImages={slipPhotos} maxImages={3} bucket="work-order-media" folder="supplier-slips" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">实际到货数量</label>
              {on请求扫码 && (
                <button
                  type="button"
                  onClick={on请求扫码}
                  className="text-xs px-2.5 py-1 rounded-lg bg-green-600 text-white active:bg-green-700 flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7V5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2m4-9h2m4 0h2m-8 4h2m4 0h2m-8 4h8" />
                  </svg>
                  继续扫码
                </button>
              )}
            </div>
            <input
              type="number"
              min={0}
              value={数量}
              onChange={(e) => set数量(e.target.value)}
              placeholder="没到货请填 0"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base"
            />
            {数量数 !== null && !isNaN(数量数) && (
              <p className={`text-xs mt-1 ${数量数 === 订购 ? "text-green-600" : 数量数 > 订购 ? "text-blue-600" : "text-red-600"}`}>
                {数量数 === 订购 ? "数量正常,可直接确认" : 数量数 > 订购 ? `多发 ${数量数 - 订购} 件,请选择处理方式` : `少发 ${订购 - 数量数} 件,请选择处理方式`}
              </p>
            )}
          </div>

          {数量数 === 订购 && 数量数 !== null && (
            <div>
              <div className="text-xs text-gray-500 mb-2">反馈问题(可选,二选一)</div>
              <div className="flex gap-2">
                {([["broken", "配件破损"], ["wrong", "配件错发"]] as const).map(([值, 名]) => (
                  <button
                    key={值}
                    type="button"
                    onClick={() => set问题(问题 === 值 ? "" : 值)}
                    className={`flex-1 py-2 rounded-lg border text-sm ${问题 === 值 ? "border-red-400 bg-red-50 text-red-700" : "border-gray-200 text-gray-600"}`}
                  >
                    {名}
                  </button>
                ))}
              </div>
              {问题 === "broken" && (
                <div className="mt-2 space-y-2">
                  {([["exchange", "换货(破损补发)", "正常入库 + 生成破损退货 + 自动补发"], ["discard", "不需要了", "先入库 + 生成破损退货"]] as const).map(([值, 名, 说]) => (
                    <label key={值} className={`flex items-start gap-2 p-3 border rounded-lg ${破损选项 === 值 ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}>
                      <input type="radio" name="mBroken" checked={破损选项 === 值} onChange={() => set破损选项(值)} className="mt-0.5" />
                      <div className="text-sm">
                        <div className="font-medium text-gray-900">{名}</div>
                        <div className="text-gray-500 text-xs mt-0.5">{说}</div>
                      </div>
                    </label>
                  ))}
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">破损照片</label>
                    <ImageUploader onUpload={set凭证} existingImages={凭证} maxImages={5} bucket="work-order-media" folder="purchase-evidence" />
                  </div>
                </div>
              )}
              {问题 === "wrong" && (
                <div className="mt-2 space-y-2">
                  {([["exchange", "换货", "先入库 + 生成错发退货 + 自动补发"], ["discard", "不需要了", "直接生成错发退货,不入库"]] as const).map(([值, 名, 说]) => (
                    <label key={值} className={`flex items-start gap-2 p-3 border rounded-lg ${错发选项 === 值 ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}>
                      <input type="radio" name="mWrong" checked={错发选项 === 值} onChange={() => set错发选项(值)} className="mt-0.5" />
                      <div className="text-sm">
                        <div className="font-medium text-gray-900">{名}</div>
                        <div className="text-gray-500 text-xs mt-0.5">{说}</div>
                      </div>
                    </label>
                  ))}
                  {/* 错发拍照留存（2026-08-21 需求6）：发给供货商作凭证 */}
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">错发照片（拍照留存，供供货商核对）</label>
                    <ImageUploader onUpload={set凭证} existingImages={凭证} maxImages={5} bucket="work-order-media" folder="purchase-evidence" />
                  </div>
                </div>
              )}
            </div>
          )}

          {数量数 !== null && !isNaN(数量数) && 数量数 > 订购 && (
            <div className="space-y-2">
              {([["return", "多出退货", "按订购数入库,多出部分生成多发退货"], ["keep", "入库留作备用", "多出部分一并入库"]] as const).map(([值, 名, 说]) => (
                <label key={值} className={`flex items-start gap-2 p-3 border rounded-lg ${多发选项 === 值 ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}>
                  <input type="radio" name="mExcess" checked={多发选项 === 值} onChange={() => set多发选项(值)} className="mt-0.5" />
                  <div className="text-sm flex-1">
                    <div className="font-medium text-gray-900">{名}</div>
                    <div className="text-gray-500 text-xs mt-0.5">{说}</div>
                    {值 === "keep" && 多发选项 === "keep" && (
                      <div className="mt-2 space-y-1.5">
                        <label className="flex items-center gap-2 text-xs">
                          <input type="radio" name="mExcessPaid" checked={多发付款 === "paid"} onChange={() => set多发付款("paid")} />
                          对供应商付款
                        </label>
                        <label className="flex items-center gap-2 text-xs">
                          <input type="radio" name="mExcessPaid" checked={多发付款 === "free"} onChange={() => set多发付款("free")} />
                          不付款(零价入库,作赠品)
                        </label>
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {数量数 !== null && !isNaN(数量数) && 数量数 < 订购 && (
            <div className="space-y-2">
              <label className={`flex items-start gap-2 p-3 border rounded-lg ${少发选项 === "repurchase" ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}>
                <input type="radio" name="mShort" checked={少发选项 === "repurchase"} onChange={() => set少发选项("repurchase")} className="mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium text-gray-900">{数量数 === 0 ? "重新采购" : "少发补货"}</div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {数量数 === 0 ? "未入库,按原订购数自动生成少发补货待采购" : "按实际到货数入库,差额自动生成少发补货待采购"}
                  </div>
                </div>
              </label>
              <label className={`flex items-start gap-2 p-3 border rounded-lg ${少发选项 === "discard" ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}>
                <input type="radio" name="mShort" checked={少发选项 === "discard"} onChange={() => set少发选项("discard")} className="mt-0.5" />
                <div className="text-sm flex-1">
                  <div className="font-medium text-gray-900">不需要了</div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {数量数 === 0 ? "清除该配件的采购记录和工单记录" : "按实际数量入库,建议附聊天截图凭证"}
                  </div>
                  {少发选项 === "discard" && 数量数 > 0 && (
                    <div className="mt-2">
                      <ImageUploader onUpload={set凭证} existingImages={凭证} maxImages={5} bucket="work-order-media" folder="purchase-evidence" />
                    </div>
                  )}
                </div>
              </label>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex gap-3 sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg">取消</button>
          <button
            type="button"
            onClick={提交}
            disabled={提交中}
            className="flex-1 py-2.5 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50"
          >
            {提交中 ? "处理中..." : "确认收货"}
          </button>
        </div>
      </div>
      {确认弹窗}
    </div>
  );
}

/* ─── 主组件 ─── */
export function MobileReceivingOrders({
  订单列表,
  待签收运单,
}: {
  订单列表: 待收订单[];
  待签收运单: 待签收运单[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const { showToast } = useToast();
  const [提交中, set提交中] = useState<string | null>(null);
  const [勾选, set勾选] = useState<Set<string>>(new Set());
  const [运单弹窗目标, set运单弹窗目标] = useState<string | "batch" | null>(null);
  const [收货目标, set收货目标] = useState<{ 订单: 待收订单; 明细: 待收明细 } | null>(null);
  /* 供应商筛选（2026-08-21 需求3） */
  const [供应商筛选, set供应商筛选] = useState<string | null>(null);

  /* 运单处理弹窗（2026-08-21 需求7）：未关联运单点收货时弹出，功能与桌面端一致 */
  const [gate目标, setGate目标] = useState<{ 订单: 待收订单; 明细: 待收明细 } | null>(null);
  const [gateTab, setGateTab] = useState<"link" | "exempt">("link");
  const [gateScope, setGateScope] = useState<"order" | "item">("order");
  const [gate运单id, setGate运单id] = useState("");
  const [gate运费, setGate运费] = useState("");
  const [gate说明, setGate说明] = useState("");

  /* 扫码收货：扫码开 + 各商品已扫次数（连续扫码加一） + 传给弹窗的数量 */
  const [扫码开, set扫码开] = useState(false);
  const [扫码数量, set扫码数量] = useState<number | null>(null);
  const 扫码计数Ref = useRef<Record<string, number>>({});

  /* 只显示还有未处理明细的订单 + 供应商筛选（需求3） */
  const 显示订单 = useMemo(
    () =>
      订单列表.filter(
        (o) =>
          (o.purchase_order_items || []).some((it) => !it.handle_action) &&
          (!供应商筛选 || (o.suppliers?.name || "未指定供应商") === 供应商筛选)
      ),
    [订单列表, 供应商筛选]
  );

  /* 供应商筛选 chips 选项（按待收货数排序，多的在前） */
  const 供应商选项 = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of 订单列表) {
      if (!(o.purchase_order_items || []).some((it) => !it.handle_action)) continue;
      const 名 = o.suppliers?.name || "未指定供应商";
      map.set(名, (map.get(名) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [订单列表]);

  const 分组 = useMemo(() => {
    const map = new Map<string, 待收订单[]>();
    for (const o of 显示订单) {
      const key = o.suppliers?.name || "未指定供应商";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "zh"));
  }, [显示订单]);

  function 切换勾选(id: string) {
    set勾选((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function 提交收货(参数: { 动作: string; 数量: number; 凭证: string[] | null; 更新凭证: boolean; 弃货删行?: boolean }) {
    if (!收货目标) return;
    const { 订单, 明细 } = 收货目标;
    set提交中(`item-${明细.id}`);
    try {
      if (参数.弃货删行) {
        /* 少发完全没到：直接删除（不走暂存） */
        const res = await 删除采购明细(订单.id, 明细.id);
        if (!res.success) throw new Error(res.error || "删除失败");
      } else {
        /* 2026-09-04 口径：确认收货先写暂存不入账，手动「提交收货」统一入账 */
        const res = await 暂存收货(明细.id, 参数.数量, 参数.动作, 参数.凭证);
        if (!res.success) throw new Error(res.error || "暂存失败");
      }
      set收货目标(null);
      set扫码数量(null);
      delete 扫码计数Ref.current[明细.id];
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("收货失败: " + msg, "error");
    } finally {
      set提交中(null);
    }
  }

  /* 撤销暂存（2026-09-04）：收错了重收 */
  async function 撤销暂存(明细: 待收明细) {
    if (!(await 请求确认(`确认撤销「${明细.name}」的收货暂存？撤销后可重新收货。`))) return;
    set提交中(`unstage-${明细.id}`);
    try {
      const res = await 撤销暂存收货(明细.id);
      if (!res.success) throw new Error(res.error || "撤销失败");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("撤销失败: " + msg, "error");
    } finally {
      set提交中(null);
    }
  }

  /* 提交暂存收货（2026-09-04）：按供应商统一入账，生成收货批次 */
  async function 提交暂存(订单: 待收订单) {
    const 供应商名 = 订单.suppliers?.name || "未指定供应商";
    if (!(await 请求确认(`确认提交「${供应商名}」的全部暂存收货？提交后立即入账入库，不可撤销。`))) return;
    set提交中(`submit-${供应商名}`);
    try {
      /* 销售单号用该供应商第一张单的（暂存区各单头录入同一单号；此处取订单上的） */
      const 销售单号 = 订单.supplier_order_no?.trim() || null;
      const res = await 提交暂存收货(订单.supplier_id!, 销售单号);
      if (!res.success) throw new Error(res.error || "提交失败");
      showToast(`提交成功，已入账 ${res.count} 件`);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("提交失败: " + msg, "error");
    } finally {
      set提交中(null);
    }
  }

  async function 撤销(订单: 待收订单, 明细: 待收明细) {
    if (!(await 请求确认(`确认撤销「${明细.name}」的收货处理?`))) return;
    set提交中(`revoke-${明细.id}`);
    try {
      const res = await 撤销收货处理(订单.id, 明细.id);
      if (!res.success) throw new Error(res.error || "撤销失败");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("撤销失败: " + msg, "error");
    } finally {
      set提交中(null);
    }
  }

  async function 整单撤销作废(订单id: string, 模式: "revoke" | "void") {
    const 文案 = 模式 === "revoke"
      ? "撤销整单：该采购单将作废留档，明细配件【退回】待采购列表，是否继续？"
      : "作废整单：该采购单将作废留档，明细配件【不】退回待采购，是否继续？";
    if (!(await 请求确认(文案))) return;
    set提交中(`cancel-${订单id}`);
    try {
      const res = await 撤销作废采购单(订单id, 模式);
      if (!res.success) throw new Error(res.error || "操作失败");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("操作失败: " + msg, "error");
    } finally {
      set提交中(null);
    }
  }

  async function 关联运单(运单id: string) {
    const 目标ids = 运单弹窗目标 === "batch" ? Array.from(勾选) : 运单弹窗目标 ? [运单弹窗目标] : [];
    if (目标ids.length === 0) return;
    set提交中("assign");
    try {
      const res = await 关联运单到采购单(运单id, 目标ids);
      if (!res.success) throw new Error(res.error || "关联失败");
      showToast(`已关联 ${res.count} 张采购单`);
      set勾选(new Set());
      set运单弹窗目标(null);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("关联运单失败: " + msg, "error");
    } finally {
      set提交中(null);
    }
  }

  /* 运单处理弹窗（需求7）：未关联运单点收货时弹出 */
  function 打开gate(订单: 待收订单, 明细: 待收明细) {
    setGate目标({ 订单, 明细 });
    setGateTab("link");
    setGateScope("order");
    setGate运单id("");
    setGate运费("");
    setGate说明("");
  }

  async function gate确认() {
    if (!gate目标) return;
    const 明细id = gateScope === "item" ? gate目标.明细.id : null;
    if (gateTab === "link" && !gate运单id) {
      showToast("请选择运单", "warning");
      return;
    }
    set提交中("gate");
    try {
      /* 先打本地补丁，确认后直接进收货弹窗（同桌面端动线） */
      const 单 = { ...gate目标.订单 };
      const 明细 = { ...gate目标.明细 };
      if (gateTab === "link") {
        const res = await 关联运单到采购单或配件(gate目标.订单.id, 明细id, gate运单id);
        if (!res.success) throw new Error(res.error || "关联失败");
        if (gateScope === "order") 单.waybill_id = gate运单id;
        else 明细.waybill_id = gate运单id;
      } else {
        const 运费 = gate运费.trim() === "" ? null : parseFloat(gate运费);
        if (运费 !== null && (isNaN(运费) || 运费 < 0)) {
          showToast("运费必须是非负数字", "warning");
          return;
        }
        const res = await 设置运单豁免(gate目标.订单.id, 明细id, 运费, gate说明);
        if (!res.success) throw new Error(res.error || "保存失败");
        if (gateScope === "order") 单.waybill_exempt = true;
        else 明细.waybill_exempt = true;
      }
      setGate目标(null);
      router.refresh();
      set收货目标({ 订单: 单, 明细 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("操作失败: " + msg, "error");
    } finally {
      set提交中(null);
    }
  }

  /* 运单弹窗里与目标供应商匹配的排前面 */
  const 排序运单 = useMemo(() => {
    const 目标供应商 = new Set<string>();
    if (运单弹窗目标 === "batch") {
      for (const o of 显示订单) {
        if (勾选.has(o.id) && o.suppliers?.name) 目标供应商.add(o.suppliers.name);
      }
    } else if (运单弹窗目标) {
      const o = 显示订单.find((x) => x.id === 运单弹窗目标);
      if (o?.suppliers?.name) 目标供应商.add(o.suppliers.name);
    }
    return [...待签收运单].sort((a, b) => {
      const a中 = 目标供应商.has(a.supplier_name || "") ? 1 : 0;
      const b中 = 目标供应商.has(b.supplier_name || "") ? 1 : 0;
      return b中 - a中;
    });
  }, [待签收运单, 运单弹窗目标, 勾选, 显示订单]);

  /* 扫码收货（2026-08-21）：条码/编码命中未处理商品 → 自动弹出该商品；
     连续扫同一商品数量自动+1，也可在弹窗里手改数量 */
  async function 扫码收货处理(码文本: string) {
    const code = 码文本.trim();
    if (!code) return;

    /* 先按零件编码直接匹配 */
    let 命中订单: 待收订单 | null = null;
    let 命中明细: 待收明细 | null = null;
    for (const o of 显示订单) {
      const it = o.purchase_order_items.find((x) => x.part_number === code);
      if (it) {
        命中订单 = o;
        命中明细 = it;
        break;
      }
    }
    /* 编码没中 → 按配件条码反查 part_id 再匹配 */
    if (!命中明细) {
      const { data } = await supabase.from("parts").select("id").eq("barcode", code).limit(1);
      const pid = data && data.length > 0 ? (data[0] as { id: string }).id : null;
      if (pid) {
        for (const o of 显示订单) {
          const it = o.purchase_order_items.find((x) => x.part_id === pid);
          if (it) {
            命中订单 = o;
            命中明细 = it;
            break;
          }
        }
      }
    }

    if (!命中明细 || !命中订单) {
      showToast(`待收货里没有「${code}」这个商品`, "warning");
      return;
    }
    if (命中明细.handle_action) {
      showToast(`「${命中明细.name}」已收货处理过了`, "warning");
      return;
    }
    if (!行可收货(命中订单, 命中明细)) {
      /* 需求7：扫码命中未关联运单的商品也弹运单处理窗（与桌面端一致） */
      set扫码开(false);
      打开gate(命中订单, 命中明细);
      return;
    }

    const n = (扫码计数Ref.current[命中明细.id] || 0) + 1;
    扫码计数Ref.current[命中明细.id] = n;
    /* 命中就关扫描弹窗，让收货弹窗露出；要再扫点弹窗里的「继续扫码」 */
    set扫码开(false);
    set收货目标({ 订单: 命中订单, 明细: 命中明细 });
    set扫码数量(n);
  }

  function 关闭收货弹窗() {
    if (收货目标) {
      delete 扫码计数Ref.current[收货目标.明细.id];
    }
    set收货目标(null);
    set扫码数量(null);
  }

  return (
    <div className="space-y-3">
      {/* 顶部操作 */}
      <div className="flex gap-2">
        <Link
          href="/m/receiving/waybills"
          className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium text-center active:bg-blue-700"
        >
          + 新建运单（批量）
        </Link>
        <button
          type="button"
          onClick={() => {
            if (勾选.size === 0) {
              showToast("先勾选要关联的采购单", "warning");
              return;
            }
            set运单弹窗目标("batch");
          }}
          className="flex-1 py-2.5 rounded-xl border border-blue-300 text-blue-700 bg-blue-50 text-sm font-medium"
        >
          关联运单{勾选.size > 0 ? `（已选${勾选.size}）` : ""}
        </button>
        <button
          type="button"
          onClick={() => set扫码开(true)}
          className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium active:bg-green-700"
        >
          扫码收货
        </button>
      </div>

      {显示订单.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 p-8 text-center text-gray-400 text-sm">
          暂无待收货的采购单
        </div>
      )}

      {/* 供应商筛选（2026-08-21 需求3）：单多供应商时快速聚焦 */}
      {供应商选项.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => set供应商筛选(null)}
            className={`shrink-0 px-3 py-1.5 text-xs rounded-full border transition-colors ${
              供应商筛选 === null
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white border-gray-200 text-gray-600"
            }`}
          >
            全部
          </button>
          {供应商选项.map(([名, 数]) => (
            <button
              key={名}
              type="button"
              onClick={() => set供应商筛选(供应商筛选 === 名 ? null : 名)}
              className={`shrink-0 px-3 py-1.5 text-xs rounded-full border transition-colors ${
                供应商筛选 === 名
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white border-gray-200 text-gray-600"
              }`}
            >
              {名}（{数}）
            </button>
          ))}
        </div>
      )}

      {分组.map(([供应商, 订单组]) => (
        <div key={供应商} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1 h-4 bg-blue-500 rounded" />
            <span className="text-sm font-bold text-gray-900">{供应商}</span>
            <span className="text-xs text-gray-400">共 {订单组.length} 张</span>
          </div>

          {订单组.map((单) => {
            const 需运单 = 需要运单(单);
            const 未处理数 = 单.purchase_order_items.filter((it) => !it.handle_action).length;
            return (
              <div key={单.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* 订单头 */}
                <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                  {需运单 && (
                    <input type="checkbox" checked={勾选.has(单.id)} onChange={() => 切换勾选(单.id)} className="rounded" />
                  )}
                  <span className="font-semibold text-gray-900 text-sm">{单.order_no || 单.id.slice(0, 8)}</span>
                  <span className="text-xs text-gray-400">{new Date(单.created_at).toLocaleDateString("zh-CN")}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${未处理数 === 0 ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-700"}`}>
                    {未处理数 === 0 ? "全部已处理" : `待收 ${未处理数} 项`}
                  </span>
                  {单.status === "submitted" && (
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        disabled={提交中 === `cancel-${单.id}`}
                        onClick={() => 整单撤销作废(单.id, "revoke")}
                        className="text-xs text-amber-600 disabled:opacity-50"
                      >
                        撤销整单
                      </button>
                      <button
                        type="button"
                        disabled={提交中 === `cancel-${单.id}`}
                        onClick={() => 整单撤销作废(单.id, "void")}
                        className="text-xs text-red-400 disabled:opacity-50"
                      >
                        作废整单
                      </button>
                    </span>
                  )}
                </div>

                {/* 运单行 */}
                <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 flex-wrap text-xs">
                  {单.logistics_waybills ? (
                    <>
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                        运单 {单.logistics_waybills.tracking_no}
                      </span>
                      <span className="text-gray-500">
                        {单.logistics_waybills.logistics_companies?.name || 单.logistics_waybills.logistics_company_name || "-"}
                      </span>
                      <button type="button" onClick={() => set运单弹窗目标(单.id)} className="text-blue-600">
                        更换
                      </button>
                    </>
                  ) : 需运单 ? (
                    <>
                      <span className="px-2 py-0.5 rounded bg-yellow-50 text-yellow-700">未关联运单</span>
                      <button
                        type="button"
                        onClick={() => set运单弹窗目标(单.id)}
                        className="px-2 py-0.5 rounded border border-gray-200 text-gray-600"
                      >
                        选择运单
                      </button>
                    </>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-gray-50 text-gray-500">本地供货 · 无需运单</span>
                  )}
                </div>

                {/* 商品列表（上下排列） */}
                <div className="divide-y divide-gray-100">
                  {单.purchase_order_items.map((明细) => {
                    const 动作 = 明细.handle_action ? ACTION_LABELS[明细.handle_action] : null;
                    return (
                      <div key={明细.id} className="px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-gray-900 text-sm">{明细.name}</div>
                            {(明细.brand || 明细.specification) && (
                              <div className="text-xs text-gray-400 mt-0.5">{明细.brand || ""} {明细.specification || ""}</div>
                            )}
                            <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                              {明细.part_number && <div>编码：{明细.part_number}</div>}
                              {明细.supplier_part_name && <div>单据名称：{明细.supplier_part_name}</div>}
                              <div>订购：{明细.quantity} {明细.unit || ""}</div>
                              {明细.notes && <div>备注：{明细.notes}</div>}
                            </div>
                            {明细.photos && 明细.photos.length > 0 && (
                              <div className="flex gap-1 mt-1.5">
                                {明细.photos.slice(0, 4).map((p, i) => (
                                  <img key={i} src={解决图片地址(p)} alt="" loading="lazy" className="w-10 h-10 object-cover rounded border border-gray-100" />
                                ))}
                              </div>
                            )}
                          </div>
                          {/* 操作区：不滑屏直接可见 */}
                          <div className="shrink-0 flex flex-col items-end gap-1.5">
                            {动作 ? (
                              <>
                                <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${动作.color}`}>{动作.text}</span>
                                <button
                                  type="button"
                                  onClick={() => 撤销(单, 明细)}
                                  disabled={提交中 === `revoke-${明细.id}`}
                                  className="px-2.5 py-1 text-xs rounded border border-red-200 text-red-600 bg-red-50 disabled:opacity-50"
                                >
                                  {提交中 === `revoke-${明细.id}` ? "撤销中..." : "撤销"}
                                </button>
                              </>
                            ) : 明细.staged_at ? (
                              /* 已暂存（2026-09-04）：确认收货未提交入账，可撤销重收 */
                              <>
                                <span className="text-xs px-2 py-0.5 rounded whitespace-nowrap bg-yellow-100 text-yellow-700">
                                  已暂存{明细.staged_action && ACTION_LABELS[明细.staged_action] ? "·" + ACTION_LABELS[明细.staged_action].text : ""}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => 撤销暂存(明细)}
                                  disabled={提交中 === `unstage-${明细.id}`}
                                  className="px-2.5 py-1 text-xs rounded border border-yellow-300 text-yellow-700 bg-yellow-50 disabled:opacity-50"
                                >
                                  {提交中 === `unstage-${明细.id}` ? "撤销中..." : "撤销暂存"}
                                </button>
                              </>
                            ) : (
                              /* 行级运单门禁（需求7）：未关联也未豁免时半透明但可点，点击弹运单处理窗；
                                 行内不再直显待退货（2026-08-20 需求4，退货在收货弹窗问题分支里选） */
                              (() => {
                                const 可收 = 行可收货(单, 明细);
                                return (
                                  <button
                                    type="button"
                                    onClick={() => (可收 ? set收货目标({ 订单: 单, 明细 }) : 打开gate(单, 明细))}
                                    disabled={提交中 === `item-${明细.id}`}
                                    className={`px-4 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
                                      可收
                                        ? "bg-blue-600 text-white active:bg-blue-700"
                                        : "bg-blue-600/40 text-white active:bg-blue-600/60"
                                    }`}
                                  >
                                    收货
                                  </button>
                                );
                              })()
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* 提交收货区（2026-09-04 跨单收货）：该供应商有暂存时显示，手动统一入账 */}
          {(() => {
            const 暂存数 = 订单组.reduce(
              (sum, o) => sum + (o.purchase_order_items || []).filter((it) => it.staged_at && !it.handle_action).length,
              0
            );
            const 首单 = 订单组[0];
            if (暂存数 === 0 || !首单?.supplier_id) return null;
            return (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 space-y-2">
                <div className="text-sm font-medium text-yellow-800">
                  已暂存 <span className="font-bold">{暂存数}</span> 件待提交
                </div>
                <button
                  type="button"
                  onClick={() => 提交暂存(首单)}
                  disabled={提交中 === `submit-${首单.supplier_id}`}
                  className="w-full py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium active:bg-green-700 disabled:opacity-50"
                >
                  {提交中 === `submit-${首单.supplier_id}` ? "提交中..." : `提交收货（${暂存数} 件）`}
                </button>
                <p className="text-xs text-yellow-700 text-center">提交后立即入账入库，不可撤销</p>
              </div>
            );
          })()}
        </div>
      ))}

      {/* 运单选择弹窗 */}
      {运单弹窗目标 && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-2xl max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">
                {运单弹窗目标 === "batch" ? `批量关联运单（${勾选.size} 张）` : "选择运单"}
              </h3>
              <button type="button" onClick={() => set运单弹窗目标(null)} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {排序运单.length === 0 && (
                <div className="text-center text-gray-400 py-8 text-sm">
                  暂无待签收的运单，点上方「新建运单（批量）」创建
                </div>
              )}
              {排序运单.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => 关联运单(w.id)}
                  disabled={提交中 === "assign"}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 active:bg-blue-50 disabled:opacity-50"
                >
                  <div className="font-medium text-gray-900 text-sm">{w.tracking_no}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {w.logistics_companies?.name || w.logistics_company_name || "-"}
                    {w.supplier_name ? ` · ${w.supplier_name}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 运单处理弹窗（2026-08-21 需求7）：未关联运单点收货弹出，功能与桌面端一致 */}
      {gate目标 && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-2xl max-h-[85vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">需要先处理运单</h3>
              <button type="button" onClick={() => setGate目标(null)} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <p className="text-xs text-gray-500">
                <span className="font-medium text-gray-900">{gate目标.订单.suppliers?.name}</span>{" "}
                是外阜供应商，货一般走物流。请关联运单；没有运单的（自行采购/捎带等）选「不关联运单」并写明情况。
              </p>

              {/* 模式选择 */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGateTab("link")}
                  className={`py-2.5 text-sm rounded-lg border ${gateTab === "link" ? "border-blue-500 bg-blue-50 text-blue-700 font-medium" : "border-gray-200 text-gray-600"}`}
                >
                  关联运单
                </button>
                <button
                  type="button"
                  onClick={() => setGateTab("exempt")}
                  className={`py-2.5 text-sm rounded-lg border ${gateTab === "exempt" ? "border-amber-500 bg-amber-50 text-amber-700 font-medium" : "border-gray-200 text-gray-600"}`}
                >
                  不关联运单
                </button>
              </div>

              {/* 作用范围 */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 shrink-0">作用于:</span>
                <button
                  type="button"
                  onClick={() => setGateScope("order")}
                  className={`flex-1 py-1.5 text-xs rounded-full border ${gateScope === "order" ? "border-blue-600 bg-blue-600 text-white" : "border-gray-200 text-gray-600"}`}
                >
                  整张采购单
                </button>
                <button
                  type="button"
                  onClick={() => setGateScope("item")}
                  className={`flex-1 py-1.5 text-xs rounded-full border ${gateScope === "item" ? "border-blue-600 bg-blue-600 text-white" : "border-gray-200 text-gray-600"}`}
                >
                  仅「{gate目标.明细.name}」
                </button>
              </div>

              {gateTab === "link" ? (
                待签收运单.length === 0 ? (
                  <div className="text-center text-gray-400 py-6 text-sm">
                    暂无待签收运单，先点顶部「新建运单」创建
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[...待签收运单]
                      .sort((a, b) => {
                        const 目标名 = gate目标.订单.suppliers?.name;
                        return (b.supplier_name === 目标名 ? 1 : 0) - (a.supplier_name === 目标名 ? 1 : 0);
                      })
                      .map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => setGate运单id(w.id)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border ${
                            gate运单id === w.id ? "border-blue-500 bg-blue-50" : "border-gray-200 active:bg-gray-50"
                          }`}
                        >
                          <div className="font-medium text-gray-900 text-sm">{w.tracking_no}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {w.logistics_companies?.name || w.logistics_company_name || "-"}
                            {w.supplier_name ? ` · ${w.supplier_name}` : ""}
                          </div>
                        </button>
                      ))}
                  </div>
                )
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">运费（可选，元）</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={gate运费}
                      onChange={(e) => setGate运费(e.target.value)}
                      placeholder="没产生运费可不填"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">说明 *</label>
                    <input
                      type="text"
                      value={gate说明}
                      onChange={(e) => setGate说明(e.target.value)}
                      placeholder="如：自行采购、其它方式带回"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base"
                    />
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {["自行采购", "司机捎带", "其它方式带回"].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setGate说明(t)}
                          className={`px-2.5 py-1 text-xs rounded-full border ${gate说明 === t ? "border-amber-500 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-600"}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setGate目标(null)}
                className="flex-1 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={gate确认}
                disabled={提交中 === "gate"}
                className="flex-1 py-2.5 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50"
              >
                {提交中 === "gate" ? "处理中..." : "确认并收货"}
              </button>
            </div>
          </div>
        </div>
      )}

      {收货目标 && (
        <ReceiveModal
          明细={收货目标.明细}
          订单={收货目标.订单}
          提交中={提交中 === `item-${收货目标.明细.id}`}
          外部数量={扫码数量}
          on请求扫码={() => set扫码开(true)}
          onClose={关闭收货弹窗}
          onSubmit={提交收货}
        />
      )}
      {/* 扫码收货：连续模式，扫一个弹一个/加一 */}
      <BarcodeScanModal
        open={扫码开}
        onClose={() => set扫码开(false)}
        onScan={扫码收货处理}
        连续模式
        标题="扫码收货"
      />
      {确认弹窗}
    </div>
  );
}
