"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewWaybillPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);

  const [trackingNo, setTrackingNo] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [freightAmount, setFreightAmount] = useState("");
  const [codAmount, setCodAmount] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    supabase.from("logistics_companies").select("*").order("name").then(({ data }) => setCompanies(data || []));
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trackingNo) {
      alert("请填写物流单号");
      return;
    }

    setLoading(true);
    const company = companies.find((c) => c.id === companyId);

    try {
      const { error } = await supabase.from("logistics_waybills").insert({
        tracking_no: trackingNo.trim(),
        logistics_company_id: companyId || null,
        logistics_company_name: company?.name || null,
        freight_amount: parseFloat(freightAmount) || 0,
        cod_amount: parseFloat(codAmount) || 0,
        status: "pending",
        notes: notes || null,
      });

      if (error) throw error;
      router.push("/logistics");
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="新建运单" description="单独录入物流运单信息，入库时再关联" />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">物流单号 *</label>
            <input
              required
              value={trackingNo}
              onChange={(e) => setTrackingNo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="请输入物流单号"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">物流公司</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">请选择</option>
              {companies.filter((c) => !c.scopes || c.scopes.includes("harbin")).length > 0 && (
                <optgroup label="哈市物流（哈市供应商）">
                  {companies.filter((c) => !c.scopes || c.scopes.includes("harbin")).map((c) => (
                    <option key={`harbin-${c.id}`} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              )}
              {companies.filter((c) => c.scopes?.includes("outside")).length > 0 && (
                <optgroup label="外阜快递（外阜供应商）">
                  {companies.filter((c) => c.scopes?.includes("outside")).map((c) => (
                    <option key={`outside-${c.id}`} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">运费金额</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={freightAmount}
              onChange={(e) => setFreightAmount(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">代收款金额</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={codAmount}
              onChange={(e) => setCodAmount(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "保存中..." : "保存"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/logistics")}
            className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
