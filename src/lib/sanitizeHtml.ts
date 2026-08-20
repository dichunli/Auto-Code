/* ============================================================
 * HTML 消毒（防 XSS）——白名单过滤，Node/浏览器都能跑（纯正则不依赖 DOM）
 *
 * 用途：知识库文章等用户可编辑内容用 innerHTML 渲染前必须过一遍。
 * 策略：
 *   1. 整块删除危险标签（script/iframe/object/embed/form 等，含内容）
 *   2. 非白名单标签"剥壳"——删标签留文本（排版内容不丢）
 *   3. 事件属性（on*）全删；href/src 禁 javascript:/vbscript:/data:text/html
 *   4. style 属性允许但禁 url()/expression（排版需要，风险点掐掉）
 * ============================================================ */

/* 白名单标签：常见排版标签 + 表格 + 媒体 */
const 白名单标签 = new Set([
  "p", "br", "hr", "b", "strong", "i", "em", "u", "s", "del", "mark", "sub", "sup",
  "span", "div", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "caption",
  "img", "a", "figure", "figcaption", "video", "source", "audio",
]);

/* 整块删除的标签（连同内容一起删；表单控件的内容如按钮文字/选项也一并删） */
const 整块删除标签列表 = "script|iframe|object|embed|form|link|meta|base|style|noscript|template|svg|math|button|textarea|select";

/* 各标签允许保留的属性（之外的属性全删；事件属性一律删） */
const 属性白名单: Record<string, string[]> = {
  a: ["href", "title", "target", "rel", "class"],
  img: ["src", "alt", "title", "width", "height", "class", "loading"],
  video: ["src", "controls", "class", "width", "height", "poster"],
  source: ["src", "type"],
  audio: ["src", "controls", "class"],
  td: ["colspan", "rowspan", "class", "style"],
  th: ["colspan", "rowspan", "class", "style"],
  col: ["span"],
};
/* 所有白名单标签都允许 class 和受限 style */
const 通用属性 = ["class", "style"];

/* URL 是否安全（禁 javascript:/vbscript:/data:text/html） */
function 安全URL(url: string): boolean {
  const v = url.replace(/\s/g, "").toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return false;
  if (v.startsWith("data:text/html")) return false;
  return true;
}

/* style 属性值是否安全（允许排版样式，掐掉 url()/expression/带协议的） */
function 安全Style(value: string): boolean {
  const v = value.toLowerCase();
  if (v.includes("url(")) return false;
  if (v.includes("expression(")) return false;
  if (v.includes("javascript:") || v.includes("vbscript:")) return false;
  return true;
}

/* 清理一个开标签内的属性：只留白名单，事件属性全删，URL/样式做安全校验 */
function 清理开标签(标签串: string, 标签名: string): string {
  const 允许 = [...(属性白名单[标签名] || []), ...通用属性];
  const 属性: string[] = [];
  const attr正则 = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = attr正则.exec(标签串)) !== null) {
    const 名 = m[1].toLowerCase();
    if (名.startsWith("on")) continue; /* onerror/onload/onclick 等事件属性全删 */
    if (!允许.includes(名)) continue;
    const 值 = m[2] ?? m[3] ?? m[4] ?? "";
    if ((名 === "href" || 名 === "src") && !安全URL(值)) continue;
    if (名 === "style" && !安全Style(值)) continue;
    /* target="_blank" 强制补 rel，防 reverse tabnabbing */
    if (名 === "target" && 值 === "_blank" && !属性.some((a) => a.startsWith("rel="))) {
      属性.push('rel="noopener noreferrer"');
    }
    属性.push(`${名}="${值.replace(/"/g, "&quot;")}"`);
  }
  const 自闭合 = /\/\s*>$/.test(标签串) || ["br", "hr", "img", "source", "col"].includes(标签名);
  return `<${标签名}${属性.length ? " " + 属性.join(" ") : ""}${自闭合 ? ">" : ">"}`;
}

/**
 * 消毒 HTML 字符串：白名单过滤，返回值可安全用于 dangerouslySetInnerHTML
 */
export function 消毒Html(html: string): string {
  if (!html) return "";

  let 结果 = html;

  /* 1. 整块删除危险标签及其内容（成对标签） */
  const 成对正则 = new RegExp(`<(?:${整块删除标签列表})\\b[^>]*>[\\s\\S]*?<\\/(?:${整块删除标签列表})\\s*>`, "gi");
  结果 = 结果.replace(成对正则, "");

  /* 2. 删除危险标签的自闭合/单标签形态 + 普通 form 控件 */
  结果 = 结果.replace(/<(?:script|iframe|object|embed|link|meta|base|input|button|textarea|select)\b[^>]*\/?>/gi, "");

  /* 3. 逐标签处理：白名单清理属性，非白名单剥壳留文本 */
  结果 = 结果.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*)?)\/?>/g, (整串, 斜杠, 标签名) => {
    const 名 = (标签名 as string).toLowerCase();
    if (!白名单标签.has(名)) return ""; /* 非白名单剥壳：标签删除，文本内容保留 */
    if (斜杠 === "/") return `</${名}>`; /* 闭标签只留名字 */
    return 清理开标签(整串, 名);
  });

  return 结果;
}
