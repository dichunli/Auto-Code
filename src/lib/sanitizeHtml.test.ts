import { describe, it, expect } from "vitest";
import { 消毒Html } from "./sanitizeHtml";

describe("消毒Html - XSS 防护", () => {
  it("script 标签整块删除（含内容）", () => {
    const 结果 = 消毒Html('<p>你好</p><script>alert("偷令牌")</script><p>再见</p>');
    expect(结果).toBe("<p>你好</p><p>再见</p>");
  });

  it("script 的 src 单标签形态也删", () => {
    const 结果 = 消毒Html('前<script src="https://evil.com/x.js"></script>后');
    expect(结果).toBe("前后");
  });

  it("img 的 onerror 事件属性删除，正常属性保留", () => {
    const 结果 = 消毒Html('<img src="a.jpg" onerror="alert(1)" alt="照片" width="100">');
    expect(结果).toContain('src="a.jpg"');
    expect(结果).toContain('alt="照片"');
    expect(结果).toContain('width="100"');
    expect(结果).not.toContain("onerror");
  });

  it("a 标签 javascript: 协议删除", () => {
    const 结果 = 消毒Html('<a href="javascript:alert(1)">点我</a>');
    expect(结果).not.toContain("javascript:");
    expect(结果).toContain("点我");
  });

  it("a 标签混淆空格的 javascript: 也能识别", () => {
    const 结果 = 消毒Html('<a href="java script:alert(1)">点我</a>');
    expect(结果).not.toContain("java");
  });

  it("a 标签正常 http 链接保留", () => {
    const 结果 = 消毒Html('<a href="https://example.com" title="示例">链接</a>');
    expect(结果).toContain('href="https://example.com"');
    expect(结果).toContain("链接");
  });

  it("target=_blank 自动补 rel 防反钓鱼", () => {
    const 结果 = 消毒Html('<a href="https://example.com" target="_blank">外</a>');
    expect(结果).toContain('rel="noopener noreferrer"');
  });

  it("iframe 整块删除", () => {
    const 结果 = 消毒Html('<p>视频</p><iframe src="https://evil.com"></iframe>');
    expect(结果).toBe("<p>视频</p>");
  });

  it("非白名单标签剥壳留文本", () => {
    const 结果 = 消毒Html("<marquee>滚动字</marquee><p>正常</p>");
    expect(结果).toBe("滚动字<p>正常</p>");
  });

  it("form 控件删除", () => {
    const 结果 = 消毒Html('<input type="text" name="pwd"><button>提交</button><p>文本</p>');
    expect(结果).toBe("<p>文本</p>");
  });

  it("style 标签整块删除", () => {
    const 结果 = 消毒Html("<style>body{display:none}</style><p>显示</p>");
    expect(结果).toBe("<p>显示</p>");
  });

  it("style 属性的 url() 掐掉，正常排版样式保留", () => {
    const 带攻击 = 消毒Html('<span style="color:red;background:url(javascript:alert(1))">字</span>');
    expect(带攻击).not.toContain("url(");
    const 正常 = 消毒Html('<span style="color:red">字</span>');
    expect(正常).toContain('style="color:red"');
  });

  it("表格结构完整保留（知识库文章常用）", () => {
    const 原 = '<table><thead><tr><th colspan="2">标题</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    const 结果 = 消毒Html(原);
    expect(结果).toContain("<table>");
    expect(结果).toContain('colspan="2"');
    expect(结果).toContain("<td>a</td>");
  });

  it("svg 整块删除（svg 是 XSS 重灾区）", () => {
    const 结果 = 消毒Html('<svg onload="alert(1)"></svg><p>文本</p>');
    expect(结果).toBe("<p>文本</p>");
  });

  it("空值安全", () => {
    expect(消毒Html("")).toBe("");
  });

  it("正常文章排版不受影响", () => {
    const 原 = '<h2>换机油步骤</h2><p>第一步，<strong>熄火</strong>等待冷却。</p><ul><li>准备工具</li><li>放旧油</li></ul><blockquote>注意：戴手套</blockquote>';
    expect(消毒Html(原)).toBe(原);
  });
});
