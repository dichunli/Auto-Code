"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface LineItem {
  id: string;
  part_id: string;
  part_name_id: string;
  part_number: string;
  name: string;
  brand: string;
  specification: string;
  quantity: string;
  unit_cost: string;
  work_order_item_part_id: string;
  notes: string;
  isNewPart: boolean;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [partNames, setPartNames] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [pendingBranches, setPendingBranches] = useState<any[]>([]);

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    {
      id: crypto.randomUUID(),
      part_id: "",
      part_name_id: "",
      part_number: "",
      name: "",
      brand: "",
      specification: "",
      quantity: "1",
      unit_cost: "",
      work_order_item_part_id: "",
      notes: "",
      isNewPart: false,
    },
  ]);

  useEffect(() => {
    supabase.from("suppliers").select("*").order("name").then(({ data }) => setSuppliers(data || []));
    supabase.from("parts").select("*, part_names(name, unit)").order("name").then(({ data }) => setParts(data || []));
    supabase.from("part_names").select("*").order("name").then(({ data }) => setPartNames(data || []));
    supabase.from("part_brands").select("*").order("name").then(({ data }) => setBrands(data || []));

    // 获取待采购的工单配件分支
    supabase
      .from("work_order_item_parts")
      .select("id, name, part_number, brand, specification, quantity, work_order_items!inner(work_orders!inner(plate_number))")
      .is("part_id", null)
      .then(({ data }) => {
        setPendingBranches(data || []);
      });
  }, [supabase]);

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        part_id: "",
        part_name_id: "",
        part_number: "",
        name: "",
        brand: "",
        specification: "",
        quantity: "1",
        unit_cost: "",
        work_order_item_part_id: "",
        notes: "",
        isNewPart: false,
      },
    ]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateItem(id: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function handleSelectPart(itemId: string, partId: string) {
    const part = parts.find((p) => p.id === partId);
    if (!part) return;
    updateItem(itemId, {
      part_id: partId,
      part_name_id: part.part_name_id || "",
      part_number: part.part_number || "",
      name: part.name || "",
      brand: part.part_brands?.name || "",
      specification: part.specification_text || "",
      unit_cost: part.unit_cost ? String(part.unit_cost) : "",
      isNewPart: false,
    });
  }

  function handleSelectBranch(itemId: string, branchId: string) {
    const branch = pendingBranches.find((b) => b.id === branchId);
    if (!branch) {
      updateItem(itemId, { work_order_item_part_id: "", name: "", part_number: "", brand: "", specification: "" });
      return;
    }
    updateItem(itemId, {
      work_order_item_part_id: branchId,
      name: branch.name || "",
      part_number: branch.part_number || "",
      brand: branch.brand || "",
      specification: branch.specification || "",
      quantity: String(branch.quantity || 1),
    });
  }

  const totalAmount = items.reduce((sum, item) => {
    const qty = parseInt(item.quantity) || 0;
    const cost = parseFloat(item.unit_cost) || 0;
    return sum + qty * cost;
  }, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      alert("请选择供应商");
      return;
    }
    if (items.length === 0 || items.some((i) => !i.name || !i.quantity)) {
      alert("请完善采购项目信息");
      return;
    }

    setLoading(true);

    try {
      // 生成订单号：CG-YYYYMMDD-XXXX
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const randomStr = Math.floor(1000 + Math.random() * 9000);
      const orderNo = `CG-${dateStr}-${randomStr}`;

      const { data: order, error: orderError } = await supabase
        .from("purchase_orders")
        .insert({
          order_no: orderNo,
          supplier_id: supplierId,
          status: "submitted",
          total_amount: totalAmount,
          notes: notes || null,
        })
        .select("id")
        .single();

      if (orderError || !order) throw orderError || new Error("创建采购单失败");

      const orderItems = items.map((item) => ({
        order_id: order.id,
        part_id: item.part_id || null,
        part_name_id: item.part_name_id || null,
        part_number: item.part_number || null,
        name: item.name,
        brand: item.brand || null,
        specification: item.specification || null,
        quantity: parseInt(item.quantity) || 1,
        unit_cost: parseFloat(item.unit_cost) || 0,
        received_qty: 0,
        work_order_item_part_id: item.work_order_item_part_id || null,
        notes: item.notes || null,
      }));

      const { error: itemsError } = await supabase.from("purchase_order_items").insert(orderItems);
      if (itemsError) throw itemsError;

      router.push("/procurement");
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="新建采购订单" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl space-y-6">
        {/* 基本信息 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">供应商 *</label>
            <select
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">请选择</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="采购单备注"
            />
          </div>
        </div>

        {/* 采购项目 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">采购项目</h3>
            <button
              type="button"
              onClick={addItem}
              className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
            >
              + 添加一行
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={item.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">第 {idx + 1} 项</span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      删除
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">关联工单配件（可选）</label>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={item.work_order_item_part_id}
                      onChange={(e) => handleSelectBranch(item.id, e.target.value)}
                    >
                      <option value="">不关联工单</option>
                      {pendingBranches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.part_number || "无编号"}) - {b.work_order_items?.work_orders?.plate_number || "无车牌"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">选择现有配件</label>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={item.part_id}
                      onChange={(e) => handleSelectPart(item.id, e.target.value)}
                    >
                      <option value="">手工输入</option>
                      {parts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.part_number} - {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">配件名称 *</label>
                    <input
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={item.name}
                      onChange={(e) => updateItem(item.id, { name: e.target.value })}
                      placeholder="配件名称"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">配件编号</label>
                    <input
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={item.part_number}
                      onChange={(e) => updateItem(item.id, { part_number: e.target.value })}
                      placeholder="编号"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">品牌</label>
                    <input
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={item.brand}
                      onChange={(e) => updateItem(item.id, { brand: e.target.value })}
                      placeholder="品牌"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">规格</label>
                    <input
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={item.specification}
                      onChange={(e) => updateItem(item.id, { specification: e.target.value })}
                      placeholder="规格"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">数量 *</label>
                    <input
                      required
                      type="number"
                      min="1"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={item.quantity}
                      onChange={(e) => updateItem(item.id, { quantity: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">单价</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={item.unit_cost}
                      onChange={(e) => updateItem(item.id, { unit_cost: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">小计</label>
                    <div className="px-3 py-2 text-sm text-gray-900 font-medium">
                      ¥{((parseInt(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0)).toFixed(2)}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">行备注</label>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={item.notes}
                    onChange={(e) => updateItem(item.id, { notes: e.target.value })}
                    placeholder="如：急件、指定品牌等"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 合计 */}
        <div className="flex justify-end border-t border-gray-100 pt-4">
          <div className="text-right">
            <div className="text-sm text-gray-500">合计金额</div>
            <div className="text-xl font-bold text-gray-900">¥{totalAmount.toFixed(2)}</div>
          </div>
        </div>

        {/* 操作 */}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "保存中..." : "提交采购单"}
          </button>
        </div>
      </form>
    </div>
  );
}
