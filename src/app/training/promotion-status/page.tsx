import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PromotionStatusContent from "./PromotionStatusContent";
import type { 等级信息, 晋级检查结果, 晋级规则 } from "./PromotionStatusContent";

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 未登录时服务端直接重定向到登录页（原客户端 router.push） */
export default async function PromotionStatusPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect("/login");
  }

  /* 获取员工当前等级 */
  const { data: profile } = await supabase
    .from("profiles")
    .select("mechanic_level_id, mechanic_levels(name)")
    .eq("id", userData.user.id)
    .single();

  const levelId = (profile as { mechanic_level_id: string | null })?.mechanic_level_id;
  const levelName = ((profile as { mechanic_levels: { name: string }[] | { name: string } | null })?.mechanic_levels);
  const name = Array.isArray(levelName) ? levelName[0]?.name : levelName?.name;
  const currentLevel: 等级信息 | null = name ? { id: levelId || "", name } : null;

  /* 查找下一个等级的规则 */
  const { data: ruleData } = await supabase
    .from("promotion_rules")
    .select("*")
    .eq("from_level_id", levelId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let nextLevel: 等级信息 | null = null;
  let checkResult: 晋级检查结果 | null = null;

  if (ruleData) {
    /* 获取目标等级名称 */
    const { data: targetLevel } = await supabase
      .from("mechanic_levels")
      .select("id, name")
      .eq("id", (ruleData as 晋级规则).to_level_id)
      .single();
    if (targetLevel) nextLevel = targetLevel as 等级信息;

    /* 调用检查函数 */
    const { data: checkData } = await supabase.rpc("check_promotion_eligibility", {
      p_employee_id: userData.user.id,
      p_target_level_id: (ruleData as 晋级规则).to_level_id,
    });
    checkResult = (checkData as 晋级检查结果[] | null)?.[0] || null;
  }

  return (
    <PromotionStatusContent
      initialCurrentLevel={currentLevel}
      initialNextLevel={nextLevel}
      initialRule={(ruleData as 晋级规则) || null}
      initialCheckResult={checkResult}
    />
  );
}
