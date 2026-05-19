import { Suspense } from "react";
import NewRequirementContent from "./NewRequirementContent";

export default function NewRequirementPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">加载中...</div>}>
      <NewRequirementContent params={params} />
    </Suspense>
  );
}
