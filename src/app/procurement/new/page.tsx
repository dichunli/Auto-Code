"use client";

/* ============================================================
 * 新建采购（2026-08-17 改版）
 * 用途：备货类采购的统一入口——
 *   · 安全库存补货：勾选低于库存下限的配件，批量加入待采购
 *   · 自定义采购：采购与工单无关的配件（弹窗）
 * 提交后都进「采购暂存表」，显示在「待采购」页与工单配件一起勾选发起采购
 * （与待采购页内添加的结果完全相同；不再直接生成采购单）。
 * ============================================================ */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import CustomPurchaseModal from "@/components/CustomPurchaseModal";
import { 添加采购暂存 } from "@/app/procurement/actions";

interface 供应商 {
  id: string;
  name: string;
}

interface 低库存配件 {
  id: string;
  part_number: string | null;
  name: string;
  brand: string | null;
  specification: string | null;
  document_name: string | null;
  unit: string | null;
  unit_cost: number | null;
  quantity: number;
  min_stock: number;
  supplier_id: string | null;
  supplier_name: string | null;
}

export default function NewPurchasePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { 请求确认, 确认弹窗 } = useConfirm();

  const [tab, setTab] = useState<"stock" | "custom">("stock");
  const [suppliers, setSuppliers] = useState<供应商[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [结果提示, set结果提示] = useState<{ 类型: "成功" | "失败"; 文字: string } | null>(null);

  /* 安全库存补货 */
  const [低库存列表, set低库存列表] = useState<低库存配件[]>([]);
  const [勾选, set勾选] = useState<Set<string>>(new Set());
  const [数量表, set数量表] = useState<Record<string, string>>({});
  const [供应商表, set供应商表] = useState<Record<string, string>>({});
  const [搜索词, set搜索词] = useState("");

  /* 自定义采购弹窗 */
  const [showCustomModal, setShowCustomModal] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: sups }, { data: partsData }, { data: stagingData }, { data: 在途明细 }] = await Promise.all([
        supabase.from("suppliers").select("id, name").order("name"),
        supabase
          .from("parts")
          .select("id, part_number, name, brand, specification, document_name, unit, unit_cost, quantity, min_stock, supplier_id, suppliers(name)")
          .gt("min_stock", 0)
          .order("name"),
        supabase.from("custom_purchase_staging").select("part_id"),
        supabase.from("purchase_order_items").select("part_id, purchase_orders(status)").not("part_id", "is", null),
      ]);

      /* 排除在途：已在暂存表 或 在未完成采购单里的配件不再显示 */
      const 排除 = new Set<string>();
      for (const s of (stagingData || []) as { part_id: string | null }[]) {
        if (s.part_id) 排除.add(s.part_id);
      }
      interface 在途行 { part_id: string | null; purchase_orders: { status: string | null } | { status: string | null }[] | null }
      for (const it of (在途明细 || []) as unknown as 在途行[]) {
        const st = Array.isArray(it.purchase_orders) ? it.purchase_orders[0]?.status : it.purchase_orders?.status;
        if (it.part_id && st && st !== "completed" && st !== "cancelled") 排除.add(it.part_id);
      }

      interface 配件行 {
        id: string; part_number: string | null; name: string; brand: string | null;
        specification: string | null; document_name: string | null; unit: string | null;
        unit_cost: number | null; quantity: number | null; min_stock: number | null;
        supplier_id: string | null; suppliers: { name: string } | null;
      }
      const 列表: 低库存配件[] = ((partsData || []) as unknown as 配件行[])
        .filter((p) => p.min_stock != null && p.min_stock > 0 && (p.quantity ?? 0) < p.min_stock && !排除.has(p.id))
        .map((p) => ({
          id: p.id,
          part_number: p.part_number,
          name: p.name,
          brand: p.brand,
          specification: p.specification,
          document_name: p.document_name,
          unit: p.unit,
          unit_cost: p.unit_cost,
          quantity: p.quantity ?? 0,
          min_stock: p.min_stock!,
          supplier_id: p.supplier_id,
          supplier_name: p.suppliers?.name || null,
        }));

      /* 没默认供应商的，取该配件最近一次采购单的供应商 */
      const 缺供应商 = 列表.filter((p) => !p.supplier_id).map((p) => p.id);
      if (缺供应商.length > 0) {
        const { data: 历史 } = await supabase
          .from("purchase_order_items")
          .select("part_id, purchase_orders(supplier_id, created_at)")
          .in("part_id", 缺供应商);
        interface 历史行 { part_id: string | null; purchase_orders: { supplier_id: string | null; created_at: string | null } | null }
        const 最近 = new Map<string, string>();
        const 排序 = ((历史 || []) as unknown as 历史行[])
          .filter((h) => h.part_id && h.purchase_orders?.supplier_id)
          .sort((a, b) => (b.purchase_orders!.created_at || "").localeCompare(a.purchase_orders!.created_at || ""));
        for (const h of 排序) {
          if (!最近.has(h.part_id!)) 最近.set(h.part_id!, h.purchase_orders!.supplier_id!);
        }
        for (const p of 列表) {
          if (p.supplier_id) continue;
          const sid = 最近.get(p.id);
          if (sid) p.supplier_id = sid;
        }
      }

      setSuppliers((sups || []) as 供应商[]);
      set低库存列表(列表);
      setLoading(false);
    })();
  }, [supabase]);

  const 过滤后列表 = useMemo(() => {
    const kw = 搜索词.trim().toUpperCase();
    if (!kw) return 低库存列表;
    return 低库存列表.filter((p) =>
      [p.name, p.part_number, p.brand, p.specification, p.document_name]
        .filter(Boolean).join(" ").toUpperCase().includes(kw)
    );
  }, [低库存列表, 搜索词]);

  function 建议数量(p: 低库存配件): number {
    return Math.max(p.min_stock - p.quantity, 1);
  }

  function 有效供应商id(p: 低库存配件): string {
    return 供应商表[p.id] || p.supplier_id || "";
  }

  function 数量有效(id: string): boolean {
    const q = 数量表[id];
    if (q === undefined || q.trim() === "") return false;
    const n = Number(q);
    return Number.isInteger(n) && n > 0;
  }

  const 可提交 =
    勾选.size > 0 &&
    低库存列表.filter((p) => 勾选.has(p.id)).every((p) => 有效供应商id(p) !== "" && 数量有效(p.id));

  function 切换勾选(p: 低库存配件) {
    set勾选((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) {
        next.delete(p.id);
      } else {
        next.add(p.id);
        if (数量表[p.id] === undefined) {
          set数量表((q) => ({ ...q, [p.id]: String(建议数量(p)) }));
        }
      }
      return next;
    });
  }

  async function 提交补货() {
    if (!可提交) return;
    const 选中 = 低库存列表.filter((p) => 勾选.has(p.id));
    if (!(await 请求确认(`将把 ${选中.length} 条配件添加到「待采购」列表，之后统一发起采购，是否继续？`))) return;

    setSubmitting(true);
    set结果提示(null);
    try {
      const res = await 添加采购暂存(
        选中.map((p) => ({
          part_id: p.id,
          part_number: p.part_number,
          name: p.name,
          brand: p.brand,
          specification: p.specification,
          document_name: p.document_name,
          unit: p.unit,
          unit_cost: p.unit_cost,
          quantity: Number(数量表[p.id]),
          supplier_id: 有效供应商id(p),
          source: "safety_stock" as const,
        }))
      );
      if (!res.success) throw new Error(res.error || "添加失败");
      set结果提示({ 类型: "成功", 文字: `已添加 ${res.count ?? 选中.length} 条配件到「待采购」，正在跳转…` });
      setTimeout(() => router.push("/procurement?tab=pending_purchase"), 800);
    } catch (err: unknown) {
      set结果提示({ 类型: "失败", 文字: "添加失败: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="新建采购"
        description="备货类采购统一入口：提交后进入「待采购」，在待采购页勾选后统一发起采购"
        action={{ href: "/procurement/orders", label: "返回采购订单" }}
      />

      {结果提示 && (
        <div className={`px-4 py-2 text-sm rounded-lg ${结果提示.类型 === "成功" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {结果提示.文字}
        </div>
      )}

      {/* 页签切换 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("stock")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "stock" ? "bg-blue-600 text-white" : "bg-white border border-gray-300 text-gray-600"}`}
        >
          安全库存补货
        </button>
        <button
          type="button"
          onClick={() => setTab("custom")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "custom" ? "bg-blue-600 text-white" : "bg-white border border-gray-300 text-gray-600"}`}
        >
          自定义采购
        </button>
      </div>

      {tab === "stock" ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              低于库存下限的配件
              <span className="ml-2 text-xs font-normal text-gray-500">共 {过滤后列表.length} 条（已排除在途采购）</span>
            </h3>
            <input
              type="text"
              value={搜索词}
              onChange={(e) => set搜索词(e.target.value)}
              placeholder="搜索名称/编码/品牌/规格…"
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg w-64"
            />
          </div>

          {loading ? (
            <div className="p-12 text-center text-gray-400">加载中...</div>
          ) : 过滤后列表.length === 0 ? (
            <div className="p-12 text-center text-gray-400">没有需要补货的配件</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 w-10"></th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">配件</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">库存/下限</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 w-28">采购数量</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 w-48">供应商</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {过滤后列表.map((p) => {
                    const 已勾 = 勾选.has(p.id);
                    const 缺供应商 = 有效供应商id(p) === "";
                    const 数量无效 = 已勾 && !数量有效(p.id);
                    return (
                      <tr key={p.id} className={已勾 ? "bg-blue-50/50" : "hover:bg-gray-50"}>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={已勾} onChange={() => 切换勾选(p)} className="rounded" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900">{p.name}</div>
                          <div className="text-xs text-gray-500">
                            {[p.part_number, p.brand, p.specification].filter(Boolean).join(" · ") || "-"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="text-red-600 font-medium">{p.quantity}</span>
                          <span className="text-gray-400"> / {p.min_stock}</span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={数量表[p.id] ?? ""}
                            onChange={(e) => set数量表((q) => ({ ...q, [p.id]: e.target.value }))}
                            placeholder={String(建议数量(p))}
                            disabled={!已勾}
                            className={`w-20 px-2 py-1 text-sm border rounded ${数量无效 ? "border-red-400 bg-red-50" : "border-gray-300"}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={有效供应商id(p)}
                            onChange={(e) => set供应商表((s) => ({ ...s, [p.id]: e.target.value }))}
                            disabled={!已勾}
                            className={`w-full px-2 py-1 text-sm border rounded bg-white ${已勾 && 缺供应商 ? "border-yellow-400 bg-yellow-50" : "border-gray-300"}`}
                          >
                            <option value="">{p.supplier_name ? `${p.supplier_name}（默认）` : "请选择供应商"}</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              已选 {勾选.size} 条；缺供应商的黄色高亮、数量必填
            </span>
            <button
              type="button"
              onClick={提交补货}
              disabled={!可提交 || submitting}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "添加中..." : "添加到待采购"}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-4">
          <p className="text-sm text-gray-600">
            采购与工单无关的配件（店里自用、提前备货等）：搜索系统已有配件或现场新建，加入清单后提交到「待采购」。
          </p>
          <button
            type="button"
            onClick={() => setShowCustomModal(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            打开自定义采购
          </button>
        </div>
      )}

      <CustomPurchaseModal
        open={showCustomModal}
        onClose={() => setShowCustomModal(false)}
        suppliers={suppliers}
        on成功={(文字) => set结果提示({ 类型: "成功", 文字 })}
      />
      {确认弹窗}
    </div>
  );
}
