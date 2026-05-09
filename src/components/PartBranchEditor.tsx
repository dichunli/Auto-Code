"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function toFixed2(val: string | number | null | undefined): string {
  if (val === "" || val === null || val === undefined) return "";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "";
  return num.toFixed(2);
}

interface Props {
  part: any;
  itemId: string;
  inventoryQty: number;
  suppliers: any[];
  seqLabel: string;
  canDelete: boolean;
  isLocked: boolean;
  siblingIds?: string[];
  vehicleModelId?: string;
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
  siblingIds = [],
  vehicleModelId,
  children,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const clickTimer = useRef<NodeJS.Timeout | null>(null);

  function refresh() {
    router.refresh();
  }

  // 本地状态（乐观更新）
  const [localSelected, setLocalSelected] = useState(part.is_selected || false);
  const [localPurchased, setLocalPurchased] = useState(part.is_purchased || false);
  const [localArrived, setLocalArrived] = useState(part.is_arrived || false);
  const [localOpinion, setLocalOpinion] = useState(part.customer_opinion || "pending");

  useEffect(() => {
    setLocalSelected(part.is_selected || false);
    setLocalPurchased(part.is_purchased || false);
    setLocalArrived(part.is_arrived || false);
    setLocalOpinion(part.customer_opinion || "pending");
  }, [part.is_selected, part.is_purchased, part.is_arrived, part.customer_opinion]);

  // 只有一个分支时默认选中
  useEffect(() => {
    if (!canDelete && !part.is_selected) {
      supabase.from("work_order_item_parts").update({ is_selected: true }).eq("id", part.id).then(({ error }) => {
        if (!error) refresh();
      });
    }
  }, []);

  // 字段编辑状态
  const [editForm, setEditForm] = useState({
    part_number: part.part_number || "",
    brand: part.brand || "",
    specification: part.specification || "",
    unit_cost: toFixed2(part.unit_cost),
    cost_price: toFixed2(part.cost_price),
    unit_price: toFixed2(part.unit_price),
    supplier_name: part.supplier_name || "",
    quantity: part.quantity != null ? String(part.quantity) : "1",
    document_name: part.document_name || part.parts?.document_name || "",
  });

  // 系统中关联的编码、品牌和规格列表
  const [availablePartNumbers, setAvailablePartNumbers] = useState<string[]>([]);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [availableSpecs, setAvailableSpecs] = useState<string[]>([]);

  useEffect(() => {
    if (!part.part_name_id) return;
    supabase.from("parts").select("part_number, brand_id, specification_id").eq("part_name_id", part.part_name_id).then(({ data }) => {
      if (!data) return;
      const partNumbers = [...new Set(data.map((p: any) => p.part_number).filter(Boolean))];
      const brandIds = [...new Set(data.map((p: any) => p.brand_id).filter(Boolean))];
      const specIds = [...new Set(data.map((p: any) => p.specification_id).filter(Boolean))];
      setAvailablePartNumbers(partNumbers);
      Promise.all([
        brandIds.length > 0 ? supabase.from("part_brands").select("name").in("id", brandIds) : Promise.resolve({ data: [] }),
        specIds.length > 0 ? supabase.from("part_specifications").select("name").in("id", specIds) : Promise.resolve({ data: [] }),
      ]).then(([brandsRes, specsRes]) => {
        setAvailableBrands((brandsRes.data || []).map((b: any) => b.name));
        setAvailableSpecs((specsRes.data || []).map((s: any) => s.name));
      });
    });
  }, [part.part_name_id, supabase]);

