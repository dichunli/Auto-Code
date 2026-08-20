"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MobilePageHeader } from "@/components/mobile/MobilePageHeader";
import { WaybillBatchForm } from "@/components/WaybillBatchForm";

/* 2026-08-20 手机端批量建运单：分步流程（选公司→数量→逐卡片填写），
   表单实现抽在 WaybillBatchForm（电脑端弹窗共用） */

interface 物流公司 {
  id: string;
  name: string;
  scopes?: string[] | null;
}

export default function MobileWaybillBatchPage() {
  const router = useRouter();
  const supabase = createClient();
  const [公司列表, set公司列表] = useState<物流公司[]>([]);

  useEffect(() => {
    supabase
      .from("logistics_companies")
      .select("id, name, scopes")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .then(({ data }) => set公司列表((data || []) as 物流公司[]));
  }, [supabase]);

  return (
    <div className="flex flex-col min-h-full">
      <MobilePageHeader title="批量建运单" />
      <div className="flex-1 p-3">
        <WaybillBatchForm
          公司列表={公司列表}
          提交完成后={() => {
            router.push("/m/receiving");
            router.refresh();
          }}
        />
      </div>
    </div>
  );
}
