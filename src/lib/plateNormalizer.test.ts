import { describe, it, expect } from "vitest";
import { 标准化车牌, 车牌是否为空 } from "./plateNormalizer";

describe("标准化车牌", () => {
  it("trim并转大写", () => {
    expect(标准化车牌("  粤A12345  ")).toBe("粤A12345");
    expect(标准化车牌("粤b67890")).toBe("粤B67890");
  });
});

describe("车牌是否为空", () => {
  it("空字符串返回true", () => {
    expect(车牌是否为空("")).toBe(true);
    expect(车牌是否为空("   ")).toBe(true);
  });

  it("非空字符串返回false", () => {
    expect(车牌是否为空("粤A12345")).toBe(false);
  });
});
