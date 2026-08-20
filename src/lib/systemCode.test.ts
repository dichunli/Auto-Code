import { describe, it, expect } from "vitest";
import { 生成配件系统码, 生成完整系统码, 提取系统码序号 } from "./systemCode";

describe("系统码生成", () => {
  it("生成配件系统码包含PJ前缀和日期", () => {
    const code = 生成配件系统码(new Date("2026-06-01"));
    expect(code).toBe("PJ20260601");
  });

  it("生成完整系统码补零", () => {
    expect(生成完整系统码("PJ20260601", 1)).toBe("PJ20260601001");
    expect(生成完整系统码("PJ20260601", 99)).toBe("PJ20260601099");
    expect(生成完整系统码("PJ20260601", 999)).toBe("PJ20260601999");
  });

  it("提取系统码序号", () => {
    expect(提取系统码序号("PJ20260601001")).toBe(1);
    expect(提取系统码序号("PJ20260601099")).toBe(99);
    expect(提取系统码序号("PJ20260601")).toBe(0);
  });
});
