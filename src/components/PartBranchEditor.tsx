"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  part: any;
  itemId: string;
  inventoryQty: number;
  suppliers: any[];
  seqLabel: string;
  canDelete: boolean;
  isLocked: boolean;
  children?: React.ReactNode;
}

export default function PartBranchEditor({
  part,
  itemId,
  inventoryQty,
  suppliers,
  seqLabel,
  canDelete,
  isLocked,
  children,
}: Props) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);

  function refresh() {
    window.location.reload();
  }

  // 字段编辑状态
  const [editForm, setEditForm] = useState({
    part_number: part.part_number || "",
    brand: part.brand || "",
    specification: part.specification || "",
    unit_cost: part.unit_cost != null ? String(part.unit_cost) : "",
    unit_price: part.unit_price != null ? String(part.unit_price) : "",
    supplier_name: part.supplier_name || "",
  });

  async function saveField(field: string, value: string) {
    setSaving(true);
    const updateData: Record<string, any> = {};
    if (field === "unit_cost" || field === "unit_price") {
      updateData[field] = value === "" ? null : parseFloat(value);
    } else {
      updateData[field] = value || null;
    }

    const { error } = await supabase
      .from("work_order_item_parts")
      .update(updateData)
      .eq("id", part.id);

    setSaving(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
  }

  async function togglePurchase() {
    if (!part.customer_opinion || part.customer_opinion !== "agree") {
      alert("需客户同意后才能采购");
      return;
    }
    if (!part.is_purchased && inventoryQty > 0) {
      alert("库存不为0，无需采购");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("work_order_item_parts")
      .update({ is_purchased: !part.is_purchased })
      .eq("id", part.id);
    setSaving(false);
    if (error) {
      alert("操作失败: " + error.message);
      return;
    }
    refresh();
  }

  async function toggleArrived() {
    if (!part.is_purchased) {
      alert("需先采购后才能标记到货");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("work_order_item_parts")
      .update({ is_arrived: !part.is_arrived })
      .eq("id", part.id);
    setSaving(false);
    if (error) {
      alert("操作失败: " + error.message);
      return;
    }
    refresh();
  }

  async function handleDelete() {
    if (!canDelete) {
      alert("至少需要保留一个配件分支");
      return;
    }
    if (!confirm("确定删除此配件分支吗？")) return;
    setSaving(true);
    const { error } = await supabase.from("work_order_item_parts").delete().eq("id", part.id);
    setSaving(false);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    refresh();
  }

  async function handleAddBranch() {
    setSaving(true);
    const { error } = await supabase.from("work_order_item_parts").insert({
      work_order_item_id: itemId,
      part_name_id: part.part_name_id || null,
      name: part.name || null,
      unit: part.unit || "件",
      quantity: 1,
      customer_opinion: "pending",
    });
    setSaving(false);
    if (error) {
      alert("添加失败: " + error.message);
      return;
    }
    refresh();
  }

  const partName = part.alias_name || part.parts?.name || part.name || part.part_names?.name || "未命名配件";

  return (
    <div className={`bg-white rounded border border-gray-100 p-2 ${saving ? "opacity-50" : ""}`}>
      {/* 第一行：序号 + 配件名称 + 操作按钮 */}
      <div className="flex items-center flex-wrap gap-1.5">
        <span className="text-xs text-gray-400 font-mono">{seqLabel}</span>
        <span className="font-medium text-gray-800">{partName}</span>
        {part.alias_name && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600">别名</span>
        )}
        {!part.part_id && (
          <span className="text-yellow-700 bg-yellow-50 px-1.5 py-0.5 rounded text-[10px]">空分支</span>
        )}

        {/* 客户意见 */}
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
          part.customer_opinion === "agree"
            ? "bg-green-50 text-green-700"
            : part.customer_opinion === "reject"
            ? "bg-red-50 text-red-700"
            : "bg-gray-50 text-gray-500"
        }`}>
          {part.customer_opinion === "agree" ? "客户同意" : part.customer_opinion === "reject" ? "客户拒绝" : "待确认"}
        </span>

        {!isLocked && (
          <>
            <button
              type="button"
              onClick={handleAddBranch}
              disabled={saving}
              className="text-[10px] text-blue-600 hover:text-blue-700 px-1 disabled:opacity-50"
              title="添加同配件新分支"
            >
              +
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving || !canDelete}
              className={`text-[10px] px-1 disabled:opacity-50 ${
                canDelete ? "text-red-600 hover:text-red-700" : "text-gray-300 cursor-not-allowed"
              }`}
            >
              删除
            </button>
          </>
        )}
      </div>

      {/* 第二行：字段编辑表格 */}
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {/* 配件编码 */}
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">编码</label>
          <input
            type="text"
            value={editForm.part_number}
            onChange={(e) => setEditForm((prev) => ({ ...prev, part_number: e.target.value }))}
            onBlur={() => saveField("part_number", editForm.part_number)}
            disabled={isLocked || saving}
            className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            placeholder="配件编码"
          />
        </div>

        {/* 品牌 */}
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">品牌</label>
          <input
            type="text"
            value={editForm.brand}
            onChange={(e) => setEditForm((prev) => ({ ...prev, brand: e.target.value }))}
            onBlur={() => saveField("brand", editForm.brand)}
            disabled={isLocked || saving}
            className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            placeholder="品牌"
          />
        </div>

        {/* 规格 */}
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">规格</label>
          <input
            type="text"
            value={editForm.specification}
            onChange={(e) => setEditForm((prev) => ({ ...prev, specification: e.target.value }))}
            onBlur={() => saveField("specification", editForm.specification)}
            disabled={isLocked || saving}
            className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            placeholder="规格"
          />
        </div>

        {/* 数量 */}
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">数量</label>
          <span className="text-xs text-gray-700">×{part.quantity}</span>
        </div>

        {/* 采购价 */}
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">采购价</label>
          <input
            type="number"
            step="0.01"
            value={editForm.unit_cost}
            onChange={(e) => setEditForm((prev) => ({ ...prev, unit_cost: e.target.value }))}
            onBlur={() => saveField("unit_cost", editForm.unit_cost)}
            disabled={isLocked || saving}
            className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            placeholder="采购价"
          />
        </div>

        {/* 销售价 */}
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">销售价</label>
          <input
            type="number"
            step="0.01"
            value={editForm.unit_price}
            onChange={(e) => setEditForm((prev) => ({ ...prev, unit_price: e.target.value }))}
            onBlur={() => saveField("unit_price", editForm.unit_price)}
            disabled={isLocked || saving}
            className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            placeholder="销售价"
          />
        </div>
      </div>

      {/* 第三行：采购/到货/供应商 */}
      <div className="mt-2 flex items-center flex-wrap gap-2">
        {/* 采购按钮 */}
        {!isLocked && (
          <button
            type="button"
            onClick={togglePurchase}
            disabled={saving}
            className={`text-[10px] px-2 py-0.5 rounded border disabled:opacity-50 ${
              part.is_purchased
                ? "bg-green-50 text-green-700 border-green-200"
                : part.customer_opinion === "agree" && inventoryQty === 0
                ? "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
            }`}
            title={
              part.is_purchased
                ? "已采购，点击取消"
                : part.customer_opinion !== "agree"
                ? "需客户同意"
                : inventoryQty > 0
                ? "库存不为0"
                : "点击标记已采购"
            }
          >
            {part.is_purchased ? "已采购" : "未采购"}
          </button>
        )}

        {/* 到货按钮 */}
        {!isLocked && (
          <button
            type="button"
            onClick={toggleArrived}
            disabled={saving || !part.is_purchased}
            className={`text-[10px] px-2 py-0.5 rounded border disabled:opacity-50 ${
              part.is_arrived
                ? "bg-green-50 text-green-700 border-green-200"
                : part.is_purchased
                ? "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
            }`}
            title={part.is_arrived ? "已到货，点击取消" : part.is_purchased ? "点击标记已到货" : "需先采购"}
          >
            {part.is_arrived ? "已到货" : "未到货"}
          </button>
        )}

        {/* 供应商选择 */}
        {!isLocked && suppliers.length > 0 && (
          <select
            value={editForm.supplier_name}
            onChange={(e) => {
              setEditForm((prev) => ({ ...prev, supplier_name: e.target.value }));
              saveField("supplier_name", e.target.value);
            }}
            disabled={saving}
            className="text-[10px] px-2 py-0.5 border border-gray-200 rounded disabled:opacity-50"
          >
            <option value="">选择供应商</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        )}

        {/* 库存提示 */}
        {inventoryQty > 0 && (
          <span className="text-[10px] text-gray-400">库存: {inventoryQty}</span>
        )}
      </div>

      {/* 附加内容（如领料/退库/提成/图片等） */}
      {children}
    </div>
  );
}
