"use client";

import { MobilePageHeader } from "@/components/mobile/MobilePageHeader";
import { ArrivalCreateForm } from "@/components/arrival/ArrivalCreateForm";

/* 2026-08-20 待收货改造二期：手机端新建到货确认单 */

export default function MobileArrivalNewPage() {
  return (
    <div className="flex flex-col min-h-full">
      <MobilePageHeader title="新建到货单" />
      <div className="flex-1 p-3">
        <ArrivalCreateForm 工作台前缀="/m/receiving/arrivals/" />
      </div>
    </div>
  );
}
