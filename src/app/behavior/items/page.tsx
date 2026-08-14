import { createClient } from "@/lib/supabase/server";
import BehaviorItemsContent from "./BehaviorItemsContent";

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 增删改后的客户端重查逻辑在 BehaviorItemsContent 内保持不变 */
export default async function BehaviorItemsPage() {
  const supabase = await createClient();

  /* 项目、分类、员工、细节条数 并行查询 */
  const [项目结果, 分类结果, 员工结果, 细节结果] = await Promise.all([
    supabase
      .from("behavior_score_items")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("behavior_categories")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("behavior_item_details").select("id, item_id"),
  ]);

  /* 统计每个项目的细节条数，用于列表"细节"按钮上的徽标 */
  const 细节条数: Record<string, number> = {};
  for (const d of 细节结果.data || []) {
    细节条数[d.item_id] = (细节条数[d.item_id] || 0) + 1;
  }

  return (
    <BehaviorItemsContent
      initialItems={项目结果.data || []}
      initialCategories={分类结果.data || []}
      initialEmployees={员工结果.data || []}
      initialDetailCounts={细节条数}
    />
  );
}
