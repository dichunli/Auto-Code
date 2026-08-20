"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { MobilePageHeader } from "@/components/mobile/MobilePageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import { useConfirm } from "@/components/ConfirmDialog";
import { 批量创建运单, 关联运单到供应商待收货单 } from "@/app/logistics/actions";

/* 2026-08-20 待收货改造一期③：手机端批量建运单
   逐行录入：单号/发货电话/件数/运费/代收/拍照；
   电话命中供应商时，保存后弹问「该供应商有 N 张待收货采购单，是否关联到这张运单」 */

interface 物流公司 {
  id: string;
  name: string;
  scopes?: string[] | null;
}

interface 运单行 {
  key: number;
  tracking_no: string;
  logistics_company_id: string;
  phone: string;
  supplier_name: string;
  package_count: string;
  freight: string;
  cod: string;
  photos: string[];
}

function 生成运单号(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomStr = Math.floor(1000 + Math.random() * 9000);
  return `YD-${dateStr}-${randomStr}`;
}

let 行号种子 = 1;
function 空行(): 运单行 {
  return {
    key: 行号种子++,
    tracking_no: 生成运单号(),
    logistics_company_id: "",
    phone: "",
    supplier_name: "",
    package_count: "",
    freight: "",
    cod: "",
    photos: [],
  };
}

