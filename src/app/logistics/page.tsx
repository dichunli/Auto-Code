import { createClient } from "@/lib/supabase/server";
import LogisticsContent from "./LogisticsContent";

/* 运单首屏只取第 1 页（20 条）+ 总数；默认筛选"待签收"，与客户端 filter 默认值 "pending" 保持一致，
   否则分页总数会对不上（物流公司/供应商数据量小，不分页） */
export default async function LogisticsPage() {
  const supabase = await createClient();
  const [{ data: waybills, count }, { data: companies }, { data: suppliers }] = await Promise.all([
    supabase
      .from("logistics_waybills")
      .select("*, logistics_companies(name, scopes)", { count: "exact" })
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .range(0, 19),
    supabase.from("logistics_companies").select("*").order("sort_order", { ascending: true }).order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
  ]);
  return <LogisticsContent initialWaybills={waybills || []} initialWaybillCount={count || 0} initialCompanies={companies || []} initialSuppliers={suppliers || []} />;
}
