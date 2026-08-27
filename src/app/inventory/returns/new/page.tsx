"use client";

import {useState, useEffect, useMemo} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { usePriceVisibility } from "@/components/PriceVisibilityContext";
import { 新建采购退货 } from "../../actions";

export default function NewPurchaseReturnPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { showPrices } = usePriceVisibility();
  const [loading, setLoading] = useState(false);
  interface Part {
    id: string;
    part_number: string;
    name: string;
    quantity: number;
  }

  interface Batch {
    id: string;
    batch_no: string | null;
    remaining: number;
    unit_cost: number | null;
  }

  const [parts, setParts] = useState<Part[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  const [form, setForm] = useState({
    part_id: "",
    batch_id: "",
    quantity: "",
    reason: "",
  });

  useEffect(() => {
    supabase
      .from("parts")
      .select("id, part_number, name, quantity")
      .order("name")
      .then(({ data }) => setParts(data || []));
  }, [supabase]);

  useEffect(() => {
    if (form.part_id) {
      supabase
        .from("part_batches")
        .select("*")
        .eq("part_id", form.part_id)
        .gt("remaining", 0)
        .order("created_at", { ascending: true })
        .then(({ data }) => setBatches(data || []));
    } else {
      setBatches([]);
    }
  }, [form.part_id, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.part_id) {
      alert("请选择配件");
      return;
    }
    if (!form.batch_id) {
      alert("请选择批次（按先进先出退最早批次）");
      return;
    }

    setLoading(true);

    try {
      const qty = parseInt(form.quantity) || 0;
      if (qty <= 0) throw new Error("退货数量必须大于0");

      const batch = batches.find((b) => b.id === form.batch_id);
      if (!batch) throw new Error("批次不存在");

      /* 涉库存多步写走 Server Action + RPC 事务，服务端加锁读最新数量再扣减 */
      const result = await 新建采购退货({
        partId: form.part_id,
        batchId: form.batch_id,
        quantity: qty,
        reason: form.reason,
      });
      if (!result.success) throw new Error(result.error || "保存失败");

      router.push("/inventory/returns");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert("保存失败: " + message);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="新建退货单" description="退货将按先进先出原则扣减最早批次库存" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">配件 *</label>
            <select
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.part_id}
              onChange={(e) =>
                setForm({ ...form, part_id: e.target.value, batch_id: "" })
              }
            >
              <option value="">请选择</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.part_number} - {p.name} (库存: {p.quantity})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              批次 *（最早批次优先）
            </label>
            <select
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.batch_id}
              onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
            >
              <option value="">请选择批次</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batch_no || "未命名批次"} - 剩余 {b.remaining}{showPrices ? ` - 进价 ¥${b.unit_cost}` : " - 进价 ***"}
                </option>
              ))}
            </select>
            {batches.length === 0 && form.part_id && (
              <p className="text-xs text-red-500 mt-1">该配件没有可用批次</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">退货数量 *</label>
            <input
              required
              type="number"
              min="1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">退货原因</label>
            <textarea
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="如：质量问题、错发"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
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
            确认退货
          </button>
        </div>
      </form>
    </div>
  );
}
