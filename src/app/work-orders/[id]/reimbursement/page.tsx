"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

export default function ReimbursementPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [orderId, setOrderId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<any>(null);

  const [reimbursementId, setReimbursementId] = useState<string | null>(null);
  const [title, setTitle] = useState("维修费用报销单");
  const [companyName, setCompanyName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<
    { id?: string; name: string; spec: string; quantity: number; unit_price: number; total_price: number }[]
  >([]);

  useEffect(() => {
    params.then((p) => setOrderId(p.id));
  }, [params]);

  const loadData = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);

    const { data: orderData } = await supabase
      .from("work_orders")
      .select("*, vehicles(*, vehicle_models(*)), customers(*), profiles!work_orders_receptionist_id_fkey(full_name)")
      .eq("id", orderId)
      .single();

    setOrder(orderData);

    // 查找是否已有报销单
    const { data: existing } = await supabase
      .from("work_order_reimbursements")
      .select("*, work_order_reimbursement_items(*)")
      .eq("work_order_id", orderId)
      .single();

    if (existing) {
      setReimbursementId(existing.id);
      setTitle(existing.title || "维修费用报销单");
      setCompanyName(existing.company_name || "");
      setNotes(existing.notes || "");
      setItems(
        (existing.work_order_reimbursement_items || [])
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((it: any) => ({
            id: it.id,
            name: it.name,
            spec: it.spec || "",
            quantity: Number(it.quantity),
            unit_price: Number(it.unit_price),
            total_price: Number(it.total_price),
          }))
      );
    } else {
      // 从工单复制项目
      const { data: workItems } = await supabase
        .from("work_order_items")
        .select("name, alias_name, quantity, unit_price, total_price, item_type")
        .eq("work_order_id", orderId)
        .order("created_at", { ascending: true });

      const mapped = (workItems || []).map((it: any, idx: number) => ({
        name: it.alias_name || it.name,
        spec: it.item_type === "labor" ? "工时" : it.item_type === "part" ? "配件" : "",
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        total_price: Number(it.total_price),
      }));

      if (mapped.length === 0) {
        mapped.push({ name: "", spec: "", quantity: 1, unit_price: 0, total_price: 0 });
      }

      setItems(mapped);
    }

    setLoading(false);
  }, [orderId, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function updateItem(index: number, field: string, value: string | number) {
    setItems((prev) => {
      const next = [...prev];
      (next[index] as any)[field] = value;
      if (field === "quantity" || field === "unit_price") {
        next[index].total_price = next[index].quantity * next[index].unit_price;
      }
      return next;
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { name: "", spec: "", quantity: 1, unit_price: 0, total_price: 0 }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const total = items.reduce((sum, it) => sum + (it.total_price || 0), 0);

  async function handleSave() {
    if (!orderId) return;
    const validItems = items.filter((it) => it.name.trim() !== "");
    if (validItems.length === 0) {
      alert("请至少填写一条项目");
      return;
    }

    setSaving(true);

    try {
      let rid = reimbursementId;

      if (!rid) {
        const { data: created, error: createErr } = await supabase
          .from("work_order_reimbursements")
          .insert({
            work_order_id: orderId,
            title: title || "维修费用报销单",
            company_name: companyName || null,
            notes: notes || null,
          })
          .select("id")
          .single();

        if (createErr) throw createErr;
        rid = created!.id;
        setReimbursementId(rid);
      } else {
        const { error: updErr } = await supabase
          .from("work_order_reimbursements")
          .update({
            title: title || "维修费用报销单",
            company_name: companyName || null,
            notes: notes || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", rid);

        if (updErr) throw updErr;

        // 删除旧项目重新插入（简单实现）
        await supabase.from("work_order_reimbursement_items").delete().eq("reimbursement_id", rid);
      }

      const rows = validItems.map((it, idx) => ({
        reimbursement_id: rid,
        name: it.name.trim(),
        spec: it.spec.trim() || null,
        quantity: it.quantity,
        unit_price: it.unit_price,
        total_price: it.total_price,
        sort_order: idx,
      }));

      const { error: itemErr } = await supabase.from("work_order_reimbursement_items").insert(rows);
      if (itemErr) throw itemErr;

      router.push(`/work-orders/${orderId}/print?type=reimbursement`);
    } catch (err: any) {
      alert("保存失败：" + err.message);
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader title="报销单" />
        <div className="text-center text-gray-400 py-12">加载中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="报销单"
        description="可在原工单基础上任意修改，不影响利润、绩效和库存"
      />

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* 头部信息 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">报销单标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">报销单位 / 公司</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="例如：XX运输公司"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* 原工单信息（只读） */}
        <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
          <div className="font-medium text-gray-700 mb-2">原工单信息</div>
          <div className="grid grid-cols-2 gap-2 text-gray-600">
            <div>工单号：{order?.order_no}</div>
            <div>车牌：{order?.vehicles?.plate_number || "-"}</div>
            <div>客户：{order?.customers?.name || "-"}</div>
            <div>电话：{order?.customers?.phone || "-"}</div>
          </div>
        </div>

        {/* 项目明细 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">费用明细</label>
            <button
              type="button"
              onClick={addItem}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              + 添加项目
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-700 w-10">序号</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">项目名称</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700 w-28">规格</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700 w-20">数量</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700 w-28">单价</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700 w-28">金额</th>
                  <th className="w-14"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={it.name}
                        onChange={(e) => updateItem(idx, "name", e.target.value)}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="项目名称"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={it.spec}
                        onChange={(e) => updateItem(idx, "spec", e.target.value)}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={it.quantity}
                        onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        min={0}
                        step={0.01}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={it.unit_price}
                        onChange={(e) => updateItem(idx, "unit_price", Number(e.target.value))}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        min={0}
                        step={0.01}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {formatCurrency(it.total_price)}
                    </td>
                    <td className="px-3 py-2">
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >
                          删除
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-right font-medium text-gray-700">
                    合计
                  </td>
                  <td className="px-3 py-2 font-bold text-gray-900">{formatCurrency(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 备注 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="报销备注（例如：含税、不含税等）"
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存并打印"}
          </button>
          <Link
            href={`/work-orders/${orderId}`}
            className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            返回工单
          </Link>
        </div>
      </div>
    </div>
  );
}
