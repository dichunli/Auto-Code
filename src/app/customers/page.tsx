import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function CustomersPage() {
  const supabase = await createClient();

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, phone, created_at, vehicles(id, plate_number, brand, model)")
    .order("created_at", { ascending: false });

  const customerIds = customers?.map((c: any) => c.id) || [];
  const { data: memberMap } = customerIds.length > 0
    ? await supabase.from("members").select("customer_id, card_no, balance").in("customer_id", customerIds)
    : { data: [] };

  const membersByCustomer: Record<string, any> = {};
  memberMap?.forEach((m: any) => {
    membersByCustomer[m.customer_id] = m;
  });

  return (
    <div>
      <PageHeader
        title="客户车辆"
        description="管理客户档案与车辆信息"
        action={{ href: "/customers/new", label: "新增客户" }}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">客户姓名</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">电话</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车辆</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">会员</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">注册时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customers?.map((customer: any) => (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{customer.name}</td>
                  <td className="px-6 py-4 text-gray-600">{customer.phone}</td>
                  <td className="px-6 py-4">
                    {customer.vehicles?.length > 0 ? (
                      <div className="space-y-1">
                        {customer.vehicles.map((v: any) => (
                          <div key={v.id} className="text-gray-700 text-sm flex items-center gap-2">
                            <Link href={`/vehicles/${v.id}/templates`} className="hover:text-blue-600 hover:underline">
                              {v.plate_number} ({v.brand} {v.model})
                            </Link>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">模板</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-sm">暂无车辆</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {membersByCustomer[customer.id] ? (
                      <Link
                        href={`/members/${membersByCustomer[customer.id].id}`}
                        className="text-sm text-green-600 hover:text-green-700"
                      >
                        {membersByCustomer[customer.id].card_no}
                        <span className="text-gray-400 ml-1">({formatCurrency(membersByCustomer[customer.id].balance)})</span>
                      </Link>
                    ) : (
                      <Link
                        href={`/members/new?customer_id=${customer.id}`}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        + 办理会员
                      </Link>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-500">{formatDate(customer.created_at)}</td>
                </tr>
              ))}
              {(!customers || customers.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    暂无客户数据
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
