import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { ConstructionStatsFilter } from "./ConstructionStatsFilter";

function formatDuration(totalSeconds: number) {
  if (!totalSeconds || totalSeconds <= 0) return "-";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const parts = [];
  if (h > 0) parts.push(`${h}时`);
  if (m > 0) parts.push(`${m}分`);
  if (s > 0 || parts.length === 0) parts.push(`${s}秒`);
  return parts.join("");
}

export default async function ConstructionStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ mechanic?: string; search?: string }>;
}) {
  const { mechanic, search } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("work_order_item_construction_stats")
    .select("*")
    .eq("status", "completed")
    .order("created_at", { ascending: false });

  if (mechanic) {
    query = query.eq("mechanic_name", mechanic);
  }
  if (search) {
    query = query.ilike("item_name", `%${search}%`);
  }

  const { data: stats } = await query;

  const { data: mechanicList } = await supabase
    .from("work_order_item_construction_stats")
    .select("mechanic_name")
    .eq("status", "completed");

  const allMechanics = Array.from(
    new Set((mechanicList || []).map((s: any) => s.mechanic_name).filter(Boolean))
  ).sort();

  return (
    <div className="space-y-6">
      <PageHeader title="施工用时统计" description="查看各项目、各车型、各技师的施工时长统计" />

      {/* 筛选 */}
      <ConstructionStatsFilter mechanic={mechanic} search={search} allMechanics={allMechanics} />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">统计记录数</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{stats?.length || 0}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">总施工时长</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {formatDuration(stats?.reduce((sum: number, s: any) => sum + (s.construction_seconds || 0), 0) || 0)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">总中断时长</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {formatDuration(stats?.reduce((sum: number, s: any) => sum + (s.pause_seconds || 0), 0) || 0)}
          </div>
        </div>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">项目名称</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">车型信息</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">施工人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">施工时长</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">中断时长</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">总时长</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">完工时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats?.map((s: any) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.item_name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <div className="space-y-0.5">
                      {s.vehicle_brand && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.vehicle_brand}</span>}
                      {s.vehicle_series && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.vehicle_series}</span>}
                      {s.vehicle_model_name && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.vehicle_model_name}</span>}
                      {s.vehicle_displacement && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.vehicle_displacement}</span>}
                      {s.vehicle_engine && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.vehicle_engine}</span>}
                      {s.vehicle_chassis && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.vehicle_chassis}</span>}
                      {s.vehicle_transmission && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.vehicle_transmission}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.mechanic_name}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDuration(s.construction_seconds)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDuration(s.pause_seconds)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{formatDuration(s.total_seconds)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {s.completed_at ? new Date(s.completed_at).toLocaleString("zh-CN") : "-"}
                  </td>
                </tr>
              ))}
              {(!stats || stats.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                    暂无施工统计记录
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