  async function saveField(field: string, value: string) {
    setSaving(true);
    const updateData: Record<string, any> = {};
    if (field === "unit_cost" || field === "unit_price" || field === "cost_price") {
      updateData[field] = value === "" ? null : parseFloat(value);
    } else if (field === "quantity") {
      updateData[field] = value === "" ? 1 : parseInt(value, 10);
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

    // 价格字段保存成功后格式化为两位小数
    if (field === "unit_cost" || field === "unit_price" || field === "cost_price") {
      setEditForm((prev) => ({ ...prev, [field]: toFixed2(updateData[field]) }));
    }

    // 影响小计的字段，广播给小计/费用合计组件
    if (field === "unit_price" || field === "quantity") {
      window.dispatchEvent(
        new CustomEvent("wo-part-update", {
          detail: {
            itemId,
            partId: part.id,
            ...(field === "unit_price" ? { unit_price: updateData.unit_price ?? 0 } : {}),
            ...(field === "quantity" ? { quantity: updateData.quantity ?? 1 } : {}),
          },
        })
      );
    }
  }

  // 通过编码自动填充配件信息
  async function autoFillByPartNumber(partNumber: string) {
    if (!partNumber || !part.part_name_id) return;
    const { data } = await supabase
      .from("parts")
      .select("id, brand_id, specification_id, unit_cost, unit_price, document_name, part_brands(name), part_specifications(name)")
      .eq("part_name_id", part.part_name_id)
      .eq("part_number", partNumber)
      .maybeSingle();
    if (!data) return;

    const newBrand = data.part_brands?.name || "";
    const newSpec = data.part_specifications?.name || "";
    const newDocName = data.document_name || "";
    setEditForm((prev) => ({
      ...prev,
      brand: newBrand,
      specification: newSpec,
      unit_cost: data.unit_cost != null ? toFixed2(data.unit_cost) : prev.unit_cost,
      unit_price: data.unit_price != null ? toFixed2(data.unit_price) : prev.unit_price,
      document_name: newDocName || prev.document_name,
    }));

    setSaving(true);
    const { error } = await supabase.from("work_order_item_parts").update({
      brand: newBrand || null,
      specification: newSpec || null,
      unit_cost: data.unit_cost,
      unit_price: data.unit_price,
      document_name: newDocName || null,
      part_id: data.id,
    }).eq("id", part.id);
    setSaving(false);
    if (error) {
      alert("自动填充失败: " + error.message);
    }
  }

  // 检查库存中是否有完全匹配的配件
  async function checkInventoryMatch() {
    if (!vehicleModelId || !part.part_name_id) return;
    if (!editForm.brand || !editForm.specification) return;

    // 查找品牌ID
    const { data: brandData } = await supabase.from("part_brands").select("id").eq("name", editForm.brand).single();
    if (!brandData) return;

    // 查找规格ID
    const { data: specData } = await supabase.from("part_specifications").select("id").eq("name", editForm.specification).single();
    if (!specData) return;

    // 查询parts表匹配配件名称+品牌+规格
    const { data: partsData } = await supabase
      .from("parts")
      .select("id, part_number, unit_cost, unit_price, part_vehicle_models(vehicle_model_id)")
      .eq("part_name_id", part.part_name_id)
      .eq("brand_id", brandData.id)
      .eq("specification_id", specData.id);

    if (!partsData || partsData.length === 0) return;

    // 过滤车型匹配的（无车型限制也算匹配）
    const matched = partsData.find((p: any) =>
      !p.part_vehicle_models || p.part_vehicle_models.length === 0 ||
      p.part_vehicle_models.some((vm: any) => vm.vehicle_model_id === vehicleModelId)
    );

    if (matched) {
      if (confirm("找到相同配件是否选择？")) {
        setSaving(true);
        const { error } = await supabase
          .from("work_order_item_parts")
          .update({ part_id: matched.id, part_number: matched.part_number || editForm.part_number })
          .eq("id", part.id);
        setSaving(false);
        if (error) {
          alert("关联失败: " + error.message);
          return;
        }
        // 自动填充价格和编码
        if (matched.unit_cost != null) setEditForm((prev) => ({ ...prev, unit_cost: toFixed2(matched.unit_cost) }));
        if (matched.unit_price != null) setEditForm((prev) => ({ ...prev, unit_price: toFixed2(matched.unit_price) }));
        if (matched.part_number) setEditForm((prev) => ({ ...prev, part_number: matched.part_number }));
        refresh();
      }
    }
  }

  async function togglePurchase() {
    if (!localOpinion || localOpinion !== "agree") {
      alert("需客户同意后才能采购");
      return;
    }
    if (!localPurchased && inventoryQty > 0) {
      alert("库存不为0，无需采购");
      return;
    }
    const next = !localPurchased;
    setLocalPurchased(next);
    setSaving(true);
    const { error } = await supabase
      .from("work_order_item_parts")
      .update({ is_purchased: next })
      .eq("id", part.id);
    setSaving(false);
    if (error) {
      alert("操作失败: " + error.message);
      setLocalPurchased(!next);
      return;
    }
  }

  async function toggleArrived() {
    if (!localPurchased) {
      alert("需先采购后才能标记到货");
      return;
    }
    const next = !localArrived;
    setLocalArrived(next);
    setSaving(true);
    const { error } = await supabase
      .from("work_order_item_parts")
      .update({ is_arrived: next })
      .eq("id", part.id);
    setSaving(false);
    if (error) {
      alert("操作失败: " + error.message);
      setLocalArrived(!next);
      return;
    }
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

  const partName = part.alias_name || part.parts?.name || part.name || part.part_names?.name || "未命名配件";

  return (
    <div className={`bg-white rounded border border-gray-100 p-2 ${saving ? "opacity-50" : ""}`}>
      {/* 所有内容一行显示 */}
      <div className="flex items-center flex-nowrap gap-x-3 gap-y-1 overflow-x-auto">
        {/* 选中（单选：空心圆带点） */}
        <label className={`relative w-4 h-4 cursor-pointer ${isLocked || saving ? "opacity-50" : ""}`}>
          <input
            type="checkbox"
            checked={localSelected}
            onChange={async () => {
              const next = !localSelected;
              setLocalSelected(next);
              setSaving(true);
              // 单选：选中当前时，取消同组其他分支的选中状态
              if (next && siblingIds.length > 0) {
                await supabase.from("work_order_item_parts").update({ is_selected: false }).in("id", siblingIds);
              }
              const { error } = await supabase.from("work_order_item_parts").update({ is_selected: next }).eq("id", part.id);
              setSaving(false);
              if (error) {
                alert("操作失败: " + error.message);
                setLocalSelected(!next);
                return;
              }
              // 广播给小计/费用合计组件
              window.dispatchEvent(
                new CustomEvent("wo-part-update", {
                  detail: {
                    itemId,
                    partId: part.id,
                    is_selected: next,
                    siblingResetIds: next ? siblingIds : [],
                  },
                })
              );
            }}
            disabled={isLocked || saving}
            className="peer sr-only"
          />
          <span className="absolute inset-0 rounded-full border-2 border-gray-300 peer-checked:border-blue-600 bg-white flex items-center justify-center transition-colors">
            <span className="w-2 h-2 rounded-full bg-blue-600 opacity-0 peer-checked:opacity-100 transition-opacity" />
          </span>
        </label>

        {/* 序号 */}
        <span className="text-xs text-gray-400 font-mono">{seqLabel}</span>

        {/* 配件名称 */}
        <span className="font-medium text-gray-800">{partName}</span>
        {part.alias_name && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600">别名</span>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400">单据</span>
          <input
            type="text"
            value={editForm.document_name}
            onChange={(e) => setEditForm((prev) => ({ ...prev, document_name: e.target.value }))}
            onBlur={() => saveField("document_name", editForm.document_name)}
            disabled={isLocked || saving}
            className="w-28 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            placeholder="采购单名称"
          />
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${inventoryQty > 0 ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
          库存: {inventoryQty}
        </span>

        {/* 编码（可输入选择） */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[2.5em] text-right">编码</span>
          <input
            type="text"
            list={`pn-list-${part.id}`}
            value={editForm.part_number}
            onChange={(e) => setEditForm((prev) => ({ ...prev, part_number: e.target.value }))}
            onBlur={async () => {
              await saveField("part_number", editForm.part_number);
              if (editForm.part_number && availablePartNumbers.includes(editForm.part_number)) {
                await autoFillByPartNumber(editForm.part_number);
              }
            }}
            disabled={isLocked || saving}
            className="w-24 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            placeholder="配件编码"
          />
          {availablePartNumbers.length > 0 && (
            <datalist id={`pn-list-${part.id}`}>
              {availablePartNumbers.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          )}
        </div>

        {/* 品牌 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[2.5em] text-right">品牌</span>
          {availableBrands.length > 0 ? (
            <select
              value={editForm.brand}
              onChange={async (e) => {
                const val = e.target.value;
                setEditForm((prev) => ({ ...prev, brand: val }));
                await saveField("brand", val);
                await checkInventoryMatch();
              }}
              disabled={isLocked || saving}
              className="w-20 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            >
              <option value="">选择品牌</option>
              {availableBrands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={editForm.brand}
              onChange={(e) => setEditForm((prev) => ({ ...prev, brand: e.target.value }))}
              onBlur={async () => {
                await saveField("brand", editForm.brand);
                await checkInventoryMatch();
              }}
              disabled={isLocked || saving}
              className="w-20 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
              placeholder="品牌"
            />
          )}
        </div>

        {/* 规格 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[2.5em] text-right">规格</span>
          {availableSpecs.length > 0 ? (
            <select
              value={editForm.specification}
              onChange={async (e) => {
                const val = e.target.value;
                setEditForm((prev) => ({ ...prev, specification: val }));
                await saveField("specification", val);
                await checkInventoryMatch();
              }}
              disabled={isLocked || saving}
              className="w-24 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            >
              <option value="">选择规格</option>
              {availableSpecs.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={editForm.specification}
              onChange={(e) => setEditForm((prev) => ({ ...prev, specification: e.target.value }))}
              onBlur={async () => {
                await saveField("specification", editForm.specification);
                await checkInventoryMatch();
              }}
              disabled={isLocked || saving}
              className="w-24 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
              placeholder="规格"
            />
          )}
        </div>

        {/* 采购价 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[3em] text-right">采购价</span>
          <input
            type="number"
            step="0.01"
            value={editForm.unit_cost}
            onChange={(e) => setEditForm((prev) => ({ ...prev, unit_cost: e.target.value }))}
            onBlur={() => saveField("unit_cost", editForm.unit_cost)}
            disabled={isLocked || saving}
            className="w-16 px-1 py-0.5 border border-gray-200 rounded text-xs text-right disabled:bg-gray-50"
            placeholder="采购价"
          />
        </div>

        {/* 成本价 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[3em] text-right">成本价</span>
          <input
            type="number"
            step="0.01"
            value={editForm.cost_price}
            onChange={(e) => setEditForm((prev) => ({ ...prev, cost_price: e.target.value }))}
            onBlur={() => saveField("cost_price", editForm.cost_price)}
            disabled={isLocked || saving}
            className="w-16 px-1 py-0.5 border border-gray-200 rounded text-xs text-right disabled:bg-gray-50"
            placeholder="成本价"
          />
        </div>

        {/* 销售价 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[3em] text-right">销售价</span>
          <input
            type="number"
            step="0.01"
            value={editForm.unit_price}
            onChange={(e) => setEditForm((prev) => ({ ...prev, unit_price: e.target.value }))}
            onBlur={() => saveField("unit_price", editForm.unit_price)}
            disabled={isLocked || saving}
            className="w-16 px-1 py-0.5 border border-gray-200 rounded text-xs text-right disabled:bg-gray-50"
            placeholder="销售价"
          />
        </div>

        {/* 客户意见 */}
        {/* 客户意见 */}
        <span className="text-[10px] text-gray-400">客户意见:</span>
        {!isLocked ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (clickTimer.current) {
                clearTimeout(clickTimer.current);
                clickTimer.current = null;
                return;
              }
              clickTimer.current = setTimeout(() => {
                clickTimer.current = null;
                // 单击: 同意 / 取消同意
                const next = localOpinion === "agree" ? "pending" : "agree";
                setLocalOpinion(next);
                setSaving(true);
                supabase.from("work_order_item_parts").update({ customer_opinion: next }).eq("id", part.id).then(({ error }) => {
                  setSaving(false);
                  if (error) {
                    alert("保存失败: " + error.message);
                    setLocalOpinion(part.customer_opinion || "pending");
                  }
                });
              }, 250);
            }}
            onDoubleClick={() => {
              if (clickTimer.current) {
                clearTimeout(clickTimer.current);
                clickTimer.current = null;
              }
              // 双击: 拒绝 / 取消拒绝
              const next = localOpinion === "reject" ? "pending" : "reject";
              setLocalOpinion(next);
              setSaving(true);
              supabase.from("work_order_item_parts").update({ customer_opinion: next }).eq("id", part.id).then(({ error }) => {
                setSaving(false);
                if (error) {
                  alert("保存失败: " + error.message);
                  setLocalOpinion(part.customer_opinion || "pending");
                }
              });
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-50 cursor-pointer select-none ${
              localOpinion === "agree"
                ? "bg-green-50 text-green-700 border-green-200"
                : localOpinion === "reject"
                ? "bg-red-50 text-red-700 border-red-200"
                : "bg-yellow-50 text-yellow-700 border-yellow-200"
            }`}
          >
            {localOpinion === "agree" ? "客户同意" : localOpinion === "reject" ? "客户拒绝" : "待确认"}
          </button>
        ) : (
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
            part.customer_opinion === "agree"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}>
            {part.customer_opinion === "agree" ? "客户同意" : part.customer_opinion === "reject" ? "客户拒绝" : "待确认"}
          </span>
        )}

        {/* 是否采购 */}
        {!isLocked && (
          <button
            type="button"
            onClick={togglePurchase}
            disabled={saving}
            className={`text-[10px] px-2 py-0.5 rounded border disabled:opacity-50 ${
              localPurchased
                ? "bg-green-50 text-green-700 border-green-200"
                : localOpinion === "agree" && inventoryQty === 0
                ? "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
            }`}
            title={
              localPurchased
                ? "已采购，点击取消"
                : localOpinion !== "agree"
                ? "需客户同意"
                : inventoryQty > 0
                ? "库存不为0"
                : "点击标记已采购"
            }
          >
            {localPurchased ? "已采购" : "未采购"}
          </button>
        )}

        {/* 是否到货 */}
        {!isLocked && (
          <button
            type="button"
            onClick={toggleArrived}
            disabled={saving || !localPurchased}
            className={`text-[10px] px-2 py-0.5 rounded border disabled:opacity-50 ${
              localArrived
                ? "bg-green-50 text-green-700 border-green-200"
                : localPurchased
                ? "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
            }`}
            title={localArrived ? "已到货，点击取消" : localPurchased ? "点击标记已到货" : "需先采购"}
          >
            {localArrived ? "已到货" : "未到货"}
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

        {/* 删除 */}
        {!isLocked && (
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
        )}

        {children}
      </div>
    </div>
  );
}
