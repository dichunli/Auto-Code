import { 加载分词列表 } from "@/app/knowledge/actions";
import SegmentDictionaryContent from "./SegmentDictionaryContent";

/* 搜索分词词典 — Server Component
 * 首屏分词列表在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白 */

export default async function SegmentDictionaryPage() {
  const result = await 加载分词列表();

  return (
    <SegmentDictionaryContent
      initialWords={result.success && result.data ? result.data : []}
      initialError={result.success ? "" : result.error || "加载失败"}
    />
  );
}
