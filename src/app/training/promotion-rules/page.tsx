import { createClient } from "@/lib/supabase/server";
import PromotionRulesContent from "./PromotionRulesContent";
import type { 技师等级, 课程, 晋级规则 } from "./PromotionRulesContent";

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 增删改后的客户端重查逻辑在 PromotionRulesContent 内保持不变 */
export default async function PromotionRulesPage() {
  const supabase = await createClient();
  const [{ data: levelData }, { data: ruleData }, { data: courseData }] = await Promise.all([
    supabase.from("mechanic_levels").select("id, name").order("sort_order", { ascending: true }),
    supabase.from("promotion_rules").select("*").order("created_at", { ascending: false }),
    supabase.from("training_courses").select("id, title").eq("is_required", true).order("title"),
  ]);

  const levelMap = new Map<string, string>();
  (levelData as 技师等级[] | null)?.forEach((l) => levelMap.set(l.id, l.name));

  const rules = ((ruleData || []) as 晋级规则[]).map((r) => ({
    ...r,
    from_level_name: r.from_level_id ? levelMap.get(r.from_level_id) || "无等级" : "无等级",
    to_level_name: levelMap.get(r.to_level_id) || "未知",
    required_course_ids: r.required_course_ids || [],
  }));

  return (
    <PromotionRulesContent
      initialLevels={(levelData as 技师等级[] | null) || []}
      initialCourses={(courseData as 课程[] | null) || []}
      initialRules={rules}
    />
  );
}
