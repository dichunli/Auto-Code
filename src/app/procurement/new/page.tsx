"use client";

import { useState, useEffect, useMemo } from "react";
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

interface Supplier {
  id: string;
  name: string;
  recommendation_level: number;
  vehicleMakers: string[];
  vehicleBrands: string[];
  vehicleSeries: string[];
  categoryNames: string[];
  partNameList: string[];
  brandNames: string[];
}

interface PendingBranch {
  id: string;
  name: string;
  part_number: string;
  brand: string;
  specification: string;
  quantity: number;
  plate_number: string;
  vehicle_maker: string;
  vehicle_brand: string;
  vehicle_series: string;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [partNames, setPartNames] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [pendingBranches, setPendingBranches] = useState<PendingBranch[]>([]);

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
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
    // 加载供应商（带关联信息）
    async function loadSuppliers() {
      const { data } = await supabase.from("suppliers").select("*").order("name");
      const baseList = (data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        recommendation_level: s.recommendation_level || 0,
        vehicleMakers: [] as string[],
        vehicleBrands: [] as string[],
        vehicleSeries: [] as string[],
        categoryNames: [] as string[],
        partNameList: [] as string[],
        brandNames: [] as string[],
      }));

      // 尝试加载关联信息（兼容未迁移的情况）
      const map = new Map<string, Supplier>();
      baseList.forEach((s) => map.set(s.id, s));

      try {
        const [{ data: vData }, { data: catData }, { data: pnData }, { data: bData }] = await Promise.all([
          supabase.from("supplier_vehicle_models").select("supplier_id, vehicle_models(厂商,品牌,车系)"),
          supabase.from("supplier_part_categories").select("supplier_id, part_categories(name)"),
          supabase.from("supplier_part_names").select("supplier_id, part_names(name)"),
          supabase.from("supplier_part_brands").select("supplier_id, part_brands(name)"),
        ]);

        (vData || []).forEach((r: any) => {
          const s = map.get(r.supplier_id);
          const vm = r.vehicle_models;
          if (s && vm) {
            if (vm.厂商 && !s.vehicleMakers.includes(vm.厂商)) s.vehicleMakers.push(vm.厂商);
            if (vm.品牌 && !s.vehicleBrands.includes(vm.品牌)) s.vehicleBrands.push(vm.品牌);
            if (vm.车系 && !s.vehicleSeries.includes(vm.车系)) s.vehicleSeries.push(vm.车系);
          }
        });
        (catData || []).forEach((r: any) => {
          const s = map.get(r.supplier_id);
          const name = r.part_categories?.name;
          if (s && name && !s.categoryNames.includes(name)) s.categoryNames.push(name);
        });
        (pnData || []).forEach((r: any) => {
          const s = map.get(r.supplier_id);
          const name = r.part_names?.name;
          if (s && name && !s.partNameList.includes(name)) s.partNameList.push(name);
        });
        (bData || []).forEach((r: any) => {
          const s = map.get(r.supplier_id);
          const name = r.part_brands?.name;
          if (s && name && !s.brandNames.includes(name)) s.brandNames.push(name);
        });
      } catch {
        // 忽略关联表查询错误
      }

      setSuppliers(baseList);
    }

    loadSuppliers();

    supabase.from("parts").select("*, part_names(name, unit)").order("name").then(({ data }) => setParts(data || []));
    supabase.from("part_names").select("*").order("name").then(({ data }) => setPartNames(data || []));
    supabase.from("part_brands").select("*").order("name").then(({ data }) => setBrands(data || []));

    // 获取待采购的工单配件分支（含车辆厂商、品牌、车系）
    supabase
      .from("work_order_item_parts")
      .select("id, name, part_number, brand, specification, quantity, work_order_items!inner(work_orders!inner(plate_number, vehicles(vehicle_models(厂商,品牌,车系))))")
      .is("part_id", null)
      .then(({ data }) => {
        const branches: PendingBranch[] = (data || []).map((b: any) => {
          const vm = b.work_order_items?.work_orders?.vehicles?.vehicle_models;
          return {
            id: b.id,
            name: b.name,
            part_number: b.part_number,
            brand: b.brand,
            specification: b.specification,
            quantity: b.quantity,
            plate_number: b.work_order_items?.work_orders?.plate_number || "",
            vehicle_maker: vm?.厂商 || "",
            vehicle_brand: vm?.品牌 || "",
            vehicle_series: vm?.车系 || "",
          };
        });
        setPendingBranches(branches);
      });
  }, [supabase]);

  // 根据所选配件分支的车辆信息排序供应商
  // 匹配规则：供应商关联的车型中，厂商/品牌/车系任意一项匹配即可
  const sortedSuppliers = useMemo(() => {
    if (!selectedBranchId) return suppliers;
    const selectedBranch = pendingBranches.find((b) => b.id === selectedBranchId);
    if (!selectedBranch) return suppliers;

    const vm = selectedBranch;

    return [...suppliers].sort((a, b) => {
      const aMatch =
        (vm.vehicle_maker && a.vehicleMakers.includes(vm.vehicle_maker)) ||
        (vm.vehicle_brand && a.vehicleBrands.includes(vm.vehicle_brand)) ||
        (vm.vehicle_series && a.vehicleSeries.includes(vm.vehicle_series));
      const bMatch =
        (vm.vehicle_maker && b.vehicleMakers.includes(vm.vehicle_maker)) ||
        (vm.vehicle_brand && b.vehicleBrands.includes(vm.vehicle_brand)) ||
        (vm.vehicle_series && b.vehicleSeries.includes(vm.vehicle_series));
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      // 都匹配或都不匹配时，按推荐等级降序
      return b.recommendation_level - a.recommendation_level;
    });
  }, [suppliers, selectedBranchId, pendingBranches]);

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
      setSelectedBranchId("");
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
    setSelectedBranchId(branchId);
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

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

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
              {sortedSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.recommendation_level > 0 ? ` ${"⭐".repeat(s.recommendation_level)}` : ""}
                </option>
              ))}
            </select>

            {/* 供应商详情 */}
            {selectedSupplier && (
              <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs space-y-1">
                {selectedSupplier.recommendation_level > 0 && (
                  <div>
                    <span className="text-gray-500">推荐等级：</span>
                    <span className="text-amber-500">{"⭐".repeat(selectedSupplier.recommendation_level)}</span>
                  </div>
                )}
                {(selectedSupplier.vehicleMakers.length + selectedSupplier.vehicleBrands.length + selectedSupplier.vehicleSeries.length) > 0 && (
                  <div>
                    <span className="text-gray-500">关联车型：</span>
                    <span className="text-gray-700">
                      {[...selectedSupplier.vehicleMakers, ...selectedSupplier.vehicleBrands, ...selectedSupplier.vehicleSeries].join("、")}
                    </span>
                  </div>
                )}
                {selectedSupplier.categoryNames.length > 0 && (
                  <div>
                    <span className="text-gray-500">配件分类：</span>
                    <span className="text-gray-700">{selectedSupplier.categoryNames.join("、")}</span>
                  </div>
                )}
                {selectedSupplier.brandNames.length > 0 && (
                  <div>
                    <span className="text-gray-500">配件品牌：</span>
                    <span className="text-gray-700">{selectedSupplier.brandNames.join("、")}</span>
                  </div>
                )}
                {selectedSupplier.vehicleMakers.length === 0 && selectedSupplier.vehicleBrands.length === 0 && selectedSupplier.vehicleSeries.length === 0 && selectedSupplier.categoryNames.length === 0 && selectedSupplier.brandNames.length === 0 && selectedSupplier.recommendation_level === 0 && (
                  <span className="text-gray-400">暂无扩展信息</span>
                )}
              </div>
            )}

            {/* 智能排序提示 */}
            {selectedBranchId && (
              <div className="mt-2 text-xs text-blue-600">
                {(() => {
                  const branch = pendingBranches.find((b) => b.id === selectedBranchId);
                  if (!branch) return "已按推荐等级排序供应商";
                  const targets = [branch.vehicle_maker, branch.vehicle_brand, branch.vehicle_series].filter(Boolean);
                  if (targets.length === 0) return "已按推荐等级排序供应商";

                  const matchCount = suppliers.filter((s) => {
                    if (branch.vehicle_maker && s.vehicleMakers.includes(branch.vehicle_maker)) return true;
                    if (branch.vehicle_brand && s.vehicleBrands.includes(branch.vehicle_brand)) return true;
                    if (branch.vehicle_series && s.vehicleSeries.includes(branch.vehicle_series)) return true;
                    return false;
                  }).length;

                  if (matchCount > 0) {
                    return `厂商/品牌/车系匹配「${targets.join("/")}」的供应商优先展示（${matchCount}家）`;
                  }
                  return `当前无供应商匹配「${targets.join("/")}」，已按推荐等级排序`;
                })()}
              </div>
            )}
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
                          {b.name} ({b.part_number || "无编号"}) - {b.plate_number || "无车牌"}
                          {[b.vehicle_maker, b.vehicle_brand, b.vehicle_series].filter(Boolean).length > 0
                            ? ` [${[b.vehicle_maker, b.vehicle_brand, b.vehicle_series].filter(Boolean).join(" ")}]`
                            : ""}
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
