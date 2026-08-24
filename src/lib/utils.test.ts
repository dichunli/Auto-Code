import { describe, it, expect } from "vitest";
import { cn, formatDate, formatCurrency, getStatusLabel, getStatusColor } from "./utils";

describe("cn", () => {
  it("拼接多个类名", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("过滤掉假值", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("无参数返回空字符串", () => {
    expect(cn()).toBe("");
  });
});

describe("formatDate", () => {
  it("空值返回占位符", () => {
    expect(formatDate(null)).toBe("-");
  });

  it("格式化日期时间", () => {
    const result = formatDate("2026-01-15T10:30:00");
    /* 输出形如 2026/01/15 10:30，用正则校验格式，避免环境本地化差异 */
    expect(result).toMatch(/\d{4}\/\d{2}\/\d{2}/);
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

describe("formatCurrency", () => {
  it("空值返回占位符", () => {
    expect(formatCurrency(null)).toBe("-");
  });

  it("带货币符号和两位小数", () => {
    const result = formatCurrency(1234.5);
    expect(result).toContain("¥");
    /* zh-CN 环境下千位分隔符为英文逗号 */
    expect(result).toMatch(/1,234\.50/);
  });

  it("整数补足两位小数", () => {
    const result = formatCurrency(100);
    expect(result).toMatch(/100\.00/);
  });
});

describe("getStatusLabel", () => {
  it("已知状态返回中文文案", () => {
    expect(getStatusLabel("received")).toBe("已接车");
    expect(getStatusLabel("repairing")).toBe("维修中");
    expect(getStatusLabel("delivered")).toBe("已交车");
  });

  it("未知状态原样返回", () => {
    expect(getStatusLabel("unknown_status")).toBe("unknown_status");
  });
});

describe("getStatusColor", () => {
  it("已知状态返回颜色类", () => {
    expect(getStatusColor("repairing")).toBe("bg-blue-100 text-blue-800");
    expect(getStatusColor("settled")).toBe("bg-green-100 text-green-800");
  });

  it("未知状态返回默认灰色", () => {
    expect(getStatusColor("unknown_status")).toBe("bg-gray-100 text-gray-800");
  });
});
