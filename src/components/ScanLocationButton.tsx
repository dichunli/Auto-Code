"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BarcodeScanModal from "@/components/BarcodeScanModal";
import { toast } from "@/lib/globalToast";

/* 扫仓位码选仓位（2026-09-19 用户拍板：出库时多仓位可扫码确认）
 * 仓位标签二维码内容 = warehouse_locations.id（仓库管理页"打印标签"印的码），
 * 扫到后反查仓位字典拿 仓库+仓位名，回调给各出库表单做选项匹配。 */
export interface 扫到仓位 {
  warehouse_id: string;
  location: string;
  warehouse_name: string;
}

export function ScanLocationButton({
  on命中,
  按钮文案 = "扫仓位码",
  className = "",
}: {
  on命中: (仓位: 扫到仓位) => void;
  按钮文案?: string;
  className?: string;
}) {
  const supabase = createClient();
  const [扫码开, 设扫码开] = useState(false);

  async function 处理扫码(code: string) {
    /* 仓位码内容 = warehouse_locations.id */
    const { data, error } = await supabase
      .from("warehouse_locations")
      .select("id, name, warehouse_id, warehouses(name)")
      .eq("id", code.trim())
      .maybeSingle();
    if (error || !data) {
      toast("扫到的不是仓位标签（请到 配件库存→仓库管理→仓位 打印标签）", "warning");
      return;
    }
    const 行 = data as unknown as { id: string; name: string; warehouse_id: string; warehouses: { name: string } | { name: string }[] | null };
    设扫码开(false);
    on命中({
      warehouse_id: 行.warehouse_id,
      location: 行.name,
      warehouse_name: Array.isArray(行.warehouses) ? 行.warehouses[0]?.name || "" : 行.warehouses?.name || "",
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => 设扫码开(true)}
        className={`text-xs px-2 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50 whitespace-nowrap ${className}`}
      >
        {按钮文案}
      </button>
      <BarcodeScanModal
        open={扫码开}
        onClose={() => 设扫码开(false)}
        onScan={处理扫码}
        标题="扫仓位码"
      />
    </>
  );
}
