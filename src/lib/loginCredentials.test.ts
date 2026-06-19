import { describe, it, expect } from "vitest";
import { 是手机号, 账号转邮箱 } from "./loginCredentials";

/* ============================================================
   登录账号处理 — 单元测试

   这段逻辑决定「用户输入的账号怎么变成 Supabase 登录邮箱」。
   写错了就会出现「账号密码都对却登不进去」，所以把规则钉死。
   ============================================================ */

describe("是手机号", () => {
  it("标准 11 位手机号（1 开头）→ true", () => {
    expect(是手机号("13800138000")).toBe(true);
    expect(是手机号("15912345678")).toBe(true);
    expect(是手机号("19987654321")).toBe(true);
  });

  it("第二位不在 3-9 之间 → false", () => {
    expect(是手机号("12012345678")).toBe(false); // 第二位 2
    expect(是手机号("11012345678")).toBe(false); // 第二位 1
    expect(是手机号("10012345678")).toBe(false); // 第二位 0
  });

  it("位数不对 → false", () => {
    expect(是手机号("1380013800")).toBe(false); // 10 位
    expect(是手机号("138001380000")).toBe(false); // 12 位
  });

  it("不以 1 开头 → false", () => {
    expect(是手机号("23800138000")).toBe(false);
  });

  it("含非数字字符 → false", () => {
    expect(是手机号("1380013800a")).toBe(false);
    expect(是手机号("138 0013 8000")).toBe(false);
    expect(是手机号("")).toBe(false);
  });

  it("邮箱不是手机号 → false", () => {
    expect(是手机号("admin@example.com")).toBe(false);
  });
});

describe("账号转邮箱", () => {
  it("手机号 → 拼成内部邮箱 phone-<号码>@auto.local", () => {
    expect(账号转邮箱("13800138000")).toBe("phone-13800138000@auto.local");
    expect(账号转邮箱("15912345678")).toBe("phone-15912345678@auto.local");
  });

  it("邮箱 → 原样返回", () => {
    expect(账号转邮箱("admin@example.com")).toBe("admin@example.com");
    expect(账号转邮箱("user@auto.local")).toBe("user@auto.local");
  });

  it("非手机号、非标准邮箱的字符串 → 原样返回（交给 Supabase 判断）", () => {
    expect(账号转邮箱("zhangsan")).toBe("zhangsan");
  });

  it("转换结果与登录页原生脚本规则一致（phone- 前缀 + @auto.local 后缀）", () => {
    /* 这条用例守护「两套登录逻辑规则一致」这个约定：
       login/page.tsx 的原生兼容脚本里也用同样的拼法。 */
    const 手机号 = "13700137000";
    expect(账号转邮箱(手机号)).toBe("phone-" + 手机号 + "@auto.local");
  });
});
