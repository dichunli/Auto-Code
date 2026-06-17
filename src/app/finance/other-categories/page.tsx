import { PageHeader } from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import OtherCategoriesContent from "./OtherCategoriesContent";

interface 分类 {
  id: string;
  name: string;
  type: string;
  sort_order: number;
  is_active: boolean;
}

export default async function OtherCategoriesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("other_transaction_categories")
    .select("id, name, type, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("name");

  const 初始数据 = (data || []) as 分类[];

  return (
    <div>
      <PageHeader
        title="其它收支分类"
        description="管理收入和支出的原因分类"
        action={{ href: "/finance/other-categories/new", label: "新建分类" }}
      />
      <OtherCategoriesContent 初始数据={初始数据} />
    </div>
  );
}
