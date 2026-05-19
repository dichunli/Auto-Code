import { Suspense } from "react";
import WorkOrdersContent from "./WorkOrdersContent";

export default function WorkOrdersPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">加载中...</div>}>
      <WorkOrdersContent />
    </Suspense>
  );
}
