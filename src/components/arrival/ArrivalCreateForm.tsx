"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { ImageUploader } from "@/components/ImageUploader";
import { 建到货确认单 } from "@/app/arrivals/actions";
import { useToast } from "@/components/Toast";

/* 2026-08-20 待收货改造二期：建到货确认单表单（手机/电脑共用）
   选供应商（可挂运单）→ 数据库自动拉入该供应商所有在途采购行 */

interface 供应商 {
  id: string;
  name: string;
  phone: string | null;
}

interface 运单 {
  id: string;
  tracking_no: string;
  supplier_name: string | null;
  logistics_company_name: string | null;
  logistics_companies: { name: string } | null;
}

export function ArrivalCreateForm({ 工作台前缀 }: { 工作台前缀: string }) {
  const router = useRouter();
  const supabase = createClient();

  const [供应商列表, set供应商列表] = useState<供应商[]>([]);
  const [供应商id, set供应商id] = useState("");
  const [供应商搜索, set供应商搜索] = useState("");
  const 防抖搜索 = useDebounce(供应商搜索, 300);

  const [运单列表, set运单列表] = useState<运单[]>([]);
  const [运单id, set运单id] = useState("");
  const [供应商单号, set供应商单号] = useState("");
  /* 销售单总金额（2026-08-21，非必填）：入库时按它校验货款对平 */
  const [单上金额, set单上金额] = useState("");
  const [照片, set照片] = useState<string[]>([]);
  const [提交中, set提交中] = useState(false);
  const { showToast } = useToast();

  /* 供应商列表（带搜索） */
  useEffect(() => {
    async function 加载() {
      let q = supabase.from("suppliers").select("id, name, phone").order("name");
      if (防抖搜索.trim()) {
        q = q.ilike("name", `%${防抖搜索.trim()}%`);
      }
      const { data } = await q.limit(50);
      set供应商列表((data || []) as 供应商[]);
    }
    加载();
  }, [防抖搜索, supabase]);

  /* 待签收运单：与所选供应商匹配的排前面 */
  useEffect(() => {
    async function 加载() {
      const { data } = await supabase
        .from("logistics_waybills")
        .select("id, tracking_no, supplier_name, logistics_company_name, logistics_companies(name)")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100);
      set运单列表(((data || []) as unknown) as 运单[]);
    }
    加载();
  }, [supabase]);

  const 选中供应商名 = useMemo(
    () => 供应商列表.find((s) => s.id === 供应商id)?.name || "",
    [供应商列表, 供应商id]
  );

  const 排序运单 = useMemo(() => {
    if (!选中供应商名) return 运单列表;
    return [...运单列表].sort((a, b) => {
      const a命中 = a.supplier_name === 选中供应商名 ? 1 : 0;
      const b命中 = b.supplier_name === 选中供应商名 ? 1 : 0;
      return b命中 - a命中;
    });
  }, [运单列表, 选中供应商名]);

  async function 提交() {
    if (!供应商id) {
      showToast("请选择供应商", "warning");
      return;
    }
    set提交中(true);
    try {
      const 金额 = 单上金额.trim() === "" ? null : parseFloat(单上金额);
      if (金额 !== null && (isNaN(金额) || 金额 < 0)) {
        showToast("销售单总金额无效", "warning");
        set提交中(false);
        return;
      }
      const res = await 建到货确认单(
        运单id || null,
        供应商id,
        供应商单号.trim() || null,
        照片.length > 0 ? 照片 : null,
        金额
      );
      if (!res.success) throw new Error(res.error || "创建到货单失败");
      showToast(`到货单 ${res.receipt_no} 创建成功，已拉入 ${res.item_count} 条在途采购行，请逐件验货`);
      router.push(工作台前缀 + res.arrival_id);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("创建到货单失败: " + msg, "error");
    } finally {
      set提交中(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">供应商 *</label>
        <input
          type="text"
          value={供应商搜索}
          onChange={(e) => set供应商搜索(e.target.value)}
          placeholder="搜索供应商名称"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-2"
        />
        <select
          value={供应商id}
          onChange={(e) => set供应商id(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        >
          <option value="">请选择供应商</option>
          {供应商列表.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.phone ? `（${s.phone}）` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          关联运单
          <span className="ml-2 text-xs text-gray-400">（本地供货可不选；匹配供应商的排在前面）</span>
        </label>
        <select
          value={运单id}
          onChange={(e) => set运单id(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        >
          <option value="">不关联运单（本地供货）</option>
          {排序运单.map((w) => (
            <option key={w.id} value={w.id}>
              {w.tracking_no}
              {w.supplier_name ? ` · ${w.supplier_name}` : ""}
              {` · ${w.logistics_companies?.name || w.logistics_company_name || "-"}`}
              {w.supplier_name && w.supplier_name === 选中供应商名 ? " ✓" : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          供应商销售单号
          <span className="ml-2 text-xs text-gray-400">（选填，没有可后补）</span>
        </label>
        <input
          type="text"
          value={供应商单号}
          onChange={(e) => set供应商单号(e.target.value)}
          placeholder="对方实发那张单的单号"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          销售单总金额
          <span className="ml-2 text-xs text-gray-400">（选填；填了入库时会校验货款对平）</span>
        </label>
        <input
          type="number"
          step="0.01"
          min={0}
          value={单上金额}
          onChange={(e) => set单上金额(e.target.value)}
          placeholder="销售单上的合计金额"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          销售单照片/微信截图
          <span className="ml-2 text-xs text-gray-400">（可后补）</span>
        </label>
        <ImageUploader
          onUpload={set照片}
          existingImages={照片}
          maxImages={5}
          bucket="work-order-media"
          folder="arrival-receipts"
        />
      </div>

      <button
        type="button"
        onClick={提交}
        disabled={提交中}
        className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {提交中 ? "创建中..." : "创建到货确认单"}
      </button>
      <p className="text-xs text-gray-400 text-center">
        创建后自动拉入该供应商所有在途采购行，全程不显示价格
      </p>
    </div>
  );
}
