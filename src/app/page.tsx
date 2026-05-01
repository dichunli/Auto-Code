import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();

  const today = new Date().toISOString().split("T")[0];

  const { data: recentOrders } = await supabase
    .from("work_orders")
    .select("id, order_no, status, total_cost, created_at, vehicles(plate_number, brand, model)")
    .order("created_at", { ascending: false })
    .limit(5);

  const { count: totalOrders } = await supabase.from("work_orders").select("*", { count: "exact", head: true });
  const { count: activeOrders } = await supabase.from("work_orders").select("*", { count: "exact", head: true }).in("status", ["received", "diagnosing", "quoted", "repairing", "quality_check"]);
  const { count: pendingQuality } = await supabase.from("work_orders").select("*", { count: "exact", head: true }).eq("status", "quality_check");
  const { count: pendingSettle } = await supabase.from("work_orders").select("*", { count: "exact", head: true }).eq("status", "completed");
  const { count: lowStock } = await supabase.from("parts").select("*", { count: "exact", head: true }).lte("quantity", 10);

  const { data: todayRevenue } = await supabase.from("payments").select("amount").gte("paid_at", `${today}T00:00:00`);
  const todayTotal = todayRevenue?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0;

  const { count: memberCount } = await supabase.from("members").select("*", { count: "exact", head: true }).eq("status", "active");
  const { data: todayRecharges } = await supabase.from("member_transactions").select("amount").eq("type", "recharge").gte("created_at", `${today}T00:00:00`);
  const todayRechargeTotal = todayRecharges?.reduce((sum: number, t: any) => sum + (t.amount || 0), 0) || 0;

  const { count: todayAppointments } = await supabase.from("appointments").select("*", { count: "exact", head: true }).eq("appointment_date", today).eq("status", "pending");

  const { count: pendingReminders } = await supabase.from("maintenance_reminders").select("*", { count: "exact", head: true }).eq("status", "pending");

  const { data: birthdayCustomers } = await supabase
    .from("customers")
    .select("id, name, phone")
    .not("birthday", "is", null)
    .ilike("birthday", `%${today.slice(5)}`);

  const { data: topMechanics } = await supabase
    .from("mechanic_scores")
    .select("mechanic_id, points, profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(20);

  const mechanicMap: Record<string, { name: string; score: number }> = {};
  topMechanics?.forEach((m: any) => {
    const id = m.mechanic_id;
    if (!mechanicMap[id]) mechanicMap[id] = { name: m.profiles?.full_name || "未知", score: 0 };
    mechanicMap[id].score += m.points;
  });
  const mechanicRank = Object.values(mechanicMap).sort((a, b) => b.score - a.score).slice(0, 5);

  const stats = [
    { label: "本月工单", value: totalOrders || 0, color: "bg-blue-500" },
    { label: "在修车辆", value: activeOrders || 0, color: "bg-amber-500" },
    { label: "今日营收", value: `¥${todayTotal.toFixed(0)}`, color: "bg-emerald-500", isText: true },
    { label: "待质检", value: pendingQuality || 0, color: "bg-purple-500" },
    { label: "待结算", value: pendingSettle || 0, color: "bg-orange-500" },
    { label: "库存预警", value: lowStock || 0, color: "bg-red-500" },
    { label: "活跃会员", value: memberCount || 0, color: "bg-cyan-500" },
    { label: "今日充值", value: `¥${todayRechargeTotal.toFixed(0)}`, color: "bg-indigo-500", isText: true },
    { label: "今日预约", value: todayAppointments || 0, color: "bg-pink-500" },
    { label: "保养到期", value: pendingReminders || 0, color: "bg-rose-500" },
  ];

  return (
    <div>
      <PageHeader title="仪表盘" description="维修厂运营概览" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`w-10 h-10 ${stat.color} rounded-lg flex items-center justify-center mb-3`}>
              <span className="text-white font-bold text-sm">{stat.isText ? "¥" : stat.value}</span>
            </div>
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className="text-lg font-bold text-gray-900">{stat.isText ? stat.value : stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">最近工单</h2>
            <Link href="/work-orders" className="text-sm text-blue-600 hover:text-blue-700">查看全部 →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">工单号</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">车辆</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">金额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentOrders?.map((order: any) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      <Link href={`/work-orders/${order.id}`} className="hover:text-blue-600">{order.order_no}</Link>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{order.vehicles?.plate_number}</td>
                    <td className="px-6 py-4"><StatusBadge status={order.status} /></td>
                    <td className="px-6 py-4 text-gray-900">{formatCurrency(order.total_cost)}</td>
                  </tr>
                ))}
                {(!recentOrders || recentOrders.length === 0) && (
                  <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400">暂无工单数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">技师绩效排行</h2>
          <div className="space-y-3">
            {mechanicRank.map((m, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-100 text-gray-700' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-gray-50 text-gray-500'}`}>{i + 1}</span>
                  <span className="text-sm text-gray-900">{m.name}</span>
                </div>
                <span className={`text-sm font-bold ${m.score >= 0 ? 'text-green-600' : 'text-red-600'}`}>{m.score > 0 ? '+' : ''}{m.score}</span>
              </div>
            ))}
            {mechanicRank.length === 0 && <p className="text-sm text-gray-400 text-center py-4">暂无绩效数据</p>}
          </div>
        </div>
      </div>

      {/* 生日提醒 */}
      {birthdayCustomers && birthdayCustomers.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6"
        >
          <h2 className="text-lg font-semibold text-gray-900 mb-4"
          >今日生日客户 🎂</h2>
          <div className="flex flex-wrap gap-3"
          >
            {birthdayCustomers.map((c: any) => (
              <div key={c.id} className="flex items-center gap-2 px-4 py-2 bg-pink-50 text-pink-700 rounded-lg text-sm"
              >
                <span className="font-medium"
                >{c.name}</span>
                {c.phone && <span className="text-pink-500"
                >({c.phone})</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
