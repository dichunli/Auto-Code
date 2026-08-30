import { createClient } from "@/lib/supabase/server";
import WaybillsContent from "./WaybillsContent";

/* 手机端批量建运单 — Server Component
 * 首屏物流公司列表在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白 */

interface 物流公司 {
  id: string;
  name: string;
  scopes?: string[] | null;
}

export default async function MobileWaybillBatchPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("logistics_companies")
    .select("id, name, scopes")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  return <WaybillsContent 公司列表={((data || []) as 物流公司[])} />;
}
