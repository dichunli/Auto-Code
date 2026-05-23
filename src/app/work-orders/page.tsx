import { Suspense } from "react";
import { redirect } from "next/navigation";
import WorkOrdersContent from "./WorkOrdersContent";

export default async function WorkOrdersPage(props: {
  searchParams?: Promise<Record<string, string | undefined>> | Record<string, string | undefined>;
}) {
  const searchParams = (await Promise.resolve(props.searchParams || {})) as Record<string, string | undefined>;

  if (!searchParams.status && !searchParams.type && !searchParams.keyword) {
    redirect("/work-orders?status=active");
  }

  return (
    <Suspense fallback={<div className="p-6 text-gray-500">加载中...</div>}>
      <WorkOrdersContent />
    </Suspense>
  );
}
