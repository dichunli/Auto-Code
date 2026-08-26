import { createClient } from "@/lib/supabase/server";
import FollowUpsContent, { type 回访记录 } from "./FollowUpsContent";

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const supabase = await createClient();
  const { status } = await searchParams;

  const now = new Date().toISOString();

  /* 首屏只取第 1 页（20 条）+ 总数 */
  let query = supabase
    .from("follow_ups")
    .select("*, work_orders(id, order_no, vehicles(plate_number, brand, model), customers(name, phone))", { count: "exact" })
    .order("scheduled_at", { ascending: true });

  if (status === "pending") {
    query = query.is("completed_at", null).gt("scheduled_at", now);
  } else if (status === "overdue") {
    query = query.is("completed_at", null).lte("scheduled_at", now);
  } else if (status === "completed") {
    query = query.not("completed_at", "is", null);
  }

  const { data, count } = await query.range(0, 19);

  /* key 随状态筛选变化强制重挂载，客户端分页状态随之重置回第 1 页 */
  return (
    <FollowUpsContent
      key={status || ""}
      status={status || ""}
      initialFollowUps={((data || []) as unknown as 回访记录[])}
      initialCount={count || 0}
    />
  );
}
