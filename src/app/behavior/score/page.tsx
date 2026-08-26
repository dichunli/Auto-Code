import { createClient } from "@/lib/supabase/server";
import BehaviorScoreContent from "./BehaviorScoreContent";

interface 员工 {
  id: string;
  full_name: string;
}

interface 行为项目 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
}

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 打分后的客户端重查逻辑在 BehaviorScoreContent 内保持不变 */
export default async function BehaviorScorePage() {
  const supabase = await createClient();
  const [{ data: empData }, { data: itemData }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("behavior_score_items").select("id, name, score_type, score_value").eq("is_active", true).order("name"),
  ]);

  /* 首屏只取第一页（20 条）+ 总数，原 .limit(30) 硬截断改为真分页 */
  const { data: recordData, count } = await supabase
    .from("behavior_score_records")
    .select("id, score, notes, scored_at, event_time, media_urls, profiles!behavior_score_records_employee_id_fkey(full_name), behavior_score_items(name, score_type)", { count: "exact" })
    .order("scored_at", { ascending: false })
    .range(0, 19);

  const records = (recordData || []).map((r: unknown) => {
    const rec = r as {
      id: string;
      score: number;
      notes: string | null;
      scored_at: string;
      event_time: string;
      media_urls: string[] | null;
      profiles: { full_name: string }[] | { full_name: string } | null;
      behavior_score_items: { name: string; score_type: string }[] | { name: string; score_type: string } | null;
    };
    const profile = Array.isArray(rec.profiles) ? rec.profiles[0] : rec.profiles;
    const item = Array.isArray(rec.behavior_score_items) ? rec.behavior_score_items[0] : rec.behavior_score_items;
    return {
      id: rec.id,
      employee_name: profile?.full_name || "",
      item_name: item?.name || "",
      score_type: item?.score_type || "",
      score: rec.score,
      notes: rec.notes,
      scored_at: rec.scored_at,
      event_time: rec.event_time,
      media_urls: rec.media_urls || [],
    };
  });

  return (
    <BehaviorScoreContent
      initialEmployees={(empData as 员工[] | null) || []}
      initialItems={(itemData as 行为项目[] | null) || []}
      initialRecords={records}
      initialCount={count || 0}
    />
  );
}
