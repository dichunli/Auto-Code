import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

export default async function ServiceItemsPage() {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("service_items")
    .select("*, service_categories(name), service_names(name)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader title="维修项目" description="管理维修项目实例，关联分类和名称库" action={{ href: "/service-items/new", label: "新建项目" }} />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">编码</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">项目名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">标准工时</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">默认价格</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车型定价</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items?.map((item: any) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-gray-600">{item.code || "-"}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                  <td className="px-6 py-4 text-gray-600">{item.service_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{item.standard_hours || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(item.default_price)}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded ${item.is_vehicle_specific ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600"}`}>
                      {item.is_vehicle_specific ? "按车型定价" : "通用价格"}
                    </span>
                  </td>
                </tr>
              ))}
              {(!items || items.length === 0) && (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400">暂无维修项目</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
