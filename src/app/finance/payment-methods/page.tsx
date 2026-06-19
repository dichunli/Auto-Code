import { PageHeader } from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import PaymentMethodsContent from "./PaymentMethodsContent";

interface 收款方式 {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export default async function PaymentMethodsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_methods")
    .select("id, code, name, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const 初始数据 = (data || []) as 收款方式[];

  return (
    <div>
      <PageHeader title="收款方式" description="预收款、结算时可选的收款方式" />
      <PaymentMethodsContent 初始数据={初始数据} />
    </div>
  );
}
