import { describe, it, expect } from "vitest";
import { 解析价格, 解析数量, 金额加, 金额减, 金额乘, 格式化金额 } from "./priceParser";

describe("解析价格", () => {
  it("解析正常价格", () => {
    expect(解析价格("100.50")).toBe(100.50);
    expect(解析价格("0")).toBe(0);
  });

  it("空值返回NULL", () => {
    expect(解析价格("")).toBeNull();
    expect(解析价格(null)).toBeNull();
    expect(解析数量(undefined)).toBeNull();
  });

  it("非法字符串返回NULL", () => {
    expect(解析价格("abc")).toBeNull();
  });

  it("trim后解析", () => {
    expect(解析价格("  99.99  ")).toBe(99.99);
  });

  it("保留2位小数", () => {
    expect(解析价格("10.999")).toBe(11.00);
  });
});

describe("解析数量", () => {
  it("解析整数和浮点数", () => {
    expect(解析数量("5")).toBe(5);
    expect(解析数量("2.5")).toBe(2.5);
  });
});

describe("金额运算", () => {
  it("加法避免浮点精度", () => {
    /* 0.1 + 0.2 正常会变成 0.30000000000000004 */
    expect(金额加(0.1, 0.2)).toBe(0.3);
  });

  it("减法避免浮点精度", () => {
    expect(金额减(1.0, 0.9)).toBe(0.1);
  });

  it("乘法避免浮点精度", () => {
    expect(金额乘(0.01, 3)).toBe(0.03);
  });
});

describe("格式化金额", () => {
  it("保留2位小数", () => {
    expect(格式化金额(100)).toBe("100.00");
    expect(格式化金额(99.9)).toBe("99.90");
  });
});
