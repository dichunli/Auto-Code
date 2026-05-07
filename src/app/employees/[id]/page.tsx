import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: employee } = await supabase
    .from("profiles")
    .select("*, employee_groups(name), mechanic_levels(name), profile_roles(role_id, roles(name, label))")
    .eq("id", id)
    .single();

  if (!employee) notFound();

  const [{ data: workOrders }, { data: mechanicItems }, { data: contacts }] = await Promise.all([
    supabase
      .from("work_orders")
      .select("id, order_no, status, total_cost, settled_at")
      .eq("receptionist_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("work_order_items")
      .select("work_order_id, name, total_price, status")
      .eq("mechanic_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("employee_contacts")
      .select("*")
      .eq("profile_id", id)
      .order("is_primary", { ascending: false }),
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title="员工详情" />

      {/* 基本信息 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">{employee.full_name}</h2>
          <div className="flex items-center gap-2">
            <Link
              href={`/employees/${id}/edit`}
              className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors"
            >
              编辑
            </Link>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                employee.is_active ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-500"
              }`}
            >
              {employee.is_active ? "在职" : "离职"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">电话:</span>{" "}
            <span className="text-gray-900">{employee.phone || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">分组:</span>{" "}
            <span className="text-gray-900">{employee.employee_groups?.name || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">性别:</span>{" "}
            <span className="text-gray-900">
              {employee.gender === "male" ? "男" : employee.gender === "female" ? "女" : employee.gender === "other" ? "其他" : "-"}
            </span>
          </div>
          <div>
            <span className="text-gray-500">入职日期:</span>{" "}
            <span className="text-gray-900">{employee.entry_date || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">技师等级:</span>{" "}
            <span className="text-gray-900">{employee.mechanic_levels?.name || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">注册时间:</span>{" "}
            <span className="text-gray-900">{formatDate(employee.created_at)}</span>
          </div>
          {employee.address && (
            <div className="sm:col-span-2">
              <span className="text-gray-500">地址:</span>{" "}
              <span className="text-gray-900">{employee.address}</span>
            </div>
          )}
          {employee.notes && (
            <div className="sm:col-span-2">
              <span className="text-gray-500">备注:</span>{" "}
              <span className="text-gray-900">{employee.notes}</span>
            </div>
          )}
        </div>

        <div className="mt-4">
          <span className="text-sm text-gray-500">角色:</span>{" "}
          <div className="inline-flex flex-wrap gap-1 mt-1">
            {employee.profile_roles?.map((pr: any) => (
              <span key={pr.role_id} className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                {pr.roles?.label || pr.roles?.name}
              </span>
            ))}
            {(!employee.profile_roles || employee.profile_roles.length === 0) && (
              <span className="text-sm text-gray-400">未分配角色</span>
            )}
          </div>
        </div>
      </div>

      {/* 联系人 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">联系人</h3>
        {contacts && contacts.length > 0 ? (
          <div className="space-y-3">
            {contacts.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between text-sm p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">{c.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">{c.relationship}</span>
                  {c.is_primary && (
                    <span className="text-xs px-2 py-0.5 rounded bg-orange-50 text-orange-700">主要联系人</span>
                  )}
                </div>
                <span className="text-gray-600">{c.phone || "-"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">暂无联系人</p>
        )}
      </div>

      {/* 工作记录 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-3">接待工单（最近10条）</h3>
          <div className="space-y-2">
            {workOrders?.map((wo: any) => (
              <Link
                key={wo.id}
                href={`/work-orders/${wo.id}`}
                className="flex items-center justify-between text-sm p-2 rounded hover:bg-gray-50"
              >
                <span className="text-blue-600">{wo.order_no}</span>
                <span className="text-gray-500">{wo.status}</span>
              </Link>
            ))}
            {(!workOrders || workOrders.length === 0) && (
              <p className="text-sm text-gray-400">暂无接待记录</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-3">维修项目（最近10条）</h3>
          <div className="space-y-2">
            {mechanicItems?.map((item: any) => (
              <Link
                key={item.id}
                href={`/work-orders/${item.work_order_id}`}
                className="flex items-center justify-between text-sm p-2 rounded hover:bg-gray-50"
              >
                <span className="text-gray-700">{item.name}</span>
                <span className="text-gray-500">{item.status}</span>
              </Link>
            ))}
            {(!mechanicItems || mechanicItems.length === 0) && (
              <p className="text-sm text-gray-400">暂无维修记录</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
