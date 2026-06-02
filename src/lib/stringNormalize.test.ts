import { describe, it, expect } from "vitest";
import { 标准化字符串, 标准化大写, 标准化必填字符串 } from "./stringNormalize";

describe("标准化字符串", () => {
  it("trim并保留非空值", () => {
    expect(标准化字符串("  hello  ")).toBe("hello");
  });

  it("空字符串转NULL", () => {
    expect(标准化字符串("")).toBeNull();
    expect(标准化字符串("   ")).toBeNull();
  });

  it("null和undefined转NULL", () => {
    expect(标准化字符串(null)).toBeNull();
    expect(标准化字符串(undefined)).toBeNull();
  });

  it("数字转字符串", () => {
    expect(标准化字符串(123)).toBe("123");
  });
});

describe("标准化大写", () => {
  it("trim并转大写", () => {
    expect(标准化大写("  abc  ")).toBe("ABC");
  });

  it("空值返回NULL", () => {
    expect(标准化大写("")).toBeNull();
    expect(标准化大写(null)).toBeNull();
  });
});

describe("标准化必填字符串", () => {
  it("返回trim后的值", () => {
    expect(标准化必填字符串("  hello  ", "名称")).toBe("hello");
  });

  it("空值抛出错误", () => {
    expect(() => 标准化必填字符串("", "名称")).toThrow("名称不能为空");
    expect(() => 标准化必填字符串("   ", "名称")).toThrow("名称不能为空");
  });
});
