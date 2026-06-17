import { PageHeader } from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import WarehousesContent from "./WarehousesContent";

interface 仓库 {
  id: string;
  name: string;
  address?: string | null;
  created_at: string;
}

export default async function WarehousesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("warehouses")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const list = (data || []) as 仓库[];
  list.sort((a, b) => {
    const aMain = a.name === "主仓库" || a.name.includes("主") ? -1 : 0;
    const bMain = b.name === "主仓库" || b.name.includes("主") ? -1 : 0;
    if (aMain !== bMain) return aMain - bMain;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div>
      <PageHeader
        title="仓库管理"
        description={`共 ${list.length} 个仓库`}
        action={{ href: "/inventory/warehouses/new", label: "新增仓库" }}
      />
      <WarehousesContent 初始数据={list} />
    </div>
  );
}
