import { createClient } from "@/lib/supabase/server";
import OtherStatsContent from "./OtherStatsContent";

/* 其它收支统计 — Server Component
 * 首屏分类列表和提交人列表在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白；
 * 明细记录仍需选择日期后点「查询统计」加载 */

interface 分类 {
  id: string;
  name: string;
  type: string;
}

interface 提交人 {
  id: string;
  full_name: string;
}

export default async function OtherStatsPage() {
  const supabase = await createClient();
  const [{ data: categories }, { data: operators }] = await Promise.all([
    supabase
      .from("other_transaction_categories")
      .select("id, name, type")
      .or("is_active.eq.true,is_active.is.null")
      .order("sort_order"),
    supabase.from("profiles").select("id, full_name").order("full_name"),
  ]);

  return (
    <OtherStatsContent
      initialCategories={(categories || []) as 分类[]}
      initialOperators={(operators || []) as 提交人[]}
    />
  );
}
