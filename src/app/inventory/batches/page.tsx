import { createClient } from "@/lib/supabase/server";
import BatchesContent, { type BatchRecord } from "./BatchesContent";

/* 批次管理 — Server Component
 * 首屏批次列表在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白；
 * 页面上只有前端搜索过滤，无其它数据交互 */

export default async function BatchesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("part_batches")
    .select("id, batch_no, quantity, unit_cost, inbound_type, reference_id, notes, created_at, parts(name, part_number)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("加载批次记录失败:", error);
  }

  return <BatchesContent initialBatches={(data || []) as unknown as BatchRecord[]} />;
}
