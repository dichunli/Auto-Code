/* 搜索词清理：用户输入拼进 PostgREST 的 .or() 过滤器前统一过一遍。
 * 去掉 (),.%_"\ 这些会破坏过滤器结构/触发通配符的字符（待办清单第3项）。
 * 配套测试：sanitizeQuery.test.ts */

export function 清理搜索词(输入: string): string {
  return 输入.replace(/[(),.%_"\\]/g, "").trim();
}
