import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function EmployeesPage({ searchParams }: { searchParams?: Promise<{ group?: string; active?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("*, employee_groups(name), mechanic_levels(name), profile_roles(role_id, roles(name, label))")
    .order("created_at", { ascending: false });

  if (params?.group) query = query.eq("group_id", params.group);
  if (params?.active === "1") query = query.eq("is_active", true);
  if (params?.active === "0") query = query.eq("is_active", false);

  const { data: employees } = await query;
  const { data: groups } = await supabase.from("employee_groups").select("id, name").order("sort_order");

  return (
    <div>
      <PageHeader
        title="员工档案"
        description="管理员工信息、分组与角色"
        action={{ href: "/employees/new", label: "新增员工" }}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/employees"
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${!params?.group ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          全部
        </Link>
        {groups?.map((g: any) => (
          <Link
            key={g.id}
            href={`/employees?group=${g.id}`}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${params?.group === g.id ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
          >
            {g.name}
          </Link>
        ))}
        <Link
          href="/employees?active=1"
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${params?.active === "1" ? "bg-green-50 text-green-700 border-green-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          在职
        </Link>
        <Link
          href="/employees?active=0"
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${params?.active === "0" ? "bg-gray-50 text-gray-600 border-gray-300" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          离职
        </Link>
        <Link
          href="/employee-groups"
          className="ml-auto px-4 py-2 text-sm font-medium rounded-lg border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
        >
          分组管理
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">姓名</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">电话</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分组</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">角色</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">技师等级</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">入职日期</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {employees?.map((e: any) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link href={`/employees/${e.id}`} className="font-medium text-blue-600 hover:text-blue-700">
                      {e.full_name || "-"}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{e.phone || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{e.employee_groups?.name || "-"}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {e.profile_roles?.map((pr: any) => (
                        <span key={pr.role_id} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                          {pr.roles?.label || pr.roles?.name}
                        </span>
                      ))}
                      {(!e.profile_roles || e.profile_roles.length === 0) && "-"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{e.mechanic_levels?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{e.entry_date || "-"}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded ${e.is_active ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-500"}`}>
                      {e.is_active ? "在职" : "离职"}
                    </span>
                  </td>
                </tr>
              ))}
              {(!employees || employees.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                    暂无员工数据
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
