"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Pagination } from "@/components/Pagination";

/* 明细区翻页（服务端组件页面的 URL 驱动适配器）：
 * 翻页只改 ?page= 参数，筛选条件（mechanic/search）原样保留在 URL 里 */
export function StatsPagination({
  page,
  totalCount,
  pageSize,
}: {
  page: number;
  totalCount: number;
  pageSize: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const 翻页 = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    router.push(`?${params.toString()}`);
  };

  return <Pagination page={page} totalCount={totalCount} pageSize={pageSize} onChange={翻页} />;
}
