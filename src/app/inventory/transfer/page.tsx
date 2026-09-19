import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import TransferForm from "./TransferForm";

export interface 调拨记录行 {
  id: string;
  from_location: string | null;
  to_location: string | null;
  quantity: number;
  notes: string | null;
  created_at: string;
  parts: { name: string | null; part_number: string | null } | null;
  from_warehouse: { name: string } | null;
  to_warehouse: { name: string } | null;
  profiles: { full_name: string | null } | null;
}

/* 仓位调拨页（2026-09-19 用户拍板：全部出入库都记仓位，方便随时盘点） */
export default async function TransferPage() {
  const supabase = await createClient();
  const [{ data: 记录 }, { data: 仓库们 }] = await Promise.all([
    supabase
      .from("stock_location_transfers")
      .select(
        "id, from_location, to_location, quantity, notes, created_at, parts(name, part_number), from_warehouse:warehouses!stock_location_transfers_from_warehouse_id_fkey(name), to_warehouse:warehouses!stock_location_transfers_to_warehouse_id_fkey(name), profiles(full_name)"
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("warehouses").select("id, name").order("name"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="仓位调拨" description="配件在仓位之间搬移：源仓位扣减、目标仓位加回，总库存不变" />
      <TransferForm
        最近记录={(记录 || []) as unknown as 调拨记录行[]}
        仓库列表={(仓库们 || []) as { id: string; name: string }[]}
      />
    </div>
  );
}
