import { describe, it, expect } from "vitest";
import { 转分, 元到分, 先进先出勾稽, 核销合计分, type 应付行 } from "./supplierPaymentAlloc";

/* 构造应付行 */
function 行(id: string, remaining: number): 应付行 {
  return { transaction_id: id, remaining };
}

describe("转分", () => {
  it("正常金额转分", () => {
    expect(转分("100")).toBe(10000);
    expect(转分("0.01")).toBe(1);
    expect(转分("1234.56")).toBe(123456);
  });

  it("非法输入按 0", () => {
    expect(转分("")).toBe(0);
    expect(转分("abc")).toBe(0);
    expect(转分("-50")).toBe(-5000);
  });

  it("浮点安全：0.1+0.2 类场景", () => {
    expect(转分("0.3")).toBe(30);
    expect(元到分(0.1) + 元到分(0.2)).toBe(30);
  });
});

describe("先进先出勾稽", () => {
  it("付款正好够：从老到新逐笔勾满", () => {
    const 清单 = [行("a", 100), 行("b", 200), 行("c", 300)];
    const 结果 = 先进先出勾稽(清单, 60000, 0);
    expect(结果.map((r) => [r.checked, r.allocStr])).toEqual([
      [true, "100.00"],
      [true, "200.00"],
      [true, "300.00"],
    ]);
  });

  it("付款不够：勾满老的，新的勾部分，更晚的不勾", () => {
    const 清单 = [行("a", 100), 行("b", 200), 行("c", 300)];
    const 结果 = 先进先出勾稽(清单, 25000, 0);
    expect(结果.map((r) => [r.checked, r.allocStr])).toEqual([
      [true, "100.00"],
      [true, "150.00"],
      [false, ""],
    ]);
  });

  it("历史付款余额（预付）参与勾稽", () => {
    const 清单 = [行("a", 100), 行("b", 200)];
    /* 本次只付 50，历史余额 200 → 可勾 250 */
    const 结果 = 先进先出勾稽(清单, 5000, 20000);
    expect(结果.map((r) => [r.checked, r.allocStr])).toEqual([
      [true, "100.00"],
      [true, "150.00"],
    ]);
  });

  it("付款为 0 且无余额：全部不勾", () => {
    const 清单 = [行("a", 100)];
    const 结果 = 先进先出勾稽(清单, 0, 0);
    expect(结果[0].checked).toBe(false);
    expect(结果[0].allocStr).toBe("");
  });

  it("已付清的行（remaining=0）不参与", () => {
    const 清单 = [行("a", 0), 行("b", 100)];
    const 结果 = 先进先出勾稽(清单, 10000, 0);
    expect(结果[0].checked).toBe(false);
    expect(结果[1].allocStr).toBe("100.00");
  });

  it("额度多于应付：勾完即止（差额变预付）", () => {
    const 清单 = [行("a", 100)];
    const 结果 = 先进先出勾稽(清单, 50000, 0);
    expect(核销合计分(结果)).toBe(10000);
  });

  it("分以下零头不串行：33.33 + 66.67", () => {
    const 清单 = [行("a", 33.33), 行("b", 66.67)];
    const 结果 = 先进先出勾稽(清单, 10000, 0);
    expect(核销合计分(结果)).toBe(10000);
  });
});

describe("核销合计分", () => {
  it("只统计勾选的行", () => {
    const 清单 = 先进先出勾稽([行("a", 100), 行("b", 100)], 15000, 0);
    /* a 勾 100，b 勾 50 → 合计 150 */
    expect(核销合计分(清单)).toBe(15000);
  });
});
