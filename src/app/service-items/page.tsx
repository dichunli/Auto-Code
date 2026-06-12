import { createClient } from "@/lib/supabase/server";
import ServiceItemsContent from "./ServiceItemsContent";

/* ═════════════════════════════════════════════════════════════════
 * 维修项目 — Server Component
 *
 * 数据查询在服务端完成，彻底消除客户端 session 问题。
 * ═════════════════════════════════════════════════════════════════ */

export default async function ServiceItemsPage() {
  const supabase = await createClient();

  const [{ data: items }, { data: categories }] = await Promise.all([
    supabase
      .from("service_items")
      .select("*, service_categories(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("service_categories")
      .select("id, name")
      .order("name"),
  ]);

  return <ServiceItemsContent
    items={(items as unknown[]) || []}
    categories={(categories as unknown[]) || []}
  />;
}
