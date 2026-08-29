import { describe, it, expect } from "vitest";
import { 清理搜索词 } from "./sanitizeQuery";

describe("清理搜索词", () => {
  it("去掉过滤器结构字符（防 .or() 注入）", () => {
    /* 攻击样本：试图用逗号和括号闭合当前条件、注入新条件 */
    expect(清理搜索词('机油"),name.eq.admin,("')).toBe("机油nameeqadmin");
  });

  it("去掉 PostgREST 通配符 % 和 _", () => {
    expect(清理搜索词("%机_油%")).toBe("机油");
  });

  it("去掉双引号和反斜杠", () => {
    expect(清理搜索词('a"b\\c')).toBe("abc");
  });

  it("去掉句点（防多级路径注入）", () => {
    expect(清理搜索词("a.b.c")).toBe("abc");
  });

  it("正常中文搜索词原样保留", () => {
    expect(清理搜索词("机油滤芯")).toBe("机油滤芯");
  });

  it("正常车牌/字母数字保留", () => {
    expect(清理搜索词("黑A86N7S")).toBe("黑A86N7S");
  });

  it("首尾空格被 trim", () => {
    expect(清理搜索词("  机油  ")).toBe("机油");
  });

  it("空字符串安全", () => {
    expect(清理搜索词("")).toBe("");
  });
});
