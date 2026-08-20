"use client";

import { ArrivalCreateForm } from "@/components/arrival/ArrivalCreateForm";

/* 2026-08-20 待收货改造二期：电脑端新建到货确认单 */

export default function ArrivalNewPage() {
  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-lg font-semibold text-gray-900 mb-4">新建到货确认单</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ArrivalCreateForm 工作台前缀="/procurement/arrivals/" />
      </div>
    </div>
  );
}
