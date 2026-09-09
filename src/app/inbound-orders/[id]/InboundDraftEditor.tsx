"use client";

/* ============================================================
 * 入库确认单编辑器（2026-09-08 两阶段入库）
 * draft 状态的入库单详情页主体：
 *   - 行级可改：编码（行内配件关联）、入库价、手动分摊运费、批次号、仓库仓位、备注
 *   - 数量只读（数量错 = 收货环节错，作废确认单重新生成）
 *   - 单头可改：运费、优惠抹零、销售单号、销售单金额、分摊运单（批次来源）
 *   - 按钮：保存修改 / 确认入库 / 作废确认单
 * 分摊预览算法与 RPC 同口径：手动行锁定，剩余运费按行金额占比分摊。
 * ============================================================ */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import PartForm from "@/app/parts/new/PartForm";
import { usePartLinking } from "@/components/usePartLinking";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { 更新入库确认单, 作废入库确认单, 确认入库单 } from "@/app/inbound-orders/actions";

/* 确认单明细编辑行（draft 快照 + 采购明细关联字段） */
export interface 确认单编辑行 {
  id: string; /* inbound_order_items.id */
  purchase_order_item_id: string | null;
  work_order_item_part_id: string | null; /* 联 purchase_order_items 带出，双写 WOI 用 */
  part_id: string | null;
  part_number: string | null;
  name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  supplier_part_name: string | null; /* 联 purchase_order_items 带出，弹窗预填用 */
  quantity: number;
  unit_cost: number | null;
  allocated_cost: number | null;
  freight_manual: boolean; /* 手动运费标记（2026-09-08）：编辑界面精确还原手动/自动 */
  batch_no: string | null;
  warehouse_id: string | null;
  location: string | null;
  notes: string | null;
}

export interface 确认单单头 {
  id: string;
  inbound_no: string;
  receiving_batch_id: string | null;
  purchase_order_id: string | null;
  freight_amount: number | null;
  discount_amount: number | null;
  supplier_order_no: string | null;
  supplier_order_amount: number | null;
  waybill_id: string | null;
}

interface 仓库 {
  id: string;
  name: string;
}

export interface 运单选项 {
  id: string;
  tracking_no: string | null;
  logistics_company_name: string | null;
  剩余: number;
}

interface Props {
  单头: 确认单单头;
  明细: 确认单编辑行[];
  仓库列表: 仓库[];
  /* 批次来源时的可选分摊运单（采购单来源传空数组，运单固定取采购单的） */
  运单列表: 运单选项[];
}

/* 行编辑表单（字符串存储，提交时转 number——项目表单规范） */
interface 行表单 {
  unitCost: string;
  freightManual: string; /* 空 = 自动分摊 */
  batchNo: string;
  warehouseId: string;
  location: string;
  notes: string;
}

