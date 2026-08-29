/* HTML 转义工具：把用户输入（配件名/工具名/仓位名/编码等）安全拼进
 * document.write 的打印 HTML 时用。只转义五个关键字符，防 XSS 注入。
 * 配套测试：escapeHtml.test.ts */

export function 转义HTML(文本: string): string {
  return 文本
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
