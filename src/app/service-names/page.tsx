import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function ServiceNamesPage() {
  const supabase = await createClient();
  const { data: names } = await supabase.from("service_names").select("*, service_categories(name)").order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader title="维修项目名称库" description="标准化项目名称，支持分类关联和搜索关键词" action={{ href: "/service-names/new", label: "新建名称" }} />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">项目名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">所属分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">搜索关键词</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {names?.map((n: any) => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{n.name}</td>
                  <td className="px-6 py-4 text-gray-600">{n.service_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{n.search_keywords || "-"}</td>
                </tr>
              ))}
              {(!names || names.length === 0) && (
                <tr><td colSpan={3} className="px-6 py-12 text-center text-gray-400">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
