import { createClient } from "@/lib/supabase/server";
import { 清理搜索词 } from "@/lib/sanitizeQuery";
import { PageHeader } from "@/components/PageHeader";
import { ConstructionStatsFilter } from "./ConstructionStatsFilter";
import { StatsPagination } from "./StatsPagination";
import Link from "next/link";

/* 明细行（分页渲染，字段与 work_order_item_construction_stats 列一致） */
interface ConstructionStat {
  id: string;
  item_name: string;
  vehicle_brand: string | null;
  vehicle_series: string | null;
  vehicle_model_name: string | null;
  vehicle_displacement: string | null;
  vehicle_engine: string | null;
  vehicle_chassis: string | null;
  vehicle_transmission: string | null;
  mechanic_name: string;
  work_order_id: string;
  construction_seconds: number | null;
  pause_seconds: number | null;
  total_seconds: number | null;
  completed_at: string | null;
  created_at: string;
  status: string;
}

/* 分组聚合行（RPC report_construction_stats 返回，2026-09-19 起数据库端聚合） */
interface GroupedStat {
  item_name: string;
  vehicle_brand: string | null;
  vehicle_series: string | null;
  vehicle_model_name: string | null;
  vehicle_displacement: string | null;
  mechanic_name: string;
  cnt: number;
  total_construction_seconds: number;
  total_pause_seconds: number;
  total_total_seconds: number;
  work_order_ids: string[];
  avg_construction_seconds: number;
  avg_pause_seconds: number;
  avg_total_seconds: number;
}

interface 统计RPC返回 {
  groups?: GroupedStat[];
  mechanics?: string[];
  total_rows?: number;
  sum_construction_seconds?: number;
  sum_pause_seconds?: number;
  success?: boolean;
  error?: string;
}

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

const 每页条数 = 20;

export default async function ConstructionStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ mechanic?: string; search?: string; page?: string }>;
}) {
  const { mechanic, search, page: pageParam } = await searchParams;
  const supabase = await createClient();
  const 当前页 = Math.max(1, parseInt(pageParam || "1", 10) || 1);

  /* 聚合数据（分组+卡片+技师筛选项）改数据库端 RPC（2026-09-19，9-15 诊断🟠#11）：
   * 原来全表拉到内存分组；搜索词原拼 .or() 未清洗，下推后参数绑定无注入面。
   * 口径不变（NULL 归空串组/count 降序/avg=round(合计/次数)），对照见迁移 0919_e。 */
  const { data: 汇总 } = await supabase.rpc("report_construction_stats", {
    p_mechanic: mechanic || null,
    p_search: search?.trim() || null,
  });
  const 统计 = (汇总 || {}) as unknown as 统计RPC返回;
  const groupedStats = 统计.groups || [];
  const allMechanics = 统计.mechanics || [];
  const 记录总数 = Number(统计.total_rows || 0);
  const 总施工秒 = Number(统计.sum_construction_seconds || 0);
  const 总中断秒 = Number(统计.sum_pause_seconds || 0);

  /* 明细记录：服务端分页（超 50 条全量渲染违反性能规范，顺带补齐） */
  let 明细查询 = supabase
    .from("work_order_item_construction_stats")
    .select("*", { count: "exact" })
    .eq("status", "completed")
    .order("created_at", { ascending: false });

  if (mechanic) {
    明细查询 = 明细查询.eq("mechanic_name", mechanic);
  }
  if (search?.trim()) {
    /* 明细查询拼 .or() 过滤器字符串，用户输入必须清洗（防 PostgREST 过滤器结构注入）；
     * 清洗后为空（全是特殊字符）时不加过滤，按无搜索处理 */
    const s = 清理搜索词(search);
    if (s) {
      明细查询 = 明细查询.or(
        `item_name.ilike.%${s}%,vehicle_brand.ilike.%${s}%,vehicle_series.ilike.%${s}%,vehicle_model_name.ilike.%${s}%`
      );
    }
  }
  明细查询 = 明细查询.range((当前页 - 1) * 每页条数, 当前页 * 每页条数 - 1);

  const { data: stats, count: 明细总数 } = await 明细查询;

  return (
    <div className="space-y-6">
      <PageHeader title="施工用时统计" description="查看各项目、各车型、各技师的施工时长统计" />

      {/* 筛选 */}
      <ConstructionStatsFilter mechanic={mechanic} search={search} allMechanics={allMechanics} />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">统计记录数</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{记录总数}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">总施工时长</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {formatDuration(总施工秒)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">总中断时长</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {formatDuration(总中断秒)}
          </div>
        </div>
      </div>

      {/* 分组统计 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">按维修项目及车型分组统计</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">维修项目</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">车型信息</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">施工次数</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">平均施工时长</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">平均中断时长</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">平均总时长</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">涉及技师</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">关联工单</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groupedStats.map((g: GroupedStat, idx: number) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{g.item_name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <div className="space-y-0.5">
                      {g.vehicle_brand && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{g.vehicle_brand}</span>}
                      {g.vehicle_series && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{g.vehicle_series}</span>}
                      {g.vehicle_model_name && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{g.vehicle_model_name}</span>}
                      {g.vehicle_displacement && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{g.vehicle_displacement}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">{g.cnt}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDuration(Number(g.avg_construction_seconds))}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDuration(Number(g.avg_pause_seconds))}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{formatDuration(Number(g.avg_total_seconds))}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{g.mechanic_name}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <div className="flex flex-wrap gap-1">
                      {(g.work_order_ids || []).slice(0, 3).map((id: string) => (
                        <Link
                          key={id}
                          href={`/work-orders/${id}`}
                          className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded hover:bg-green-100"
                        >
                          {id.slice(0, 8)}
                        </Link>
                      ))}
                      {(g.work_order_ids || []).length > 3 && (
                        <span className="text-xs text-gray-400">等{g.work_order_ids.length}个</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {groupedStats.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                    暂无分组统计记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 明细记录（分页） */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">明细记录</h2>
        </div>
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
              {((stats || []) as unknown as ConstructionStat[]).map((s) => (
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
                  <td className="px-4 py-3 text-gray-600">{formatDuration(s.construction_seconds || 0)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDuration(s.pause_seconds || 0)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{formatDuration(s.total_seconds || 0)}</td>
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
        <StatsPagination page={当前页} totalCount={明细总数 || 0} pageSize={每页条数} />
      </div>
    </div>
  );
}
