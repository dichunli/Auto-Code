import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import ScrapForm from "./ScrapForm";

export interface 报废记录行 {
  id: string;
  quantity: number;
  reason: string | null;
  notes: string | null;
  created_at: string;
  parts: { name: string | null; part_number: string | null } | null;
  warehouses: { name: string } | null;
  profiles: { full_name: string | null } | null;
}

/* 报废出库页（2026-09-19 用户拍板：全部出入库都记仓位，方便随时盘点） */
export default async function ScrapPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("part_scrap_records")
    .select("id, quantity, reason, notes, created_at, parts(name, part_number), warehouses(name), profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <PageHeader title="报废出库" description="配件报废：选配件+批次+仓位+数量，同步扣批次/总库存/仓位数量" />
      <ScrapForm 最近记录={(data || []) as unknown as 报废记录行[]} />
    </div>
  );
}
