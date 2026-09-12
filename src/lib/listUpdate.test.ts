import { describe, it, expect } from "vitest";
import { 更新列表项, 移除列表项 } from "./listUpdate";

interface 测试行 {
  id: string;
  name: string;
  quantity: number;
}

const 原列表: 测试行[] = [
  { id: "a", name: "苹果", quantity: 1 },
  { id: "b", name: "香蕉", quantity: 2 },
  { id: "c", name: "橙子", quantity: 3 },
];

describe("更新列表项", () => {
  it("对象 patch：只更新目标行，其它行保持原引用", () => {
    const 结果 = 更新列表项(原列表, "b", { quantity: 20 });
    expect(结果).toHaveLength(3);
    expect(结果[1]).toEqual({ id: "b", name: "香蕉", quantity: 20 });
    /* 未命中的行必须保持原引用（React diff 不重渲染的关键） */
    expect(结果[0]).toBe(原列表[0]);
    expect(结果[2]).toBe(原列表[2]);
    /* 原数组不被修改（不可变更新） */
    expect(原列表[1].quantity).toBe(2);
  });

  it("函数 patch：基于旧行计算新行", () => {
    const 结果 = 更新列表项(原列表, "a", (行) => ({ ...行, quantity: 行.quantity + 10 }));
    expect(结果[0].quantity).toBe(11);
  });

  it("id 不存在时内容不变", () => {
    const 结果 = 更新列表项(原列表, "不存在", { quantity: 99 });
    expect(结果).toEqual(原列表);
  });
});

describe("移除列表项", () => {
  it("按 id 数组移除多条", () => {
    const 结果 = 移除列表项(原列表, ["a", "c"]);
    expect(结果).toEqual([{ id: "b", name: "香蕉", quantity: 2 }]);
  });

  it("按 Set 移除单条", () => {
    const 结果 = 移除列表项(原列表, new Set(["b"]));
    expect(结果.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("id 都不存在时原样返回", () => {
    const 结果 = 移除列表项(原列表, ["x"]);
    expect(结果).toEqual(原列表);
  });

  it("原数组不被修改", () => {
    移除列表项(原列表, ["a", "b", "c"]);
    expect(原列表).toHaveLength(3);
  });
});
