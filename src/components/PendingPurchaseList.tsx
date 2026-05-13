"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

interface PartBranchRow {
  id: string;
  name: string;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number;
  unit_cost: number | null;
  unit_price: number | null;
  customer_opinion: string | null;
  supplier_name: string | null;
  part_id: string | null;
  part_number: string | null;
  work_order_item_id: string;
  work_order_items: {
    name: string;
    work_orders: {
      id: string;
      order_no: string;
      settled_at: string | null;
      order_type: string | null;
      customers: { name: string } | null;
      vehicles: { plate_number: string } | null;
    } | null;
  } | null;
  parts: { quantity: number | null } | null;
}

interface Supplier {
  id: string;
  name: string;
}

export function PendingPurchaseList() {
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState<PartBranchRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [supplierMap, setSupplierMap] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [{ data: parts }, { data: sups }] = await Promise.all([
      supabase
        .from("work_order_item_parts")
        .select(`
          id, name, brand, specification, unit, quantity, unit_cost, unit_price,
          customer_opinion, supplier_name, part_id, part_number,
          work_order_item_id,
          work_order_items(
            name,
            work_orders(
              id, order_no, settled_at, order_type,
              customers(name),
              vehicles(plate_number)
            )
          ),
          parts(quantity)
        `)
        .eq("customer_opinion", "agree")
        .eq("is_purchased", false)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("suppliers").select("id, name").order("name"),
    ]);

    const filtered = ((parts || []) as unknown as PartBranchRow[]).filter((r) => {
      const wo = r.work_order_items?.work_orders;
      if (!wo) return false;
      if (wo.settled_at) return false;
      if (wo.order_type === "cancelled") return false;
      const cost = Number(r.unit_cost || 0);
      const price = Number(r.unit_price || 0);
      if (cost <= 0 || price <= 0) return false;
      const inventoryQty = Number(r.parts?.quantity || 0);
      // 库存 0 才算待采购,有库存的属于待领料
      if (r.part_id && inventoryQty > 0) return false;
      return true;
    });

    // 初始化 supplierMap:有 supplier_name 的尝试匹配 suppliers 表
    const sMap: Record<string, string> = {};
    (sups || []).forEach((s: any) => {
      // 不在这里做 supplier_name → id 的匹配,留给用户在 UI 选
    });
    setSupplierMap(sMap);

    setRows(filtered);
    setSuppliers(sups || []);
    setLoading(false);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  function setRowSupplier(rowId: string, supplierId: string) {
    setSupplierMap((prev) => ({ ...prev, [rowId]: supplierId }));
  }

  async function handleCreatePurchases() {
    const selectedRows = rows.filter((r) => selected.has(r.id));
    if (selectedRows.length === 0) {
      alert("请先勾选要采购的配件");
      return;
    }

    // 校验每行都选了供应商
    const missingSupplier = selectedRows.find((r) => !supplierMap[r.id]);
    if (missingSupplier) {
      alert(`请为每一条选中行选择供应商(配件: ${missingSupplier.name})`);
      return;
    }

    if (!confirm(`将为 ${selectedRows.length} 条配件按供应商分组生成采购单,是否继续?`)) {
      return;
    }

    setSubmitting(true);
    try {
      // 按供应商分组
      const groups: Record<string, PartBranchRow[]> = {};
      selectedRows.forEach((r) => {
        const sid = supplierMap[r.id];
        if (!groups[sid]) groups[sid] = [];
        groups[sid].push(r);
      });

      const supplierIds = Object.keys(groups);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      let createdCount = 0;

      for (let idx = 0; idx < supplierIds.length; idx++) {
        const sid = supplierIds[idx];
        const items = groups[sid];
        const totalAmount = items.reduce(
          (sum, it) => sum + Number(it.unit_cost || 0) * Number(it.quantity || 0),
          0
        );
        const randomStr = Math.floor(1000 + Math.random() * 9000);
        const orderNo = `CG-${dateStr}-${randomStr}`;

        const { data: order, error: orderErr } = await supabase
          .from("purchase_orders")
          .insert({
            order_no: orderNo,
            supplier_id: sid,
            status: "draft",
            total_amount: totalAmount,
            notes: "由「待采购」批量生成",
          })
          .select("id")
          .single();

        if (orderErr || !order) throw orderErr || new Error("创建采购单失败");

        const itemInserts = items.map((it) => ({
          order_id: order.id,
          part_id: it.part_id,
          part_number: it.part_number,
          name: it.name,
          brand: it.brand,
          specification: it.specification,
          quantity: it.quantity,
          unit_cost: it.unit_cost,
          work_order_item_part_id: it.id,
        }));

        const { error: itemErr } = await supabase.from("purchase_order_items").insert(itemInserts);
        if (itemErr) throw itemErr;

        // 标记分支已采购
        const branchIds = items.map((it) => it.id);
        const { error: updErr } = await supabase
          .from("work_order_item_parts")
          .update({ is_purchased: true, supplier_name: suppliers.find((s) => s.id === sid)?.name || null })
          .in("id", branchIds);
        if (updErr) throw updErr;

        createdCount++;
      }

      alert(`已生成 ${createdCount} 张采购单(草稿状态),请到「采购订单」中审批并发出。`);
      router.push("/procurement/orders");
    } catch (err: any) {
      alert("发起采购失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-12">加载中...</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900">
            待采购
            <span className="ml-2 text-xs font-normal text-gray-500">共 {rows.length} 条</span>
          </h3>
          {selected.size > 0 && (
            <span className="text-xs text-blue-600">已选 {selected.size} 条</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleCreatePurchases}
          disabled={selected.size === 0 || submitting}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {submitting ? "生成中..." : "发起采购"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 text-left font-medium text-gray-500 w-10">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">工单号</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">客户/车牌</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">项目</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">配件</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">数量</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">采购价</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">销售价</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">供应商 *</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => {
              const wo = row.work_order_items?.work_orders!;
              const isChecked = selected.has(row.id);
              return (
                <tr key={row.id} className={isChecked ? "bg-blue-50" : "hover:bg-gray-50"}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(row.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/work-orders/${wo.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                      {wo.order_no}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-gray-700">
                    <div>{wo.customers?.name || "-"}</div>
                    <div className="text-xs text-gray-500">{wo.vehicles?.plate_number || "-"}</div>
                  </td>
                  <td className="px-3 py-3 text-gray-700">{row.work_order_items?.name || "-"}</td>
                  <td className="px-3 py-3">
                    <div className="text-gray-900">{row.name}</div>
                    <div className="text-xs text-gray-400">{row.brand || ""} {row.specification || ""}</div>
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    {row.quantity} {row.unit || "件"}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    ¥{Number(row.unit_cost || 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    ¥{Number(row.unit_price || 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={supplierMap[row.id] || ""}
                      onChange={(e) => setRowSupplier(row.id, e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                    >
                      <option value="">{row.supplier_name || "请选择"}</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                  暂无待采购的配件
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
