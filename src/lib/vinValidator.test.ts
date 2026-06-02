import { describe, it, expect } from "vitest";
import { 校验VIN, 是合法VIN, 标准化VIN } from "./vinValidator";

describe("校验VIN", () => {
  it("合法VIN通过校验", () => {
    const result = 校验VIN("LSVAG2180E2100001");
    expect(result.合法).toBe(true);
    expect(result.标准化值).toBe("LSVAG2180E2100001");
    expect(result.错误).toBeUndefined();
  });

  it("自动trim并转大写", () => {
    const result = 校验VIN("  lsvag2180e2100001  ");
    expect(result.合法).toBe(true);
    expect(result.标准化值).toBe("LSVAG2180E2100001");
  });

  it("长度不对报错", () => {
    const result = 校验VIN("LSVAG2180E21000");
    expect(result.合法).toBe(false);
    expect(result.错误).toBe("VIN码必须为17位");
  });

  it("包含非法字符报错", () => {
    /* I, O, Q 是VIN禁用字符 */
    const result = 校验VIN("LSVAG2180E210000I");
    expect(result.合法).toBe(false);
    expect(result.错误).toBe("VIN码包含非法字符");
  });
});

describe("是合法VIN", () => {
  it("合法返回true", () => {
    expect(是合法VIN("LSVAG2180E2100001")).toBe(true);
  });

  it("非法返回false", () => {
    expect(是合法VIN("123")).toBe(false);
  });
});

describe("标准化VIN", () => {
  it("trim并转大写", () => {
    expect(标准化VIN("  abc  ")).toBe("ABC");
  });
});
