import { Suspense } from "react";
import NewTemplateContent from "./NewTemplateContent";

export default function NewTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">加载中...</div>}>
      <NewTemplateContent params={params} />
    </Suspense>
  );
}
