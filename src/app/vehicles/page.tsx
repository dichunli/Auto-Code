import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { SubNav } from "../customers/SubNav";
import { DeleteButton } from "./DeleteButton";

export default async function VehiclesPage(props: { searchParams?: Promise<Record<string, string | undefined>> | Record<string, string | undefined> }) {
  const searchParams = (await Promise.resolve(props.searchParams || {})) as Record<string, string | undefined>;
  const supabase = await createClient();

  let query = supabase
    .from("vehicles")
    .select("id, plate_number, brand, model, vin, engine_no, color, year, mileage, notes, customer_id, customers(id, name, phone), companies(id, name)")
    .order("created_at", { ascending: false });

  if (searchParams.plate) query = query.ilike("plate_number", `%${searchParams.plate}%`);
  if (searchParams.brand) query = query.ilike("brand", `%${searchParams.brand}%`);
  if (searchParams.model) query = query.ilike("model", `%${searchParams.model}%`);
  if (searchParams.vin) query = query.ilike("vin", `%${searchParams.vin}%`);

  const { data: vehicles } = await query;

  return (
    <div>
      <PageHeader
        title="车辆管理"
        description="管理所有车辆档案"
        action={{ href: "/vehicles/new", label: "新增车辆" }}
      />

      <SubNav />

      {/* 搜索栏 */}
      <form method="GET" className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            name="plate"
            type="text"
            defaultValue={searchParams.plate}
            placeholder="车牌号"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <input
            name="brand"
            type="text"
            defaultValue={searchParams.brand}
            placeholder="品牌"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <input
            name="model"
            type="text"
            defaultValue={searchParams.model}
            placeholder="型号"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <input
            name="vin"
            type="text"
            defaultValue={searchParams.vin}
            placeholder="VIN 码"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <div className="mt-3 flex gap-2 justify-end">
          <Link
            href="/vehicles"
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">车牌号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">品牌</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">型号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">VIN码</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">发动机号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">颜色</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">年份</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">里程</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车主</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">所属单位</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vehicles?.map((v: any) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <Link href={`/vehicles/${v.id}/edit`} className="hover:text-blue-600 hover:underline">
                      {v.plate_number}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{v.brand || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{v.model || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{v.vin || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{v.engine_no || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{v.color || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{v.year ?? "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{v.mileage != null ? v.mileage.toLocaleString() : "-"}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {v.customers?.name ? (
                      <span>{v.customers.name} ({v.customers.phone})</span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{v.companies?.name || "-"}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/vehicles/${v.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                      <DeleteButton id={v.id} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!vehicles || vehicles.length === 0) && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-gray-400">
                    暂无车辆数据
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