/* ─── 单个运单卡片（必须定义在父组件外部） ─── */
function WaybillCard({
  行,
  序号,
  公司列表,
  可删除,
  提交中,
  onChange,
  onRemove,
}: {
  行: 运单行;
  序号: number;
  公司列表: 物流公司[];
  可删除: boolean;
  提交中: boolean;
  onChange: (补丁: Partial<运单行>) => void;
  onRemove: () => void;
}) {
  const supabase = createClient();
  const debouncedPhone = useDebounce(行.phone, 300);

  /* 电话变化实时检索供应商名（与电脑端待收货页同一口径：手机号模糊匹配） */
  useEffect(() => {
    async function 检索() {
      const 电话 = debouncedPhone.trim();
      if (!电话) {
        onChange({ supplier_name: "" });
        return;
      }
      const { data } = await supabase
        .from("suppliers")
        .select("name")
        .ilike("phone", `%${电话}%`)
        .limit(1);
      onChange({ supplier_name: data && data.length > 0 ? data[0].name : "" });
    }
    检索();
    /* onChange 由父组件 useCallback 固定，不依赖它避免重复检索 */
     
  }, [debouncedPhone, supabase]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">运单 {序号}</span>
        {可删除 && (
          <button
            type="button"
            onClick={onRemove}
            disabled={提交中}
            className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
          >
            删除
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">运单号 *</label>
        <input
          type="text"
          value={行.tracking_no}
          onChange={(e) => onChange({ tracking_no: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">物流公司</label>
        <select
          value={行.logistics_company_id}
          onChange={(e) => onChange({ logistics_company_id: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        >
          <option value="">请选择</option>
          {公司列表.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).length > 0 && (
            <optgroup label="哈市物流">
              {公司列表.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          )}
          {公司列表.filter((c) => c.scopes?.includes("outside")).length > 0 && (
            <optgroup label="外阜快递">
              {公司列表.filter((c) => c.scopes?.includes("outside")).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">发货人电话</label>
        <input
          type="tel"
          value={行.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          placeholder="输入电话自动检索供应商"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {行.supplier_name && (
          <p className="text-xs text-blue-600 mt-1">命中供应商：{行.supplier_name}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">件数 *</label>
          <input
            type="number"
            min={1}
            value={行.package_count}
            onChange={(e) => onChange({ package_count: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">运费 *</label>
          <input
            type="number"
            step="0.01"
            min={0}
            value={行.freight}
            onChange={(e) => onChange({ freight: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">代收 *</label>
          <input
            type="number"
            step="0.01"
            min={0}
            value={行.cod}
            onChange={(e) => onChange({ cod: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">运单照片</label>
        <ImageUploader
          onUpload={(paths) => onChange({ photos: paths })}
          existingImages={行.photos}
          maxImages={3}
          bucket="work-order-media"
          folder="waybill-photos"
        />
      </div>
    </div>
  );
}

export default function MobileWaybillBatchPage() {
  const router = useRouter();
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [行列表, set行列表] = useState<运单行[]>([空行()]);
  const [公司列表, set公司列表] = useState<物流公司[]>([]);
  const [提交中, set提交中] = useState(false);

  useEffect(() => {
    supabase
      .from("logistics_companies")
      .select("id, name, scopes")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .then(({ data }) => set公司列表((data || []) as 物流公司[]));
  }, [supabase]);

  function 更新行(key: number, 补丁: Partial<运单行>) {
    set行列表((prev) => prev.map((r) => (r.key === key ? { ...r, ...补丁 } : r)));
  }

  function 删除行(key: number) {
    set行列表((prev) => prev.filter((r) => r.key !== key));
  }

  async function 提交() {
    /* 逐行校验（价格/数量前端字符串、提交时转 number） */
    for (let i = 0; i < 行列表.length; i++) {
      const 行 = 行列表[i];
      const 标签 = `运单 ${i + 1}`;
      if (!行.tracking_no.trim()) {
        alert(`${标签}：请填写运单号`);
        return;
      }
      const 件数 = parseInt(行.package_count, 10);
      if (!行.package_count.trim() || isNaN(件数) || 件数 <= 0) {
        alert(`${标签}：请填写件数`);
        return;
      }
      if (行.freight.trim() === "" || isNaN(parseFloat(行.freight))) {
        alert(`${标签}：请填写运费金额`);
        return;
      }
      if (行.cod.trim() === "" || isNaN(parseFloat(行.cod))) {
        alert(`${标签}：请填写代收金额`);
        return;
      }
    }

    set提交中(true);
    try {
      const 公司映射 = new Map(公司列表.map((c) => [c.id, c.name]));
      const res = await 批量创建运单(
        行列表.map((行) => ({
          tracking_no: 行.tracking_no.trim(),
          logistics_company_id: 行.logistics_company_id || null,
          logistics_company_name: 行.logistics_company_id ? 公司映射.get(行.logistics_company_id) || null : null,
          phone: 行.phone.trim() || null,
          package_count: parseInt(行.package_count, 10),
          freight_amount: parseFloat(行.freight) || 0,
          cod_amount: parseFloat(行.cod) || 0,
          photos: 行.photos.length > 0 ? 行.photos : null,
        }))
      );
      if (!res.success) throw new Error(res.error || "创建运单失败");

      /* 电话命中供应商且有可关联单 → 逐个弹问（需求2：询问后确认关联） */
      let 关联总数 = 0;
      for (const r of res.结果 || []) {
        if (!r.supplier_id || r.待关联单数 <= 0) continue;
        const 同意 = await 请求确认(
          `运单 ${r.tracking_no} 的电话命中供应商「${r.supplier_name}」，该供应商有 ${r.待关联单数} 张待收货采购单，是否关联到这张运单？`
        );
        if (!同意) continue;
        const 关联 = await 关联运单到供应商待收货单(r.waybill_id, r.supplier_id);
        if (!关联.success) throw new Error(关联.error || "关联采购单失败");
        关联总数 += 关联.count || 0;
      }

      alert(
        关联总数 > 0
          ? `成功创建 ${res.结果?.length || 0} 张运单，并关联 ${关联总数} 张待收货采购单`
          : `成功创建 ${res.结果?.length || 0} 张运单`
      );
      router.push("/m/receiving");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("创建运单失败: " + msg);
    } finally {
      set提交中(false);
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <MobilePageHeader title="批量建运单" />
      <div className="flex-1 p-3 space-y-3">
        {行列表.map((行, idx) => (
          <WaybillCard
            key={行.key}
            行={行}
            序号={idx + 1}
            公司列表={公司列表}
            可删除={行列表.length > 1}
            提交中={提交中}
            onChange={(补丁) => 更新行(行.key, 补丁)}
            onRemove={() => 删除行(行.key)}
          />
        ))}

        <button
          type="button"
          onClick={() => set行列表((prev) => [...prev, 空行()])}
          disabled={提交中}
          className="w-full py-2.5 rounded-xl border border-dashed border-blue-300 text-blue-600 text-sm hover:bg-blue-50 disabled:opacity-50"
        >
          + 添加一张运单
        </button>
      </div>

      <div className="sticky bottom-0 p-3 bg-gray-50 border-t border-gray-200">
        <button
          type="button"
          onClick={提交}
          disabled={提交中}
          className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {提交中 ? "创建中..." : `创建 ${行列表.length} 张运单`}
        </button>
      </div>

      {确认弹窗}
    </div>
  );
}
