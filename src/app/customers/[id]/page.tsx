import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import VehicleSearchAdd from "./VehicleSearchAdd";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .single();

  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, plate_number, brand, model, vin, color, year, mileage, notes")
    .eq("customer_id", id)
    .order("created_at", { ascending: false });

  const { data: photos } = await supabase
    .from("customer_photos")
    .select("category, url")
    .eq("customer_id", id);

  const customerPhotoUrls = photos?.map((p) => p.url) || [];

  const { data: contacts } = await supabase
    .from("customer_contacts")
    .select("id, name, phone, relationship, notes")
    .eq("customer_id", id)
    .order("created_at", { ascending: true });

  const { data: customerPhones } = await supabase
    .from("customer_phones")
    .select("phone, label")
    .eq("customer_id", id)
    .order("created_at", { ascending: true });

  if (!customer) {
    return (
      <div className="py-8 text-sm text-gray-500">客户不存在</div>
    );
  }

  return (
    <div>
      <PageHeader
        title="客户详情"
        description={`${customer.name} 的档案信息`}
        action={{ href: `/customers/${id}/edit`, label: "编辑客户" }}
      />

      <div className="space-y-6 max-w-4xl">
        {/* 基本信息 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">基本信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">客户姓名：</span>
              <span className="text-gray-900 font-medium">{customer.name}</span>
              {customer.gender && <span className="text-gray-400 ml-1">({customer.gender})</span>}
            </div>
            <div>
              <span className="text-gray-500">联系电话：</span>
              <span className="text-gray-900">{customer.phone}</span>
            </div>
            {(customerPhones && customerPhones.length > 0) && (
              <div className="sm:col-span-2">
                <span className="text-gray-500">备用手机号：</span>
                <div className="inline-flex flex-wrap gap-2 mt-1">
                  {customerPhones.map((p, i) => (
                    <span key={i} className="text-gray-900">
                      {p.phone}
                      {p.label && <span className="text-gray-400 text-xs ml-1">({p.label})</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="text-gray-500">所属单位：</span>
              <span className="text-gray-900">{customer.company || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">身份证号：</span>
              <span className="text-gray-900">{customer.id_card || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">地址：</span>
              <span className="text-gray-900">{customer.address || "-"}</span>
            </div>
            <div className="sm:col-span-3">
              <span className="text-gray-500">备注：</span>
              <span className="text-gray-900">{customer.notes || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">注册时间：</span>
              <span className="text-gray-900">{formatDate(customer.created_at)}</span>
            </div>
          </div>
        </div>

        {/* 联系人 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">联系人</h2>
          {contacts && contacts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">姓名</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">电话</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">关系</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">备注</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contacts.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-3 text-gray-600">{c.phone}</td>
                      <td className="px-4 py-3 text-gray-600">{c.relationship || "-"}</td>
                      <td className="px-4 py-3 text-gray-600">{c.notes || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-400">暂无联系人</p>
          )}
        </div>

        {/* 客户照片 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">客户照片</h2>
          {customerPhotoUrls.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {customerPhotoUrls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`客户照片 ${i + 1}`}
                  className="w-32 h-24 object-cover rounded border border-gray-200"
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">暂无照片</p>
          )}
        </div>

        {/* 关联车辆 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <VehicleSearchAdd customerId={id} initialVehicles={vehicles || []} />
        </div>
      </div>
    </div>
  );
}
