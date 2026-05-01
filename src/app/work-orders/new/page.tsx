"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface Requirement {
  description: string;
  assigned_to: string;
}

export default function NewWorkOrderPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [mechanics, setMechanics] = useState<any[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([
    { description: "", assigned_to: "" },
  ]);

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_company: "",
    plate_number: "",
    brand: "",
    model: "",
    vin: "",
    mileage_in: "",
    fuel_level: "50",
    customer_complaint: "",
    inspection_notes: "",
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").then(({ data }) => {
      setMechanics(data || []);
    });
  }, [supabase]);

  function addRequirement() {
    setRequirements([...requirements, { description: "", assigned_to: "" }]);
  }

  function updateRequirement(index: number, field: string, value: string) {
    const next = [...requirements];
    (next[index] as any)[field] = value;
    setRequirements(next);
  }

  function removeRequirement(index: number) {
    if (requirements.length <= 1) return;
    setRequirements(requirements.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const reqPayload = requirements
        .filter((r) => r.description.trim())
        .map((r) => ({
          description: r.description.trim(),
          assigned_to: r.assigned_to || "",
        }));

      const { data: result, error: rpcErr } = await supabase.rpc("create_work_order", {
        p_customer_name: form.customer_name,
        p_customer_phone: form.customer_phone,
        p_customer_company: form.customer_company,
        p_plate_number: form.plate_number,
        p_brand: form.brand,
        p_model: form.model,
        p_vin: form.vin,
        p_mileage_in: parseInt(form.mileage_in) || 0,
        p_fuel_level: parseInt(form.fuel_level) || 50,
        p_customer_complaint: requirements.map((r) => r.description).join("; "),
        p_inspection_notes: form.inspection_notes,
        p_receptionist_id: currentUserId || null,
        p_requirements: reqPayload,
      });

      if (rpcErr) throw new Error(rpcErr.message);

      const rpcResult = result as { success: boolean; error?: string; order_id?: string };
      if (!rpcResult?.success || !rpcResult.order_id) {
        throw new Error(rpcResult?.error || "创建工单失败");
      }

      router.push(`/work-orders/${rpcResult.order_id}`);
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="新建工单" description="录入客户车辆信息并开单" />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl">
        <div className="space-y-6">
          {/* 客户信息 */}
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-4">客户信息</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">客户姓名 *</label>
                <input required type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">联系电话 *</label>
                <input required type="tel" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">所属单位</label>
                <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.customer_company} onChange={(e) => setForm({ ...form, customer_company: e.target.value })} />
              </div>
            </div>
          </div>

          {/* 车辆信息 */}
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">车辆信息</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">车牌号 *</label>
                <input required type="text" placeholder="如：京A12345" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">品牌 *</label>
                <input required type="text" placeholder="如：丰田" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">型号 *</label>
                <input required type="text" placeholder="如：卡罗拉" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">VIN 码</label>
                <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">当前里程 *</label>
                <input required type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.mileage_in} onChange={(e) => setForm({ ...form, mileage_in: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">油量 ({form.fuel_level}%)</label>
                <input type="range" min="0" max="100" className="w-full" value={form.fuel_level}
                  onChange={(e) => setForm({ ...form, fuel_level: e.target.value })} />
              </div>
            </div>
          </div>

          {/* 客户需求逐条 */}
          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">客户需求（逐条录入）</h2>
              <button type="button" onClick={addRequirement} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                + 添加需求
              </button>
            </div>
            <div className="space-y-3">
              {requirements.map((req, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-sm text-gray-500 pt-2 w-8">{i + 1}.</span>
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      placeholder="如：发动机异响、空调不冷..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={req.description}
                      onChange={(e) => updateRequirement(i, "description", e.target.value)}
                    />
                    <div className="flex gap-2">
                      <select
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        value={req.assigned_to}
                        onChange={(e) => updateRequirement(i, "assigned_to", e.target.value)}
                      >
                        <option value="">指派技师（可选）</option>
                        {mechanics.map((m) => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {requirements.length > 1 && (
                    <button type="button" onClick={() => removeRequirement(i)} className="text-sm text-red-500 hover:text-red-600 px-2 pt-2">
                      删除
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 初步检查 */}
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">初步检查记录</h2>
            <textarea rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.inspection_notes} onChange={(e) => setForm({ ...form, inspection_notes: e.target.value })} />
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            取消
          </button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? "保存中..." : "创建工单"}
          </button>
        </div>
      </form>
    </div>
  );
}
