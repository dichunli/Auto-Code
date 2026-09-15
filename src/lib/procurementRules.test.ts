import { describe, it, expect } from "vitest";
import {
  行可进采购流程,
  行符合待询价,
  行符合待报价,
  行符合待确认,
  行符合采购阶段,
  行符合待采购,
  计算供应商得分,
  供应商匹配原因,
  供应商分值,
  配件分组键,
} from "./procurementRules";
import type { 分支行状态输入 } from "./procurementRules";

/* 造一行默认"可进采购流程"的行，按需覆盖字段 */
function 造行(覆盖: Partial<分支行状态输入> = {}): 分支行状态输入 {
  return {
    work_order_items: { work_orders: { settled_at: null, order_type: "normal" } },
    is_purchased: false,
    is_arrived: false,
    unit_cost: 0,
    unit_price: 0,
    customer_opinion: "pending",
    part_id: null,
    parts: null,
    ...覆盖,
  };
}

describe("行可进采购流程（基础门禁）", () => {
  it("正常未结未购行 → 可进", () => {
    expect(行可进采购流程(造行())).toBe(true);
  });
  it("无工单 → 不可进", () => {
    expect(行可进采购流程(造行({ work_order_items: null }))).toBe(false);
  });
  it("已结算 → 不可进", () => {
    expect(行可进采购流程(造行({ work_order_items: { work_orders: { settled_at: "2026-09-01", order_type: "normal" } } }))).toBe(false);
  });
  it("作废单 → 不可进", () => {
    expect(行可进采购流程(造行({ work_order_items: { work_orders: { settled_at: null, order_type: "cancelled" } } }))).toBe(false);
  });
  it("保养单 → 不可进（用户定的规则）", () => {
    expect(行可进采购流程(造行({ work_order_items: { work_orders: { settled_at: null, order_type: "maintenance" } } }))).toBe(false);
  });
  it("已采购/已到货 → 不可进", () => {
    expect(行可进采购流程(造行({ is_purchased: true }))).toBe(false);
    expect(行可进采购流程(造行({ is_arrived: true }))).toBe(false);
  });
});

describe("阶段谓词（待询价/待报价/待确认）", () => {
  it("待询价：成本价未填", () => {
    expect(行符合待询价(造行())).toBe(true);
    expect(行符合待询价(造行({ unit_cost: 100 }))).toBe(false);
  });
  it("待报价：有成本价无销售价", () => {
    expect(行符合待报价(造行({ unit_cost: 100 }))).toBe(true);
    expect(行符合待报价(造行({ unit_cost: 100, unit_price: 150 }))).toBe(false);
    expect(行符合待报价(造行())).toBe(false);
  });
  it("待确认：价齐且客户未表态", () => {
    expect(行符合待确认(造行({ unit_cost: 100, unit_price: 150 }))).toBe(true);
    expect(行符合待确认(造行({ unit_cost: 100, unit_price: 150, customer_opinion: "agree" }))).toBe(false);
  });
});

describe("行符合采购阶段（分派器）", () => {
  it("按 status 分派到对应谓词", () => {
    expect(行符合采购阶段(造行(), "pending_inquiry")).toBe(true);
    expect(行符合采购阶段(造行({ unit_cost: 10 }), "pending_quote")).toBe(true);
    expect(行符合采购阶段(造行({ unit_cost: 10, unit_price: 20 }), "pending_confirm")).toBe(true);
    expect(行符合采购阶段(造行(), "pending_quote")).toBe(false);
  });
  it("未知阶段 → false", () => {
    expect(行符合采购阶段(造行(), "unknown_status")).toBe(false);
  });
  it("已采购行任何阶段都 false", () => {
    expect(行符合采购阶段(造行({ is_purchased: true }), "pending_inquiry")).toBe(false);
  });
});

