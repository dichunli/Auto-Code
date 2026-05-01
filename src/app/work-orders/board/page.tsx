import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function WorkOrderBoardPage() {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("work_order_items")
    .select(`
      id, name, alias_name, status, quantity, mechanic_id,
      work_orders(id, order_no, status, vehicles(plate_number, brand, model)),
      profiles!work_order_items_mechanic_id_fkey(full_name)
    `)
    .eq("item_type", "labor")
    .order("created_at", { ascending: false })
    .limit(200);

  const columns = [
    { key: "pending", label: "未开始", color: "bg-gray-50 border-gray-200" },
    { key: "in_progress", label: "施工中", color: "bg-blue-50 border-blue-200" },
    { key: "paused", label: "已中断", color: "bg-yellow-50 border-yellow-200" },
    { key: "completed", label: "已完工", color: "bg-green-50 border-green-200" },
  ];

  return (
    <div>
      <PageHeader
        title="维修看板"
        description="实时查看所有维修项目的施工状态"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {columns.map((col) => {
          const colItems = items?.filter((i: any) => i.status === col.key) || [];
          return (
            <div key={col.key} className={`rounded-xl border ${col.color} p-4`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">{col.label}</h3>
                <span className="text-xs text-gray-500">{colItems.length}</span>
              </div>
              <div className="space-y-2">
                {colItems.map((item: any) => (
                  <Link
                    key={item.id}
                    href={`/work-orders/${item.work_orders?.id}`}
                    className="block bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm transition-shadow"
                  >
                    <div className="text-sm font-medium text-gray-900">
                      {item.alias_name || item.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {item.work_orders?.vehicles?.plate_number} · {item.work_orders?.order_no}
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-xs">
                      <span className="text-gray-500">
                        技师: {(item.profiles as any)?.full_name || "未分配"}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        item.work_orders?.status === 'repairing'
                          ? 'bg-blue-50 text-blue-600'
                          : item.work_orders?.status === 'pending_repair'
                          ? 'bg-orange-50 text-orange-600'
                          : 'bg-gray-50 text-gray-500'
                      }`}>
                        {item.work_orders?.status}
                      </span>
                    </div>
                  </Link>
                ))}
                {colItems.length === 0 && (
                  <div className="text-xs text-gray-400 text-center py-4">暂无项目</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
