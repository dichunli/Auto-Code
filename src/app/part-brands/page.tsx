import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function PartBrandsPage() {
  const supabase = await createClient();
  const { data: brands } = await supabase.from("part_brands").select("*").order("usage_count", { ascending: false });

  return (
    <div>
      <PageHeader title="配件品牌" description="管理配件品牌，使用频次越高排序越靠前" action={{ href: "/part-brands/new", label: "新建品牌" }} />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">品牌名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">使用频次</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {brands?.map((b: any) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{b.name}</td>
                  <td className="px-6 py-4 text-gray-600">{b.usage_count || 0}</td>
                </tr>
              ))}
              {(!brands || brands.length === 0) && (
                <tr><td colSpan={2} className="px-6 py-12 text-center text-gray-400">暂无品牌，请先新建</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
