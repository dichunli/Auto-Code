import { createClient } from "@/lib/supabase/server";
import MemberDetailContent, { type Member, type MemberTransaction } from "./MemberDetailContent";

/* 会员详情 — Server Component
 * 首屏数据（会员信息 + 交易记录）在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白；
 * 充值/编辑保存后客户端仍自行刷新 */

export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: m }, { data: txs }] = await Promise.all([
    supabase.from("members").select("*, customers(name, phone)").eq("id", id).single(),
    supabase
      .from("member_transactions")
      .select("*, work_orders(order_no)")
      .eq("member_id", id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <MemberDetailContent
      memberId={id}
      initialMember={(m as unknown as Member | null) ?? null}
      initialTransactions={(txs || []) as unknown as MemberTransaction[]}
    />
  );
}
