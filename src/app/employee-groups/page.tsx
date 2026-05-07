import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { EmployeeGroupList } from "./EmployeeGroupList";

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

      <EmployeeGroupList groups={groups || []} />
    </div>
  );
}
