"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { ImageUploader } from "@/components/ImageUploader";
import { SupplierPhoneInput } from "@/components/SupplierPhoneInput";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { 批量创建运单, 关联运单到供应商待收货单 } from "@/app/logistics/actions";

/* 2026-08-20 批量创建运单分步流程（手机页/电脑弹窗共用）：
   ① 选物流公司 + 输入数量 → ② 生成对应数量运单卡片（都带该公司）
   → ③ 逐卡片填 单号/电话（自动带出供应商）/件数/运费/代收/拍照 → 一页提交
   提交后电话命中供应商且有在途采购单的，逐个弹问是否关联 */

interface 物流公司 {
  id: string;
  name: string;
  scopes?: string[] | null;
}

interface 运单行 {
  key: number;
  tracking_no: string;
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
  公司名,
  可删除,
  提交中,
  onChange,
  onRemove,
}: {
  行: 运单行;
  序号: number;
  公司名: string;
  可删除: boolean;
  提交中: boolean;
  onChange: (补丁: Partial<运单行>) => void;
  onRemove: () => void;
}) {
  const supabase = createClient();
  const debouncedPhone = useDebounce(行.phone, 300);

  /* 电话变化实时检索供应商（带出发货供应商名） */
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
    /* onChange 每次渲染都新建，不放进依赖避免重复检索 */
  }, [debouncedPhone, supabase]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">
          运单 {序号}
          <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{公司名}</span>
        </span>
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
        <label className="block text-xs text-gray-500 mb-1">发货人电话</label>
        {/* 逐字联想（2026-08-20 需求6/7）：输入即筛选，点选候选后电话+供应商名一起回填 */}
        <SupplierPhoneInput
          value={行.phone}
          onChange={(电话) => onChange({ phone: 电话 })}
          onSelect={(供应商) => onChange({ phone: 供应商.phone || "", supplier_name: 供应商.name })}
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

/* ─── 分步表单主组件 ─── */
export function WaybillBatchForm({
  公司列表,
  提交完成后,
}: {
  公司列表: 物流公司[];
  提交完成后: () => void;
}) {
  const { 请求确认, 确认弹窗 } = useConfirm();
  const { showToast } = useToast();

  /* 第①步：公司 + 数量 */
  const [公司id, set公司id] = useState("");
  const [数量, set数量] = useState("");
  /* 第②步：运单卡片（生成后才显示） */
  const [行列表, set行列表] = useState<运单行[]>([]);
  const [提交中, set提交中] = useState(false);

  const 公司名 = 公司列表.find((c) => c.id === 公司id)?.name || "";

  function 生成卡片() {
    if (!公司id) {
      showToast("请先选择物流公司", "warning");
      return;
    }
    const n = parseInt(数量, 10);
    if (!数量.trim() || isNaN(n) || n <= 0 || n > 50) {
      showToast("请输入 1-50 的运单数量", "warning");
      return;
    }
    set行列表(Array.from({ length: n }, () => 空行()));
  }

  function 更新行(key: number, 补丁: Partial<运单行>) {
    set行列表((prev) => prev.map((r) => (r.key === key ? { ...r, ...补丁 } : r)));
  }

  function 删除行(key: number) {
    set行列表((prev) => prev.filter((r) => r.key !== key));
  }

  async function 提交() {
    for (let i = 0; i < 行列表.length; i++) {
      const 行 = 行列表[i];
      const 标签 = `运单 ${i + 1}`;
      if (!行.tracking_no.trim()) {
        showToast(`${标签}：请填写运单号`, "warning");
        return;
      }
      const 件数 = parseInt(行.package_count, 10);
      if (!行.package_count.trim() || isNaN(件数) || 件数 <= 0) {
        showToast(`${标签}：请填写件数`, "warning");
        return;
      }
      if (行.freight.trim() === "" || isNaN(parseFloat(行.freight))) {
        showToast(`${标签}：请填写运费金额`, "warning");
        return;
      }
      if (行.cod.trim() === "" || isNaN(parseFloat(行.cod))) {
        showToast(`${标签}：请填写代收金额`, "warning");
        return;
      }
    }

    set提交中(true);
    try {
      const res = await 批量创建运单(
        行列表.map((行) => ({
          tracking_no: 行.tracking_no.trim(),
          logistics_company_id: 公司id,
          logistics_company_name: 公司名 || null,
          phone: 行.phone.trim() || null,
          package_count: parseInt(行.package_count, 10),
          freight_amount: parseFloat(行.freight) || 0,
          cod_amount: parseFloat(行.cod) || 0,
          photos: 行.photos.length > 0 ? 行.photos : null,
        }))
      );
      if (!res.success) throw new Error(res.error || "创建运单失败");

      /* 电话命中供应商且有可关联单 → 逐个弹问（询问后确认关联） */
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

      showToast(
        关联总数 > 0
          ? `成功创建 ${res.结果?.length || 0} 张运单，并关联 ${关联总数} 张待收货采购单`
          : `成功创建 ${res.结果?.length || 0} 张运单`
      );
      提交完成后();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("创建运单失败: " + msg, "error");
    } finally {
      set提交中(false);
    }
  }

  const 公司选项 = (范围: string) =>
    公司列表.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes(范围));

  return (
    <div className="space-y-3">
      {/* 第①步：选公司 + 数量 */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">物流公司 *</label>
          <select
            value={公司id}
            onChange={(e) => set公司id(e.target.value)}
            disabled={提交中}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">请选择</option>
            {公司选项("harbin").length > 0 && (
              <optgroup label="哈市物流">
                {公司选项("harbin").map((c) => (
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
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">创建数量 *</label>
            <input
              type="number"
              min={1}
              max={50}
              value={数量}
              onChange={(e) => set数量(e.target.value)}
              placeholder="例如：3"
              disabled={提交中}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={生成卡片}
            disabled={提交中}
            className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            生成运单栏
          </button>
        </div>
      </div>

      {/* 第②步：运单卡片 */}
      {行列表.map((行, idx) => (
        <WaybillCard
          key={行.key}
          行={行}
          序号={idx + 1}
          公司名={公司名}
          可删除={行列表.length > 1}
          提交中={提交中}
          onChange={(补丁) => 更新行(行.key, 补丁)}
          onRemove={() => 删除行(行.key)}
        />
      ))}

      {行列表.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => set行列表((prev) => [...prev, 空行()])}
            disabled={提交中}
            className="w-full py-2.5 rounded-xl border border-dashed border-blue-300 text-blue-600 text-sm hover:bg-blue-50 disabled:opacity-50"
          >
            + 再加一张
          </button>
          <button
            type="button"
            onClick={提交}
            disabled={提交中}
            className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {提交中 ? "创建中..." : `创建 ${行列表.length} 张运单`}
          </button>
        </>
      )}

      {确认弹窗}
    </div>
  );
}
