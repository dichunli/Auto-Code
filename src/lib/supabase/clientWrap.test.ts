import { describe, it, expect } from "vitest";
import { 包装写操作标记 } from "./client";
import { 是否本机最近操作 } from "@/lib/localEditSignal";

/* 假 supabase 客户端：模拟 from() 返回的查询构造器和 rpc()，记录调用 */
function 造假客户端() {
  const 调用记录: string[] = [];
  /* builder 用具体类型（不用 Record<string, unknown>），保证测试里 .select() 等调用有类型 */
  const builder = {
    select: () => { 调用记录.push("select"); return { data: [] as unknown[] }; },
    insert: (...args: unknown[]) => { 调用记录.push("insert"); return { data: args }; },
    update: (...args: unknown[]) => { 调用记录.push("update"); return { data: args }; },
    upsert: (...args: unknown[]) => { 调用记录.push("upsert"); return { data: args }; },
    delete: (...args: unknown[]) => { 调用记录.push("delete"); return { data: args }; },
  };
  return {
    调用记录,
    from: (_relation: string) => builder,
    rpc: (..._args: unknown[]) => { 调用记录.push("rpc"); return { data: null as unknown }; },
  };
}

describe("包装写操作标记", () => {
  it("读操作（select）不标记本机操作", () => {
    const client = 包装写操作标记(造假客户端());
    // 测试文件模块环境独立，此刻应无标记
    client.from("work_orders").select();
    expect(是否本机最近操作(0)).toBe(false);
  });

  it("insert 调用时自动标记本机操作", () => {
    const client = 包装写操作标记(造假客户端());
    client.from("work_orders").insert([{ name: "测试" }]);
    expect(是否本机最近操作()).toBe(true);
  });

  it("update 调用时自动标记本机操作", () => {
    const client = 包装写操作标记(造假客户端());
    client.from("work_orders").update({ name: "改名" });
    expect(是否本机最近操作()).toBe(true);
  });

  it("delete 调用时自动标记本机操作", () => {
    const client = 包装写操作标记(造假客户端());
    client.from("work_orders").delete();
    expect(是否本机最近操作()).toBe(true);
  });

  it("rpc 调用时自动标记本机操作", () => {
    const client = 包装写操作标记(造假客户端());
    client.rpc("transition_work_order", { p_order_id: "x" });
    expect(是否本机最近操作()).toBe(true);
  });

  it("包装后原方法正常执行，返回值不变", () => {
    const client = 包装写操作标记(造假客户端());
    /* 假 insert 原样返回收到的参数列表，调用时传了 1 个参数 [{name:"测试"}] */
    const result = client.from("work_orders").insert([{ name: "测试" }]) as { data: unknown[] };
    expect(result.data).toEqual([[{ name: "测试" }]]);
  });

  it("原方法确实被调用（不吞调用）", () => {
    const 假 = 造假客户端();
    const client = 包装写操作标记(假);
    client.from("work_orders").update({ a: 1 });
    client.rpc("fn");
    expect(假.调用记录).toEqual(["update", "rpc"]);
  });

  it("from 缺少写方法时包装不报错", () => {
    const 残缺 = {
      from: (_relation: string) => ({ select: () => ({ data: [] as unknown[] }) }),
      rpc: () => ({ data: null as unknown }),
    };
    expect(() => 包装写操作标记(残缺)).not.toThrow();
  });
});
