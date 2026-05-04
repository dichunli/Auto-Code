import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { SubNav } from "./SubNav";
import { DeleteButton } from "./DeleteButton";

export default async function CustomersPage(props: { searchParams?: Promise<Record<string, string | undefined>> | Record<string, string | undefined> }) {
  const searchParams = (await Promise.resolve(props.searchParams || {})) as Record<string, string | undefined>;
  const supabase = await createClient();

  let query = supabase
    .from("customers")
    .select("id, name, phone, company, address, star_level, total_spent, created_at, vehicles(id, plate_number), customer_contacts(id, name, phone, relationship)")
    .order("created_at", { ascending: false });

  if (searchParams.name) query = query.ilike("name", `%${searchParams.name}%`);
  if (searchParams.phone) query = query.ilike("phone", `%${searchParams.phone}%`);
  if (searchParams.company) query = query.ilike("company", `%${searchParams.company}%`);
  if (searchParams.address) query = query.ilike("address", `%${searchParams.address}%`);

  const { data: customers } = await query;

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
        title="客户管理"
        description="管理客户档案"
        action={{ href: "/customers/new", label: "新增客户" }}
      />

      <SubNav />

      {/* 搜索栏 */}
      <form method="GET" className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            name="name"
            type="text"
            defaultValue={searchParams.name}
            placeholder="客户姓名"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <input
            name="phone"
            type="text"
            defaultValue={searchParams.phone}
            placeholder="联系电话"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <input
            name="company"
            type="text"
            defaultValue={searchParams.company}
            placeholder="所属单位"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <input
            name="address"
            type="text"
            defaultValue={searchParams.address}
            placeholder="地址"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <div className="mt-3 flex gap-2 justify-end">
          <Link
            href="/customers"
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">客户姓名</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">电话</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">联系人</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">所属单位</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">地址</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">星级</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">累计消费</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联车辆</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">会员</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">注册时间</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customers?.map((customer: any) => (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {customer.name}
                    {customer.gender && <span className="ml-1 text-xs text-gray-400">{customer.gender}</span>}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{customer.phone}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {customer.customer_contacts?.length > 0 ? (
                      <div className="space-y-1">
                        {customer.customer_contacts.map((c: any) => (
                          <div key={c.id} className="text-xs">
                            <span className="font-medium">{c.name}</span>
                            <span className="text-gray-400 mx-1">·</span>
                            {c.phone}
                            {c.relationship && <span className="text-gray-400 ml-1">({c.relationship})</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{customer.company || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{customer.address || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{"★".repeat(customer.star_level || 1)}{"☆".repeat(5 - (customer.star_level || 1))}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(customer.total_spent)}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {customer.vehicles?.length > 0 ? (
                      <div className="text-sm">
                        {customer.vehicles.map((v: any, i: number) => (
                          <span key={v.id}>
                            <Link
                              href={`/vehicles/${v.id}/edit`}
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {v.plate_number}
                            </Link>
                            {i < customer.vehicles.length - 1 && <span className="text-gray-400">, </span>}
                          </span>
                        ))}
                      </div>
                    ) : (
                      "-"
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
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/customers/${customer.id}`} className="text-xs text-gray-600 hover:text-gray-800 hover:underline">查看</Link>
                      <Link href={`/customers/${customer.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                      <DeleteButton id={customer.id} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!customers || customers.length === 0) && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-gray-400">
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
