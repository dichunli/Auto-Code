import { createClient } from "@/lib/supabase/server";
import SuppliersContent from "./SuppliersContent";

/* 首屏只取第一页（20 条）+ 总数，防止供应商增长后全量拉取拖慢页面 */
export default async function SuppliersPage() {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("suppliers")
    .select("*, parts(count)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, 19);
  return <SuppliersContent initialSuppliers={(data || [])} initialCount={count || 0} />;
}
