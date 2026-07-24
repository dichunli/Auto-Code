"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { 保养单草稿前缀 } from "@/lib/maintenance";
import { CreateMaintenanceWrapper } from "./CreateMaintenanceWrapper";
import { MaintenanceImportWrapper } from "./MaintenanceImportWrapper";

interface Props {
  vehicleId: string;
  customerId: string;
  orderId: string;
  orderNo: string;
  plateNumber: string;
  modelInfo: string;
  customerName: string;
}

export function MaintenanceActionWrapper({
  vehicleId,
  customerId,
  orderId,
  orderNo,
  plateNumber,
  modelInfo,
  customerName,
}: Props) {
  const supabase = createClient();
  const [有保养单, 设置有保养单] = useState<boolean | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    // 只统计正式保养单，排除 DRAFT- 前缀的未保存草稿
    supabase
      .from("work_orders")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId)
      .eq("order_type", "maintenance")
      .not("order_no", "like", 保养单草稿前缀 + "%")
      .then(({ count }) => {
        设置有保养单((count || 0) > 0);
      });
  }, [vehicleId, supabase]);

  if (有保养单 === null) {
    return <span className="text-sm text-gray-400">加载中...</span>;
  }

  if (有保养单) {
    return <MaintenanceImportWrapper vehicleId={vehicleId} orderId={orderId} />;
  }

  return (
    <CreateMaintenanceWrapper
      vehicleId={vehicleId}
      customerId={customerId}
      orderId={orderId}
      orderNo={orderNo}
      plateNumber={plateNumber}
      modelInfo={modelInfo}
      customerName={customerName}
    />
  );
}
