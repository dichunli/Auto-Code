import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { SubNav } from "../customers/SubNav";
import { DeleteButton } from "./DeleteButton";

export default async function CompaniesPage(props: { searchParams?: Promise<Record<string, string | undefined>> | Record<string, string | undefined> }) {
  const searchParams = (await Promise.resolve(props.searchParams || {})) as Record<string, string | undefined>;
  const supabase = await createClient();

  let query = supabase
    .from("companies")
    .select("id, name, contact, phone, address, credit_limit, payment_terms, notes, created_at")
    .order("created_at", { ascending: false });

  if (searchParams.name) query = query.ilike("name", `%${searchParams.name}%`);
  if (searchParams.contact) query = query.ilike("contact", `%${searchParams.contact}%`);
  if (searchParams.phone) query = query.ilike("phone", `%${searchParams.phone}%`);
  if (searchParams.address) query = query.ilike("address", `%${searchParams.address}%`);

  const { data: companies } = await query;

  const companyIds = companies?.map((c: any) => c.id) || [];
  const { data: vehicleCounts } = companyIds.length > 0
    ? await supabase.from("vehicles").select("company_id").in("company_id", companyIds)
    : { data: [] };

  const countByCompany: Record<string, number> = {};
  vehicleCounts?.forEach((v: any) => {
    countByCompany[v.company_id] = (countByCompany[v.company_id] || 0) + 1;
  });

  return (
    <div>
      <PageHeader
        title="单位管理"
        description="管理合作单位与客户公司"
        action={{ href: "/companies/new", label: "新增单位" }}
      />

      <SubNav />

      {/* 搜索栏 */}
      <form method="GET" className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            name="name"
            type="text"
            defaultValue={searchParams.name}
            placeholder="单位名称"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <input
            name="contact"
            type="text"
            defaultValue={searchParams.contact}
            placeholder="联系人"
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
            name="address"
            type="text"
            defaultValue={searchParams.address}
            placeholder="地址"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <div className="mt-3 flex gap-2 justify-end">
          <Link
            href="/companies"
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">单位名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">联系人</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">联系电话</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">地址</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">信用额度</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">结算方式</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联车辆数</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {companies?.map((company: any) => (
                <tr key={company.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{company.name}</td>
                  <td className="px-6 py-4 text-gray-600">{company.contact || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{company.phone || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{company.address || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(company.credit_limit)}</td>
                  <td className="px-6 py-4 text-gray-600">{company.payment_terms || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{countByCompany[company.id] || 0}</td>
                  <td className="px-6 py-4 text-gray-600">{company.notes || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{formatDate(company.created_at)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/companies/${company.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                      <DeleteButton id={company.id} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!companies || companies.length === 0) && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                    暂无单位数据
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
