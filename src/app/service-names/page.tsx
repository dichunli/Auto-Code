import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { DeleteButton } from "./DeleteButton";

export default async function ServiceNamesPage(props: { searchParams?: Promise<Record<string, string | undefined>> | Record<string, string | undefined> }) {
  const searchParams = (await Promise.resolve(props.searchParams || {})) as Record<string, string | undefined>;
  const supabase = await createClient();

  let query = supabase
    .from("service_names")
    .select("*, service_categories(name), service_name_part_names(count)")
    .order("created_at", { ascending: false });

  if (searchParams.name) {
    query = query.or(`name.ilike.%${searchParams.name}%,search_keywords.ilike.%${searchParams.name}%`);
  }

  const { data: names } = await query;

  return (
    <div>
      <PageHeader title="维修项目名称库" description="标准化项目名称，支持分类关联和搜索关键词" action={{ href: "/service-names/new", label: "新建名称" }} />

      {/* 搜索栏 */}
      <form method="GET" className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex gap-3">
          <input
            name="name"
            type="text"
            defaultValue={searchParams.name}
            placeholder="搜索项目名称或关键词"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <Link
            href="/service-names"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            重置
          </Link>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            搜索
          </button>
        </div>
      </form>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">项目名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">所属分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">搜索关键词</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联配件</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {names?.map((n: any) => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{n.name}</td>
                  <td className="px-6 py-4 text-gray-600">{n.service_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{n.search_keywords || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{(n.service_name_part_names as any)?.[0]?.count ?? 0}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/service-names/${n.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                      <DeleteButton id={n.id} name={n.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!names || names.length === 0) && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
