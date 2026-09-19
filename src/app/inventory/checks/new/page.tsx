"use client";

import {useState, useEffect, useMemo} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { 新建盘点单 } from "../../actions";

interface 盘点项 {
  part_id: string;
  part_number: string;
  name: string;
  warehouse_id: string | null;
  warehouse_name: string;
  location: string;
  system_qty: number;
  actual_qty: string;
  diff_qty?: number;
  notes: string;
}

/* 按仓位盘点（2026-09-19 用户拍板）：明细 = 每个"配件×仓位"一行（仓位库存表），
   没有任何仓位记录的配件单独一行算"未分配仓位"（系统库存=配件总库存） */
export default function NewInventoryCheckPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [checkItems, setCheckItems] = useState<盘点项[]>([]);

  const [form, setForm] = useState({
    check_no: "",
    location: "",
    notes: "",
  });

  useEffect(() => {
    (async () => {
      const [{ data: 仓位行 }, { data: 配件们 }] = await Promise.all([
        supabase
          .from("part_stock_locations")
          .select("part_id, warehouse_id, location, quantity, warehouses(name)"),
        supabase.from("parts").select("id, part_number, name, quantity").order("name"),
      ]);
      interface 仓位查询行 {
        part_id: string;
        warehouse_id: string;
        location: string | null;
        quantity: number;
        warehouses: { name: string } | { name: string }[] | null;
      }
      const 仓位们 = (仓位行 || []) as unknown as 仓位查询行[];
      const 配件列表 = (配件们 || []) as { id: string; part_number: string | null; name: string | null; quantity: number | null }[];
      const 配件Map = new Map(配件列表.map((p) => [p.id, p]));
      const 有仓位配件 = new Set(仓位们.map((w) => w.part_id));

      const 行们: 盘点项[] = [];
      /* 1. 仓位行：每个配件×仓位一行 */
      for (const w of 仓位们) {
        const p = 配件Map.get(w.part_id);
        if (!p) continue;
        const 仓名 = Array.isArray(w.warehouses) ? w.warehouses[0]?.name : w.warehouses?.name;
        行们.push({
          part_id: w.part_id,
          part_number: p.part_number || "",
          name: p.name || "",
          warehouse_id: w.warehouse_id,
          warehouse_name: 仓名 || "",
          location: w.location || "",
          system_qty: w.quantity,
          actual_qty: "",
          notes: "",
        });
      }
      /* 2. 未分配仓位：没有任何仓位记录的配件 */
      for (const p of 配件列表) {
        if (有仓位配件.has(p.id)) continue;
        行们.push({
          part_id: p.id,
          part_number: p.part_number || "",
          name: p.name || "",
          warehouse_id: null,
          warehouse_name: "未分配仓位",
          location: "",
          system_qty: p.quantity || 0,
          actual_qty: "",
          notes: "",
        });
      }
      setCheckItems(行们);
    })();
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

    /* 建盘点单 + 插明细在服务端一次完成 */
    try {
      const result = await 新建盘点单({
        check_no: form.check_no,
        location: form.location,
        notes: form.notes,
        items: checkItems.map((item) => ({
          part_id: item.part_id,
          system_qty: item.system_qty,
          actual_qty: item.actual_qty,
          notes: item.notes,
          warehouse_id: item.warehouse_id,
          location: item.location || null,
        })),
      });
      if (!result.success) {
        showToast("保存失败: " + (result.error || "未知错误"), "error");
        setLoading(false);
        return;
      }
      router.push("/inventory/checks");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("保存失败: " + msg, "error");
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="新建盘点单" description="盘点期间请暂停出入库操作（系统不做强制锁定，靠人工约定）" />
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
                  <th className="px-4 py-2 text-left font-medium text-gray-500">仓库</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">仓位</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">系统库存</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">实际库存</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">差异</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {checkItems.map((item, i) => (
                  <tr key={`${item.part_id}-${item.warehouse_id || "none"}-${item.location}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600">{item.part_number}</td>
                    <td className="px-4 py-2 font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-2 text-gray-600">{item.warehouse_name}</td>
                    <td className="px-4 py-2 text-gray-600">{item.location || "-"}</td>
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
                        {(item.diff_qty || 0) > 0 ? "+" : ""}
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
