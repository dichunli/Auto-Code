"use client";

import { useRouter } from "next/navigation";
import { MobilePageHeader } from "@/components/mobile/MobilePageHeader";
import { WaybillBatchForm } from "@/components/WaybillBatchForm";

/* 2026-08-20 手机端批量建运单：分步流程（选公司→数量→逐卡片填写），
   表单实现抽在 WaybillBatchForm（电脑端弹窗共用）。
   首屏物流公司列表由服务端 page.tsx 查询后通过 props 传入 */

interface 物流公司 {
  id: string;
  name: string;
  scopes?: string[] | null;
}

export default function WaybillsContent({ 公司列表 }: { 公司列表: 物流公司[] }) {
  const router = useRouter();

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
