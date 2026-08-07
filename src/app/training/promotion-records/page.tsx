import { createClient } from "@/lib/supabase/server";
import PromotionRecordsContent from "./PromotionRecordsContent";

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 审核操作后的客户端重查逻辑在 PromotionRecordsContent 内保持不变 */
export default async function PromotionRecordsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("promotion_records")
    .select("id, employee_id, type, reason, course_points, work_order_count, rework_loss_total, daily_loss_total, behavior_score_total, status, created_at, to_level_id, profiles!promotion_records_employee_id_fkey(full_name), from_level:mechanic_levels!promotion_records_from_level_id_fkey(name), to_level:mechanic_levels!promotion_records_to_level_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(50);

  const records = (data || []).map((r: unknown) => {
    const rec = r as {
      id: string;
      employee_id: string;
      type: string;
      reason: string;
      course_points: number;
      work_order_count: number;
      rework_loss_total: number;
      daily_loss_total: number;
      behavior_score_total: number;
      status: string;
      created_at: string;
      to_level_id: string | null;
      profiles: { full_name: string }[] | { full_name: string } | null;
      from_level: { name: string }[] | { name: string } | null;
      to_level: { name: string }[] | { name: string } | null;
    };
    const profile = Array.isArray(rec.profiles) ? rec.profiles[0] : rec.profiles;
    const fromLv = Array.isArray(rec.from_level) ? rec.from_level[0] : rec.from_level;
    const toLv = Array.isArray(rec.to_level) ? rec.to_level[0] : rec.to_level;
    return {
      id: rec.id,
      employee_id: rec.employee_id,
      employee_name: profile?.full_name || "",
      type: rec.type,
      from_level_name: fromLv?.name || "无等级",
      to_level_name: toLv?.name || "",
      to_level_id: rec.to_level_id,
      reason: rec.reason,
      course_points: rec.course_points,
      work_order_count: rec.work_order_count,
      rework_loss_total: rec.rework_loss_total,
      daily_loss_total: rec.daily_loss_total,
      behavior_score_total: rec.behavior_score_total,
      status: rec.status,
      created_at: rec.created_at,
    };
  });

  return <PromotionRecordsContent initialRecords={records} />;
}
