import { Suspense } from "react";
import PartForm from "./PartForm";

export default async function NewPartPage({ searchParams }: { searchParams: Promise<{ oeNumber?: string; name?: string; vin?: string }> }) {
  const params = await searchParams;
  const prefillData = {
    ...(params.oeNumber ? { oeNumber: params.oeNumber } : {}),
    ...(params.name ? { name: params.name } : {}),
  };

  return (
    <Suspense fallback={<div className="p-6 text-gray-500">加载中...</div>}>
      <PartForm prefillData={Object.keys(prefillData).length > 0 ? prefillData : undefined} />
    </Suspense>
  );
}
