import { describe, it, expect } from "vitest";
import { 本地今日字符串, 时间转分钟, 过滤今日任务, 计算时段状态, 可过滤任务 } from "./behaviorCheck";

describe("本地今日字符串", () => {
  it("返回本地日期 YYYY-MM-DD 格式", () => {
    const d = new Date(2026, 7, 14, 2, 30); // 2026-08-14 02:30 本地
    expect(本地今日字符串(d)).toBe("2026-08-14");
  });

  it("凌晨时间仍归属本地当天（UTC 会是前一天）", () => {
    const d = new Date(2026, 0, 1, 3, 0); // 1月1日凌晨3点
    expect(本地今日字符串(d)).toBe("2026-01-01");
  });

  it("单位数月日补零", () => {
    const d = new Date(2026, 1, 5, 12, 0); // 2026-02-05
    expect(本地今日字符串(d)).toBe("2026-02-05");
  });
});

describe("时间转分钟", () => {
  it("HH:mm 转分钟数", () => {
    expect(时间转分钟("08:30")).toBe(510);
    expect(时间转分钟("00:00")).toBe(0);
    expect(时间转分钟("23:59")).toBe(1439);
  });

  it("兼容 HH:mm:ss 格式", () => {
    expect(时间转分钟("09:00:00")).toBe(540);
  });
});

describe("过滤今日任务", () => {
  const 任务: ({ id: string } & 可过滤任务)[] = [
    { id: "每日", frequency: "daily", execute_weekday: null, execute_day: null },
    { id: "周五", frequency: "weekly", execute_weekday: 5, execute_day: null },
    { id: "周一", frequency: "weekly", execute_weekday: 1, execute_day: null },
    { id: "15号", frequency: "monthly", execute_weekday: null, execute_day: 15 },
  ];

  it("周五（2026-08-14）匹配 daily + 周五任务", () => {
    const now = new Date(2026, 7, 14, 12, 0); // 2026-08-14 是周五
    const 结果 = 过滤今日任务(任务, now).map((t) => t.id);
    expect(结果).toEqual(["每日", "周五"]);
  });

  it("每月15号匹配 monthly 任务", () => {
    const now = new Date(2026, 7, 15, 12, 0); // 周六 15 号
    const 结果 = 过滤今日任务(任务, now).map((t) => t.id);
    expect(结果).toEqual(["每日", "15号"]);
  });
});

describe("计算时段状态", () => {
  const start = "08:30";
  const end = "09:00";

  it("已完成的记录恒为 completed", () => {
    expect(计算时段状态(start, end, "completed", new Date(2026, 7, 14, 23, 0))).toBe("completed");
  });

  it("开始前为 not_started", () => {
    expect(计算时段状态(start, end, "pending", new Date(2026, 7, 14, 8, 0))).toBe("not_started");
  });

  it("时段内为 in_window（含边界）", () => {
    expect(计算时段状态(start, end, "pending", new Date(2026, 7, 14, 8, 30))).toBe("in_window");
    expect(计算时段状态(start, end, "pending", new Date(2026, 7, 14, 9, 0))).toBe("in_window");
  });

  it("超过结束时间为 closed", () => {
    expect(计算时段状态(start, end, "pending", new Date(2026, 7, 14, 9, 1))).toBe("closed");
  });

  it("兼容带秒的时间格式", () => {
    expect(计算时段状态("08:30:00", "09:00:00", "pending", new Date(2026, 7, 14, 8, 45))).toBe("in_window");
  });
});
