import { createClient } from "@/lib/supabase/server";
import OperationLogsContent from "./OperationLogsContent";

/* 首屏只取第一页（20 条）+ 总数；筛选走 URL（表单 GET 提交，服务端过滤），翻页由客户端组件接管 */
export default async function OperationLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ actionType?: string; userName?: string; keyword?: string }>;
}) {
  const { actionType, userName, keyword } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("operation_logs")
    .select("id, user_name, action_type, target_table, target_name, description, old_values, new_values, ip_address, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, 19);

  if (actionType) {
    query = query.eq("action_type", actionType);
  }
  if (userName) {
    query = query.ilike("user_name", `%${userName}%`);
  }
  if (keyword) {
    query = query.or(`description.ilike.%${keyword}%,target_name.ilike.%${keyword}%`);
  }

  const { data: logs, count } = await query;

  return (
    <OperationLogsContent
      key={`${actionType || ""}|${userName || ""}|${keyword || ""}`}
      initialLogs={logs || []}
      initialCount={count || 0}
      actionType={actionType || ""}
      userName={userName || ""}
      keyword={keyword || ""}
    />
  );
}
