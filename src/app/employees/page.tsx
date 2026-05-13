import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { EmployeeTree } from "./EmployeeTree";

export default async function EmployeesPage({ searchParams }: { searchParams?: Promise<{ active?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("id, full_name, phone, group_id, is_active, entry_date, mechanic_level_id, mechanic_levels(name, sort_order), profile_roles(role_id, roles(name, label))");

  if (params?.active === "1") query = query.eq("is_active", true);
  if (params?.active === "0") query = query.eq("is_active", false);

  query = query.order("full_name", { ascending: true });

  const { data: employees } = await query;
  const { data: groups } = await supabase
    .from("employee_groups")
    .select("id, name, sort_order")
    .order("sort_order");

  return (
    <div>
      <PageHeader
        title="员工档案"
        description="按分组树形展示员工档案"
        action={{ href: "/employees/new", label: "新增员工" }}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/employees"
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${!params?.active ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          全部
        </Link>
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

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/employee-groups"
            className="px-4 py-2 text-sm font-medium rounded-lg border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
          >
            分组管理
          </Link>
          <Link
            href="/mechanic-levels"
            className="px-4 py-2 text-sm font-medium rounded-lg border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors"
          >
            等级管理
          </Link>
        </div>
      </div>

      <EmployeeTree
        groups={groups || []}
        employees={(employees as any) || []}
      />
    </div>
  );
}
