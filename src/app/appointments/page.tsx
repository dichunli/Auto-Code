import { createClient } from "@/lib/supabase/server";
import AppointmentsContent from "./AppointmentsContent";

/* 首屏只取第一页（20 条）+ 总数；日期筛选走 URL（服务端过滤），翻页由客户端组件接管 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const supabase = await createClient();
  const { date } = await searchParams;

  const today = new Date().toISOString().split("T")[0];

  let query = supabase
    .from("appointments")
    .select("*", { count: "exact" })
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true })
    .range(0, 19);

  if (date === "today") {
    query = query.eq("appointment_date", today);
  } else if (date === "tomorrow") {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    query = query.eq("appointment_date", tomorrow.toISOString().split("T")[0]);
  } else if (date === "week") {
    const weekLater = new Date();
    weekLater.setDate(weekLater.getDate() + 7);
    query = query.gte("appointment_date", today).lte("appointment_date", weekLater.toISOString().split("T")[0]);
  }

  const { data: appointments, count } = await query;

  return (
    <AppointmentsContent
      key={date || ""}
      initialAppointments={appointments || []}
      initialCount={count || 0}
      dateFilter={date || ""}
    />
  );
}