describe("行符合待采购（含库存判断）", () => {
  it("价齐 + 无库存关联 → 待采购", () => {
    expect(行符合待采购(造行({ unit_cost: 100, unit_price: 150 }))).toBe(true);
  });
  it("价不齐 → 不待采购", () => {
    expect(行符合待采购(造行({ unit_cost: 0, unit_price: 150 }))).toBe(false);
    expect(行符合待采购(造行({ unit_cost: 100, unit_price: 0 }))).toBe(false);
  });
  it("关联配件库存有货 → 不待采购（直接用库存）", () => {
    expect(行符合待采购(造行({ unit_cost: 100, unit_price: 150, part_id: "p1", parts: { quantity: 3 } }))).toBe(false);
  });
  it("关联配件库存为 0 → 仍待采购", () => {
    expect(行符合待采购(造行({ unit_cost: 100, unit_price: 150, part_id: "p1", parts: { quantity: 0 } }))).toBe(true);
  });
  it("作废/保养/已结算单 → 不待采购", () => {
    expect(行符合待采购(造行({ unit_cost: 100, unit_price: 150, work_order_items: { work_orders: { settled_at: null, order_type: "cancelled" } } }))).toBe(false);
  });
});

describe("计算供应商得分（权重唯一口径）", () => {
  it("全命中 + 3 星 = 1000+500+200+200+30", () => {
    expect(计算供应商得分({ 车型命中: true, 配件命中: true, 分类命中: true, 品牌命中: true, 推荐等级: 3 }))
      .toBe(供应商分值.车型匹配 + 供应商分值.配件匹配 + 供应商分值.分类匹配 + 供应商分值.品牌匹配 + 3 * 供应商分值.推荐等级每星);
  });
  it("零命中零星级 = 0", () => {
    expect(计算供应商得分({})).toBe(0);
  });
  it("只车型命中 = 1000", () => {
    expect(计算供应商得分({ 车型命中: true })).toBe(1000);
  });
  it("推荐等级空值按 0 计", () => {
    expect(计算供应商得分({ 推荐等级: null })).toBe(0);
  });
});

describe("供应商匹配原因（文案唯一口径）", () => {
  it("全命中无选项 → 四条基础文案", () => {
    expect(供应商匹配原因({ 车型命中: true, 配件命中: true, 分类命中: true, 品牌命中: true }))
      .toEqual(["匹配车型", "匹配配件", "匹配分类", "匹配品牌"]);
  });
  it("带车型描述 → 拼后缀", () => {
    expect(供应商匹配原因({ 车型命中: true }, { 车型描述: "大众-奥迪-A4L" })).toEqual(["匹配车型:大众-奥迪-A4L"]);
  });
  it("带星级 → 追加 ⭐×n", () => {
    expect(供应商匹配原因({ 品牌命中: true, 推荐等级: 2 }, { 带星级: true })).toEqual(["匹配品牌", "⭐⭐"]);
  });
  it("零命中 → 空数组", () => {
    expect(供应商匹配原因({})).toEqual([]);
  });
});

describe("配件分组键", () => {
  const 行 = {
    name: "刹车片",
    supplier_name: "张三汽配",
    part_names: { part_categories: { name: "制动系统" } },
    work_order_items: { work_orders: { vehicles: { plate_number: "京A12345" } } },
  };
  it("四种分组各取对应字段", () => {
    expect(配件分组键(行, "plate")).toBe("京A12345");
    expect(配件分组键(行, "category")).toBe("制动系统");
    expect(配件分组键(行, "name")).toBe("刹车片");
    expect(配件分组键(行, "supplier")).toBe("张三汽配");
  });
  it("字段缺失时给占位文案", () => {
    expect(配件分组键({}, "plate")).toBe("(无车牌)");
    expect(配件分组键({}, "category")).toBe("(未分类)");
    expect(配件分组键({}, "name")).toBe("(未命名)");
    expect(配件分组键({}, "supplier")).toBe("(未指定供应商)");
  });
  it("未知分组方式 → 空串", () => {
    expect(配件分组键(行, "none")).toBe("");
  });
});
