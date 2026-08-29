import { describe, it, expect } from "vitest";
import { 转义HTML } from "./escapeHtml";

describe("转义HTML", () => {
  it("转义五个关键字符", () => {
    expect(转义HTML(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  it("恶意配件名注入被中和", () => {
    const 恶意名称 = `机油</div><img src=x onerror=alert(1)>`;
    const 结果 = 转义HTML(恶意名称);
    expect(结果).not.toContain("<img");
    expect(结果).not.toContain("</div>");
    expect(结果).toBe("机油&lt;/div&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("单引号和双引号都转义（防属性注入）", () => {
    expect(转义HTML(`a'b"c`)).toBe("a&#39;b&quot;c");
  });

  it("& 最先转义（不会把已转义的实体再转义一次）", () => {
    expect(转义HTML("A&amp;B")).toBe("A&amp;amp;B");
  });

  it("普通中文和常见符号原样保留", () => {
    expect(转义HTML("机油滤芯（4L）- 原厂")).toBe("机油滤芯（4L）- 原厂");
  });

  it("空字符串安全", () => {
    expect(转义HTML("")).toBe("");
  });
});
