import { createClient } from "@/lib/supabase/server";
import BehaviorItemsContent from "./BehaviorItemsContent";

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 增删改后的客户端重查逻辑在 BehaviorItemsContent 内保持不变 */
export default async function BehaviorItemsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("behavior_score_items")
    .select("*")
    .order("created_at", { ascending: false });

  return <BehaviorItemsContent initialItems={data || []} />;
}
