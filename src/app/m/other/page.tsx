import { createClient } from "@/lib/supabase/server";
import MobileOtherContent, { type 记录 } from "./MobileOtherContent";

/* 手机端其它收支 — Server Component
 * 首屏记录（当前月份）在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白；
 * 切换月份后客户端仍自行加载 */

export default async function MobileOtherPage(props: {
  searchParams?: Promise<Record<string, string | undefined>> | Record<string, string | undefined>;
}) {
  const searchParams = (await Promise.resolve(props.searchParams || {})) as Record<string, string | undefined>;
  const month = searchParams.month || "";

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonth = month || defaultMonth;

  /* 与客户端 loadRecords 完全一致的月份范围计算 */
  const [yearStr, monthStr] = currentMonth.split("-");
  const yearNum = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  const startDate = `${currentMonth}-01`;
  const endDay = new Date(yearNum, monthNum, 0).getDate();
  const endDate = `${currentMonth}-${String(endDay).padStart(2, "0")}`;

  const supabase = await createClient();
  const { data } = await supabase
    .from("other_transactions")
    .select(
      "*, profiles(full_name), other_payment_methods(name), other_transaction_categories(name)"
    )
    .gte("transaction_date", startDate)
    .lte("transaction_date", endDate)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <MobileOtherContent
      initialMonth={month}
      initialRecords={(data || []) as unknown as 记录[]}
    />
  );
}
