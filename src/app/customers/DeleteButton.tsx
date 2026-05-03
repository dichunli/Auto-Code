"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  id: string;
}

export function DeleteButton({ id }: Props) {
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("确定要删除该客户吗？删除前会检查关联数据。")) return;
    setDeleting(true);

    // 检查关联车辆
    const { count: vehicleCount } = await supabase
      .from("vehicles")
      .select("*", { count: "exact", head: true })
      .eq("customer_id", id);
    if (vehicleCount && vehicleCount > 0) {
      alert(`无法删除：该客户下还有 ${vehicleCount} 辆车辆，请先处理。`);
      setDeleting(false);
      return;
    }

    // 检查关联工单
    const { count: orderCount } = await supabase
      .from("work_orders")
      .select("*", { count: "exact", head: true })
      .eq("customer_id", id);
    if (orderCount && orderCount > 0) {
      alert(`无法删除：该客户还有 ${orderCount} 条工单记录。`);
      setDeleting(false);
      return;
    }

    // 检查关联会员
    const { count: memberCount } = await supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .eq("customer_id", id);
    if (memberCount && memberCount > 0) {
      alert(`无法删除：该客户已办理会员，请先处理。`);
      setDeleting(false);
      return;
    }

    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
    } else {
      window.location.reload();
    }
    setDeleting(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
    >
      {deleting ? "删除中..." : "删除"}
    </button>
  );
}
