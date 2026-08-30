import { describe, it, expect, beforeEach } from "vitest";
import { 读本地工单标签, 工单标签存储键 } from "./orderTabs";

/* 工单标签本地存储：读坏数据不能崩（解析失败/非数组/混入非字符串都返回干净数组） */

describe("读本地工单标签", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("正常读数组", () => {
    localStorage.setItem(工单标签存储键, JSON.stringify(["wo-1", "wo-2"]));
    expect(读本地工单标签()).toEqual(["wo-1", "wo-2"]);
  });

  it("没存过 → 空数组", () => {
    expect(读本地工单标签()).toEqual([]);
  });

  it("存的是坏 JSON → 空数组不崩", () => {
    localStorage.setItem(工单标签存储键, "{坏了");
    expect(读本地工单标签()).toEqual([]);
  });

  it("存的不是数组 → 空数组", () => {
    localStorage.setItem(工单标签存储键, JSON.stringify({ a: 1 }));
    expect(读本地工单标签()).toEqual([]);
  });

  it("混入非字符串/空串被过滤", () => {
    localStorage.setItem(工单标签存储键, JSON.stringify(["wo-1", 123, "", null, "wo-2"]));
    expect(读本地工单标签()).toEqual(["wo-1", "wo-2"]);
  });
});
