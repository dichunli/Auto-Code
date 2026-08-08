/* 复制文本到剪贴板（只能在浏览器端调用）
 * 优先 navigator.clipboard（https / localhost 安全上下文才可用），
 * 失败时回退老式 execCommand——http 页面（如内网/IP 访问）也能复制成功。
 * 两种方式都失败返回 false，由调用方提示用户手动复制。 */
export async function copyText(文本: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(文本);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = 文本;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
