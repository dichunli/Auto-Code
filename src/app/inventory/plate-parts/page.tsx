import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";

export default async function PlatePartsPage() {
  const supabase = await createClient();

  // 查询已绑定车牌但未出库的配件
  const { data: items } = await supabase
    .from("work_order_item_parts")
    .select(
      `
      *,
      parts(part_number, name, unit),
      work_order_items(work_order_id, work_orders(vehicle_id, vehicles(plate_number, vehicle_models(brand, series))))
    `
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="绑定车牌配件"
        description="已关联工单但未出库的配件（机油/滤芯等耗材跟踪）"
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车牌</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件编号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items?.map((item: any) => {
                const vehicle = item.work_order_items?.work_orders?.vehicles;
                const vehicleModel = vehicle?.vehicle_models;
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {vehicle?.plate_number || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {vehicleModel
                        ? `${vehicleModel.brand} ${vehicleModel.series}`
                        : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {item.parts?.part_number || "-"}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {item.parts?.name || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {item.quantity} {item.parts?.unit || ""}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs px-2 py-0.5 rounded bg-yellow-50 text-yellow-700">
                        待出库
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(item.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
              {(!items || items.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                    暂无绑定车牌的待出库配件
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
