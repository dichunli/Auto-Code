import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function ServiceCategoriesPage() {
  const supabase = await createClient();
  const { data: categories } = await supabase.from("service_categories").select("*").order("created_at", { ascending: false });

  function formatCommission(type: string | null, value: number | null) {
    if (!type || value == null) return "-";
    if (type === "revenue_pct") return `${value}% (产值)`;
    if (type === "profit_pct") return `${value}% (毛利)`;
    return `¥${value} (固定)`;
  }

  return (
    <div>
      <PageHeader title="维修项目分类" description="管理分类及各类提成标准" action={{ href: "/service-categories/new", label: "新建分类" }} />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">销售提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">诊断提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">施工提成</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">质检提成</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories?.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{c.name}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCommission(c.sales_commission_type, c.sales_commission_value)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCommission(c.diagnosis_commission_type, c.diagnosis_commission_value)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCommission(c.repair_commission_type, c.repair_commission_value)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCommission(c.qc_commission_type, c.qc_commission_value)}</td>
                </tr>
              ))}
              {(!categories || categories.length === 0) && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">暂无分类，请先新建</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