export function InboundDraftEditor({ 单头, 明细, 仓库列表, 运单列表 }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState<string | null>(null);

  /* 行表单初始化：手动行带出现值，自动行留空（=自动分摊） */
  const [行表单们, set行表单们] = useState<Record<string, 行表单>>(() => {
    const map: Record<string, 行表单> = {};
    for (const 行 of 明细) {
      map[行.id] = {
        unitCost: 行.unit_cost != null ? String(行.unit_cost) : "",
        freightManual: 行.freight_manual && 行.allocated_cost != null ? String(行.allocated_cost) : "",
        batchNo: 行.batch_no || "",
        warehouseId: 行.warehouse_id || "",
        location: 行.location || "",
        notes: 行.notes || "",
      };
    }
    return map;
  });

  /* 单头表单 */
  const [运费, set运费] = useState(单头.freight_amount != null ? String(单头.freight_amount) : "");
  const [抹零, set抹零] = useState(单头.discount_amount != null && 单头.discount_amount > 0 ? String(单头.discount_amount) : "");
  const [销售单号, set销售单号] = useState(单头.supplier_order_no || "");
  const [销售单金额, set销售单金额] = useState(单头.supplier_order_amount != null ? String(单头.supplier_order_amount) : "");
  const [运单id, set运单id] = useState<string | null>(单头.waybill_id);

  /* 编码修改：复用行内配件关联共享 Hook（写 purchase_order_items，保存时 RPC 重拉快照） */
  const 配件联动 = usePartLinking<确认单编辑行>({
    supabase,
    主表: "purchase_order_items",
    双写WOI: true,
    getRowId: (行) => 行.purchase_order_item_id || 行.id,
    getWoiId: (行) => 行.work_order_item_part_id,
    getWoi当前值: async (行) => {
      if (!行.work_order_item_part_id) return null;
      const { data } = await supabase
        .from("work_order_item_parts")
        .select("name, unit, brand, specification, unit_cost, unit_price")
        .eq("id", 行.work_order_item_part_id)
        .single();
      return data;
    },
    写WoiPartId: false,
    行内unitCost来源: "unit_cost",
    行内写售价: true,
    弹窗写supplierPartName: true,
    弹窗写WoiDocumentName: true,
    弹窗规格来源: "specification_text",
    取弹前行: (行) => 行,
    setSubmitting,
    reload: () => router.refresh(),
  });
  const {
    editRow: 编辑行,
    editId,
    prefillData: 配件预填,
    openCreateNewModal,
    closeEditModal,
    handlePartSaved,
    handleInlinePartSelect,
    handleInlineClear,
  } = 配件联动;

  function 改行(id: string, 字段: keyof 行表单, 值: string) {
    set行表单们((prev) => ({ ...prev, [id]: { ...prev[id], [字段]: 值 } }));
  }

  /* 分摊预览（与 RPC 同口径）：手动行锁定，剩余运费按行金额占比分摊 */
  const 分摊预览 = useMemo(() => {
    const 总运费 = parseFloat(运费) || 0;
    const 手动合计 = 明细.reduce((sum, 行) => {
      const f = 行表单们[行.id]?.freightManual ?? "";
      return sum + (f.trim() === "" ? 0 : parseFloat(f) || 0);
    }, 0);
    const 剩余 = Math.max(0, 总运费 - 手动合计);
    const 自动行金额合计 = 明细
      .filter((行) => (行表单们[行.id]?.freightManual ?? "").trim() === "")
      .reduce((sum, 行) => sum + 行.quantity * (parseFloat(行表单们[行.id]?.unitCost ?? "") || 0), 0);

    const map = new Map<string, number>();
    for (const 行 of 明细) {
      const f = 行表单们[行.id]?.freightManual ?? "";
      if (f.trim() !== "") {
        map.set(行.id, parseFloat(f) || 0);
      } else if (自动行金额合计 > 0) {
        const 行金额 = 行.quantity * (parseFloat(行表单们[行.id]?.unitCost ?? "") || 0);
        map.set(行.id, Math.round((剩余 * 行金额 / 自动行金额合计) * 100) / 100);
      } else {
        map.set(行.id, 0);
      }
    }
    return map;
  }, [明细, 行表单们, 运费]);

  const 货款合计 = useMemo(
    () =>
      明细.reduce(
        (sum, 行) => sum + 行.quantity * (parseFloat(行表单们[行.id]?.unitCost ?? "") || 0),
        0
      ),
    [明细, 行表单们]
  );

  const 销售单金额数 = 销售单金额.trim() === "" ? null : parseFloat(销售单金额);
  const 抹零数 = 抹零.trim() === "" ? 0 : parseFloat(抹零);
  const 对平差异 = 销售单金额数 !== null ? 货款合计 - 抹零数 - 销售单金额数 : 0;

  /* 保存修改 */
  async function 保存修改() {
    /* 销售单总金额必填（2026-09-09）：未填直接拦截 */
    if (销售单金额.trim() === "") {
      alert("供应商销售单总金额必填，请填写后再保存");
      return;
    }
    if (销售单金额.trim() !== "" && (isNaN(销售单金额数!) || 销售单金额数! < 0)) {
      alert("销售单总金额无效");
      return;
    }
    if (抹零.trim() !== "" && (isNaN(抹零数) || 抹零数 < 0)) {
      alert("优惠抹零必须是非负数字");
      return;
    }
    if (销售单金额数 !== null && Math.abs(对平差异) > 0.01) {
      alert(
        `入库货款合计 ¥${货款合计.toFixed(2)} − 抹零 ¥${抹零数.toFixed(2)} ≠ 销售单总金额 ¥${销售单金额数.toFixed(2)}，` +
        `差 ¥${对平差异.toFixed(2)}。\n请逐行核对入库单价，或在「优惠抹零」填入差额。`
      );
      return;
    }

    setSubmitting("save");
    try {
      const res = await 更新入库确认单(
        单头.id,
        明细.map((行) => {
          const f = 行表单们[行.id];
          return {
            id: 行.id,
            unit_cost: f.unitCost.trim() === "" ? null : parseFloat(f.unitCost),
            freight_alloc: f.freightManual.trim() === "" ? null : parseFloat(f.freightManual),
            batch_no: f.batchNo,
            warehouse_id: f.warehouseId,
            location: f.location,
            notes: f.notes,
          };
        }),
        parseFloat(运费) || 0,
        抹零.trim() === "" ? null : 抹零数,
        销售单号.trim() || null,
        销售单金额数,
        运单id
      );
      if (!res.success) throw new Error(res.error || "保存失败");
      showToast("确认单已保存");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("保存失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  /* 确认入库：服务端从 draft 读数据执行，本函数只传 id */
  async function 执行确认入库() {
    /* 销售单总金额必填（2026-09-09）：表单没填或已存数据缺金额都先拦，
       服务端 确认入库单 对存量 NULL 金额旧单还有第二道拦截 */
    if (销售单金额.trim() === "" || 单头.supplier_order_amount == null) {
      alert("请先填写供应商销售单总金额并保存，再确认入库");
      return;
    }
    if (Math.abs(对平差异) > 0.01) {
      alert("销售单总金额与货款对不平，请先修正并保存，再确认入库");
      return;
    }
    const 确认 = await 请求确认({
      title: "确认入库",
      message: `确认后库存立即增加、生成应付款，确认单 ${单头.inbound_no} 转为正式入库单。\n确认前请先保存修改（未保存的改动不会生效）。是否继续？`,
      confirmText: "确认入库",
      danger: false,
    });
    if (!确认) return;

    setSubmitting("confirm");
    try {
      const res = await 确认入库单(单头.id);
      if (!res.success) throw new Error(res.error || "确认入库失败");
      showToast(`入库完成，入库单号 ${res.inbound_no}`);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("确认入库失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  /* 作废确认单：硬删，回待入库页可重新生成 */
  async function 执行作废() {
    const 确认 = await 请求确认({
      title: "作废确认单",
      message: `作废后确认单 ${单头.inbound_no} 将被删除，需要回到待入库页重新生成。\n此操作不可恢复，是否继续？`,
      confirmText: "作废",
    });
    if (!确认) return;

    setSubmitting("void");
    try {
      const res = await 作废入库确认单(单头.id);
      if (!res.success) throw new Error(res.error || "作废失败");
      showToast("确认单已作废");
      router.push("/procurement?tab=pending_storage");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("作废失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-4 print:hidden">
      {/* 单头编辑区 */}
      <div className="bg-orange-50/60 border border-orange-100 rounded-lg p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">分摊运费（总）</label>
            <input
              type="number"
              value={运费}
              onChange={(e) => set运费(e.target.value)}
              placeholder="0"
              className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded bg-white focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">优惠抹零（减项）</label>
            <input
              type="number"
              value={抹零}
              onChange={(e) => set抹零(e.target.value)}
              placeholder="0"
              className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded bg-white focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">销售单号</label>
            <input
              type="text"
              value={销售单号}
              onChange={(e) => set销售单号(e.target.value)}
              placeholder="供应商销售单号"
              className="w-36 px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              销售单总金额 <span className="text-red-500">*</span>
            </label>
            {/* 必填三态样式（2026-09-09，同待询价口径）：
                未填红框提醒 / 已改未保存黄底 / 正常灰框 */}
            <input
              type="number"
              value={销售单金额}
              onChange={(e) => set销售单金额(e.target.value)}
              placeholder="必填，填了校验对平"
              className={`w-32 px-2 py-1 text-sm text-right rounded focus:outline-none focus:border-blue-400 ${
                销售单金额.trim() === ""
                  ? "border border-red-300 bg-red-50 text-red-600 placeholder-red-400"
                  : 销售单金额 !== (单头.supplier_order_amount != null ? String(单头.supplier_order_amount) : "")
                    ? "border border-yellow-400 bg-yellow-50"
                    : "border border-gray-300 bg-white"
              }`}
            />
          </div>
          {运单列表.length > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">分摊运单</label>
              <select
                value={运单id || ""}
                onChange={(e) => set运单id(e.target.value || null)}
                className="w-56 px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:border-blue-400"
              >
                <option value="">不分摊运单</option>
                {运单列表.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.tracking_no || w.id.slice(0, 8)} · 剩余 ¥{w.剩余.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {/* 销售单对平提示（与 RPC 同口径，保存时还会再拦一次） */}
        {销售单金额数 !== null && Math.abs(对平差异) > 0.01 && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2">
            货款合计 ¥{货款合计.toFixed(2)} − 抹零 ¥{抹零数.toFixed(2)} ≠ 销售单总金额 ¥{销售单金额数.toFixed(2)}
            （差 ¥{对平差异.toFixed(2)}），请逐行核对入库单价，或在「优惠抹零」填入差额
          </div>
        )}
        {销售单金额数 !== null && Math.abs(对平差异) <= 0.01 && (
          <div className="mt-3 text-xs text-green-700 bg-green-50 border border-green-100 rounded px-3 py-2">
            ✓ 与销售单对平：货款 ¥{货款合计.toFixed(2)} − 抹零 ¥{抹零数.toFixed(2)} = ¥{销售单金额数.toFixed(2)}
          </div>
        )}
      </div>

      {/* 明细编辑表 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">入库明细（数量不可改，数量错请作废重新生成）</h3>
          <span className="text-xs text-gray-500">分摊运费列留空 = 按行金额占比自动分摊</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500 w-10">序号</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">零件编码</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">商品名称</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">数量</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">入库价</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">分摊运费</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">成本价</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">批次号</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">仓库</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">仓位</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {明细.map((行, idx) => {
                const f = 行表单们[行.id];
                if (!f) return null;
                const 单价 = parseFloat(f.unitCost) || 0;
                const 分摊 = 分摊预览.get(行.id) || 0;
                const 成本 = 单价 + (行.quantity > 0 ? Math.round((分摊 / 行.quantity) * 100) / 100 : 0);
                const 缺编码 = !行.part_id || !行.part_number;
                return (
                  <tr key={行.id} className={缺编码 ? "bg-red-50" : "hover:bg-gray-50"}>
                    <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <PartSearchDropdown
                        value={行.part_number || ""}
                        onChange={() => {}}
                        onSelect={(part) => handleInlinePartSelect(行, part)}
                        onCreateNew={(query) => openCreateNewModal(行, query)}
                        onClear={() => handleInlineClear(行)}
                        disabled={submitting === `inline-${行.purchase_order_item_id || 行.id}`}
                        placeholder={缺编码 ? "必填" : "编码"}
                        inputClassName={`w-24 text-xs ${缺编码 ? "border-red-400 bg-red-50 placeholder-red-500" : "border-gray-200"}`}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-gray-900 font-medium">{行.name || "-"}</div>
                      {行.brand || 行.specification ? (
                        <div className="text-xs text-gray-400">{行.brand || ""} {行.specification || ""}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900" title="数量不可改，数量错请作废确认单重新生成">
                      {行.quantity}{行.unit ? ` ${行.unit}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        value={f.unitCost}
                        onChange={(e) => 改行(行.id, "unitCost", e.target.value)}
                        className="w-20 px-1.5 py-1 text-xs text-right border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        value={f.freightManual}
                        onChange={(e) => 改行(行.id, "freightManual", e.target.value)}
                        placeholder={分摊 > 0 ? 分摊.toFixed(2) : "自动"}
                        className={`w-20 px-1.5 py-1 text-xs text-right border rounded focus:outline-none focus:border-blue-400 ${
                          f.freightManual.trim() !== "" ? "border-orange-300 bg-orange-50" : "border-gray-200"
                        }`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900 font-medium">
                      {成本 > 0 ? `¥${成本.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={f.batchNo}
                        onChange={(e) => 改行(行.id, "batchNo", e.target.value)}
                        className="w-20 px-1.5 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={f.warehouseId}
                        onChange={(e) => 改行(行.id, "warehouseId", e.target.value)}
                        className="w-24 px-1.5 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:border-blue-400"
                      >
                        <option value="">不指定</option>
                        {仓库列表.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={f.location}
                        onChange={(e) => 改行(行.id, "location", e.target.value)}
                        className="w-20 px-1.5 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={f.notes}
                        onChange={(e) => 改行(行.id, "notes", e.target.value)}
                        className="w-24 px-1.5 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-500">合计</td>
                <td className="px-3 py-2 text-right font-medium text-gray-900">
                  {明细.reduce((s, 行) => s + 行.quantity, 0)}
                </td>
                <td className="px-3 py-2 text-right text-xs text-gray-500">货款 ¥{货款合计.toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-xs text-gray-500">
                  分摊 ¥{明细.reduce((s, 行) => s + (分摊预览.get(行.id) || 0), 0).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-medium text-gray-900">
                  ¥{(货款合计 + 明细.reduce((s, 行) => s + (分摊预览.get(行.id) || 0), 0)).toFixed(2)}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 操作按钮区 */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={执行作废}
          disabled={submitting !== null}
          className="px-4 py-2 border border-red-200 text-red-600 bg-red-50 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
        >
          {submitting === "void" ? "处理中..." : "作废确认单"}
        </button>
        <button
          type="button"
          onClick={保存修改}
          disabled={submitting !== null}
          className="px-4 py-2 border border-blue-200 text-blue-600 bg-blue-50 text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
        >
          {submitting === "save" ? "保存中..." : "保存修改"}
        </button>
        <button
          type="button"
          onClick={执行确认入库}
          disabled={submitting !== null || 明细.some((行) => !行.part_id || !行.part_number) || 单头.supplier_order_amount == null}
          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          {submitting === "confirm" ? "入库中..." : "确认入库"}
        </button>
      </div>
      {明细.some((行) => !行.part_id || !行.part_number) && (
        <p className="text-xs text-red-500 text-right">有行缺少零件编码，补全后才能确认入库</p>
      )}
      {单头.supplier_order_amount == null && (
        <p className="text-xs text-red-500 text-right">未填写供应商销售单总金额，填写并保存后才能确认入库</p>
      )}

      {/* 新建/编辑配件弹窗（行内编码「新建」入口） */}
      {编辑行 && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-6xl my-8 relative">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="text-base font-semibold text-gray-900">
                {编辑行.part_id ? "编辑配件信息" : "新增配件信息"}
              </h3>
              <button
                type="button"
                onClick={closeEditModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6">
              <PartForm
                editId={editId}
                onSaved={handlePartSaved}
                onCancel={closeEditModal}
                prefillData={配件预填}
              />
            </div>
          </div>
        </div>
      )}

      {确认弹窗}
    </div>
  );
}
