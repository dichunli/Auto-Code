"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewInventoryCheckPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [parts, setParts] = useState<any[]>([]);
  const [checkItems, setCheckItems] = useState<any[]>([]);

  const [form, setForm] = useState({
    check_no: "",
    location: "",
    notes: "",
  });

  useEffect(() => {
    supabase
      .from("parts")
      .select("id, part_number, name, quantity, location")
      .order("name")
      .then(({ data }) => {
        setParts(data || []);
        setCheckItems(
          (data || []).map((p) => ({
            part_id: p.id,
            part_number: p.part_number,
            name: p.name,
            system_qty: p.quantity,
            actual_qty: "",
            notes: "",
          }))
        );
      });
  }, [supabase]);

  function updateActualQty(index: number, value: string) {
    const next = [...checkItems];
    next[index].actual_qty = value;
    const actual = parseInt(value) || 0;
    next[index].diff_qty = actual - next[index].system_qty;
    setCheckItems(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      // 创建盘点单
      const { data: check, error: checkError } = await supabase
        .from("inventory_checks")
        .insert({
          check_no: form.check_no || null,
          location: form.location || null,
          notes: form.notes || null,
          status: "pending",
        })
        .select("id")
        .single();

      if (checkError || !check) throw checkError || new Error("创建盘点单失败");

      // 插入盘点明细
      const itemsToInsert = checkItems
        .filter((item) => item.actual_qty !== "")
        .map((item) => ({
          check_id: check.id,
          part_id: item.part_id,
          system_qty: item.system_qty,
          actual_qty: parseInt(item.actual_qty) || 0,
          diff_qty: (parseInt(item.actual_qty) || 0) - item.system_qty,
          notes: item.notes || null,
        }));

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from("inventory_check_items")
          .insert(itemsToInsert);
        if (itemsError) throw itemsError;
      }

      router.push("/inventory/checks");
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="新建盘点单" description="盘点期间系统将冻结出入库操作" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">盘点单号</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="可选"
              value={form.check_no}
              onChange={(e) => setForm({ ...form, check_no: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">盘点位置</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="如：A区货架"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-base font-semibold text-gray-900 mb-3">盘点明细</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">配件编号</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">名称</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">系统库存</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">实际库存</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">差异</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {checkItems.map((item, i) => (
                  <tr key={item.part_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600">{item.part_number}</td>
                    <td className="px-4 py-2 font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{item.system_qty}</td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-right"
                        value={item.actual_qty}
                        onChange={(e) => updateActualQty(i, e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`font-medium ${
                          (item.diff_qty || 0) > 0
                            ? "text-green-600"
                            : (item.diff_qty || 0) < 0
                            ? "text-red-600"
                            : "text-gray-600"
                        }`}
                      >
                        {item.diff_qty > 0 ? "+" : ""}
                        {item.diff_qty || 0}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        placeholder="原因"
                        value={item.notes}
                        onChange={(e) => {
                          const next = [...checkItems];
                          next[i].notes = e.target.value;
                          setCheckItems(next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
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
            保存盘点单
          </button>
        </div>
      </form>
    </div>
  );
}
