import { describe, it, expect } from "vitest";
import { 是内网地址 } from "./isInternalHost";

describe("是内网地址", () => {
  it("本机地址", () => {
    expect(是内网地址("localhost")).toBe(true);
    expect(是内网地址("127.0.0.1")).toBe(true);
    expect(是内网地址("::1")).toBe(true);
  });

  it("常见内网网段", () => {
    expect(是内网地址("192.168.1.100")).toBe(true);
    expect(是内网地址("10.0.0.5")).toBe(true);
    expect(是内网地址("172.16.0.1")).toBe(true);
    expect(是内网地址("172.31.255.254")).toBe(true);
  });

  it("公网地址与域名不算内网", () => {
    expect(是内网地址("www.atsg.cn")).toBe(false);
    expect(是内网地址("8.8.8.8")).toBe(false);
    expect(是内网地址("172.15.0.1")).toBe(false); // 172.15 不属于内网段
    expect(是内网地址("172.32.0.1")).toBe(false); // 172.32 超出内网段
  });

  it("空值安全", () => {
    expect(是内网地址("")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(是内网地址("LOCALHOST")).toBe(true);
    expect(是内网地址("WWW.ATSG.CN")).toBe(false);
  });
});
