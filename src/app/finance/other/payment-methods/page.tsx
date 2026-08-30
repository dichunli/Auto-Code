import { createClient } from "@/lib/supabase/server";
import PaymentMethodsContent, { type 操作员, type 收款方式 } from "./PaymentMethodsContent";

/* 其它收支收款方式 — Server Component
 * 首屏操作员列表 + 收款方式列表在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白 */

export default async function OtherPaymentMethodsPage() {
  const supabase = await createClient();
  const [{ data: ops }, { data: pms }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("other_payment_methods")
      .select("id, name, operator_id, sort_order, is_active, profiles(full_name)")
      .order("sort_order", { ascending: true }),
  ]);

  const initialMethods: 收款方式[] = (pms || []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    name: m.name as string,
    operator_id: m.operator_id as string | null,
    operator_name: (m.profiles as { full_name?: string } | null)?.full_name || "",
    sort_order: (m.sort_order as number) || 0,
    is_active: (m.is_active as boolean) ?? true,
  }));

  return (
    <PaymentMethodsContent
      initialOperators={(ops || []) as 操作员[]}
      initialMethods={initialMethods}
    />
  );
}
