import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function EmployeeGroupsPage() {
  const supabase = await createClient();

  const { data: groups } = await supabase
    .from("employee_groups")
    .select("*, profiles(count)")
    .order("sort_order");

  return (
    <div>
      <PageHeader
        title="分组管理"
        description="管理员工分组/部门"
        action={{ href: "/employee-groups/new", label: "新建分组" }}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分组名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">描述</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">排序</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">人数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groups?.map((g: any) => (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <Link href={`/employees?group=${g.id}`} className="text-blue-600 hover:text-blue-700">
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{g.description || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{g.sort_order}</td>
                  <td className="px-6 py-4 text-gray-600">{g.profiles?.[0]?.count || 0}</td>
                </tr>
              ))}
              {(!groups || groups.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-400">
                    暂无分组
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
