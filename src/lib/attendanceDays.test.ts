import { describe, it, expect } from "vitest";
import { 自动出勤天数, 有效出勤天数, 是异常行, 是有效打卡 } from "./attendanceDays";

describe("自动出勤天数", () => {
  it("无排班 → null（不计）", () => {
    expect(自动出勤天数({ has_schedule: false, day_result: "rest" })).toBeNull();
  });

  it("正常/迟到/早退 → 1 天", () => {
    expect(自动出勤天数({ has_schedule: true, day_result: "normal" })).toBe(1);
    expect(自动出勤天数({ has_schedule: true, day_result: "late" })).toBe(1);
    expect(自动出勤天数({ has_schedule: true, day_result: "early" })).toBe(1);
  });

  it("缺卡 → 0.5 天", () => {
    expect(自动出勤天数({ has_schedule: true, day_result: "miss_card" })).toBe(0.5);
  });

  it("缺勤 → 0 天", () => {
    expect(自动出勤天数({ has_schedule: true, day_result: "absent" })).toBe(0);
  });

  it("未知结果 → null", () => {
    expect(自动出勤天数({ has_schedule: true, day_result: "unknown" })).toBeNull();
  });
});

describe("有效出勤天数（手动优先）", () => {
  it("有手动值 → 用手动值（覆盖自动规则）", () => {
    expect(有效出勤天数({ has_schedule: true, day_result: "late", manual_days: 0.5 })).toBe(0.5);
    expect(有效出勤天数({ has_schedule: true, day_result: "miss_card", manual_days: 1 })).toBe(1);
    expect(有效出勤天数({ has_schedule: true, day_result: "absent", manual_days: 0.5 })).toBe(0.5);
  });

  it("手动值为 0 也是有效手动值", () => {
    expect(有效出勤天数({ has_schedule: true, day_result: "late", manual_days: 0 })).toBe(0);
  });

  it("无手动值 → 按自动规则", () => {
    expect(有效出勤天数({ has_schedule: true, day_result: "normal" })).toBe(1);
    expect(有效出勤天数({ has_schedule: true, day_result: "miss_card", manual_days: null })).toBe(0.5);
  });

  it("休息日即使有手动值也按手动值（管理端不会给休息日设置，兜底不炸）", () => {
    expect(有效出勤天数({ has_schedule: false, day_result: "rest", manual_days: 1 })).toBe(1);
    expect(有效出勤天数({ has_schedule: false, day_result: "rest" })).toBeNull();
  });
});

describe("是异常行（只有异常行允许手动调整）", () => {
  it("迟到/早退/缺卡/缺勤 → 异常", () => {
    for (const day_result of ["late", "early", "miss_card", "absent"]) {
      expect(是异常行({ has_schedule: true, day_result })).toBe(true);
    }
  });

  it("正常 → 不异常（不让改）", () => {
    expect(是异常行({ has_schedule: true, day_result: "normal" })).toBe(false);
  });

  it("无排班 → 不异常", () => {
    expect(是异常行({ has_schedule: false, day_result: "rest" })).toBe(false);
  });
});

describe("是有效打卡（未打卡不显示时间）", () => {
  it("正常/迟到 且有时间 → 有效", () => {
    expect(是有效打卡("Normal", "2026-08-02T07:38:00Z")).toBe(true);
    expect(是有效打卡("Late", "2026-08-11T10:37:00Z")).toBe(true);
  });

  it("NotSigned 即使有时间也是无效的（钉钉返回的是计划时间）", () => {
    expect(是有效打卡("NotSigned", "2026-08-01T07:50:00Z")).toBe(false);
  });

  it("无记录/无时间 → 无效", () => {
    expect(是有效打卡(null, null)).toBe(false);
    expect(是有效打卡("Normal", null)).toBe(false);
    expect(是有效打卡(null, "2026-08-01T07:50:00Z")).toBe(false);
  });
});
