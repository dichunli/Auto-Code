/* ═════════════════════════════════════════════════════════════════
 * 知识库搜索文本生成工具
 *
 * 知识库保存时调用，把标题、内容、内容块等中文分词后生成
 * 空格分隔的搜索文本，写入数据库的 search_text 字段。
 * 数据库再用 to_tsvector 建立全文索引，实现快速搜索。
 * ═════════════════════════════════════════════════════════════════ */

import { 中文分词 } from "./chineseSegmenter";

/* 从内容块中提取纯文本，用于生成搜索文本 */
function 提取内容块文本(内容块: unknown): string {
  if (!Array.isArray(内容块)) return "";
  const 片段: string[] = [];
  for (const block of 内容块) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (Array.isArray(b.content)) {
      for (const item of b.content) {
        if (typeof item === "object" && item !== null) {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string") 片段.push(text);
        }
      }
    }
    if (Array.isArray(b.children)) {
      片段.push(提取内容块文本(b.children));
    }
  }
  return 片段.join(" ");
}

/* 生成知识库搜索文本：对标题、内容、分类、作者等分词后拼接 */
export function 生成知识库搜索文本(params: {
  title: string;
  content: string;
  content_blocks?: unknown;
  categoryName?: string;
  authorName?: string;
}): string {
  const { title, content, content_blocks, categoryName, authorName } = params;
  const 原始文本 = [
    title,
    content,
    提取内容块文本(content_blocks),
    categoryName,
    authorName,
  ].join(" ");
  return 中文分词(原始文本).join(" ");
}
