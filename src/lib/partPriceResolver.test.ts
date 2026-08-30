import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePartSellingPrice } from "./partPriceResolver";

/* ============================================================
 * resolvePartSellingPrice — 十级价格优先级（CLAUDE.md 核心规则）
 *
 * 优先级（从高到低）：
 * 1. 指定用户价格—按车辆  2. 按用户  3. 按单位
 * 4. 指定车型价格—单位价  5. VIP价  6. 销售价
 * 7. 配件单位价(standard_price)  9. 配件VIP价  10. 配件标准价(unit_price)
 * ============================================================ */

/* 假 Supabase：按表名返回预设数据，匹配三种查询链形态
 * （specials 直接 await eq 结果 / vehicle 链到 maybeSingle / part 链到 single） */
interface 假数据 {
  specials?: {
    price?: number | null;
    vehicle_id?: string | null;
    customer_id?: string | null;
    companies?: { name?: string | null } | null;
  }[];
  vehiclePrice?: { sales_price?: number; vip_price?: number; standard_price?: number } | null;
  part?: { unit_price?: number; standard_price?: number; vip_price?: number } | null;
}

function 假客户端(数据: 假数据): SupabaseClient {
  const 构造 = {
    from: (表名: string) => ({
      select: () => {
        if (表名 === "part_special_prices") {
          return {
            eq: () => Promise.resolve({ data: 数据.specials || [] }),
          };
        }
        if (表名 === "part_vehicle_prices") {
          return {
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: 数据.vehiclePrice ?? null }),
              }),
            }),
          };
        }
        /* parts 表：select().eq().single() */
        return {
          eq: () => ({
            single: () => Promise.resolve({ data: 数据.part ?? null }),
          }),
        };
      },
    }),
  };
  return 构造 as unknown as SupabaseClient;
}

describe("resolvePartSellingPrice 十级价格优先级", () => {
  it("空 partId → 返回空", async () => {
    const 结果 = await resolvePartSellingPrice(假客户端({}), "", {});
    expect(结果.price).toBeNull();
  });

  it("第1级：指定用户价格-按车辆 命中", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({
        specials: [{ price: 88, vehicle_id: "v1" }],
        part: { unit_price: 100 },
      }),
      "p1",
      { vehicleId: "v1" }
    );
    expect(结果).toEqual({ price: 88, source: "指定用户价格(车辆)" });
  });

  it("第2级：按用户 命中（车辆不匹配时落到用户）", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({
        specials: [{ price: 66, customer_id: "c1" }],
        part: { unit_price: 100 },
      }),
      "p1",
      { vehicleId: "v-不在名单", customerId: "c1" }
    );
    expect(结果).toEqual({ price: 66, source: "指定用户价格(用户)" });
  });

  it("第3级：按单位 命中（单位名大小写不敏感）", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({
        specials: [{ price: 55, companies: { name: "华茂汽配" } }],
        part: { unit_price: 100 },
      }),
      "p1",
      { companyName: "华茂汽配" }
    );
    expect(结果).toEqual({ price: 55, source: "指定用户价格(单位)" });
  });

  it("第4级：指定车型价格-单位价 优先于车型 VIP/销售价", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({
        vehiclePrice: { standard_price: 44, vip_price: 33, sales_price: 22 },
        part: { unit_price: 100 },
      }),
      "p1",
      { vehicleModelId: "m1" }
    );
    expect(结果).toEqual({ price: 44, source: "指定车型价格(单位价)" });
  });

  it("第5级：车型 VIP价（无单位价时）", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({
        vehiclePrice: { vip_price: 33, sales_price: 22 },
        part: { unit_price: 100 },
      }),
      "p1",
      { vehicleModelId: "m1" }
    );
    expect(结果).toEqual({ price: 33, source: "指定车型价格(VIP价)" });
  });

  it("第6级：车型销售价（只有销售价时）", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({
        vehiclePrice: { sales_price: 22 },
        part: { unit_price: 100 },
      }),
      "p1",
      { vehicleModelId: "m1" }
    );
    expect(结果).toEqual({ price: 22, source: "指定车型价格(销售价)" });
  });

  it("第7级：配件单位价 standard_price 优先于配件 VIP/标准价", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({ part: { standard_price: 15, vip_price: 12, unit_price: 10 } }),
      "p1",
      {}
    );
    expect(结果).toEqual({ price: 15, source: "配件单位价" });
  });

  it("第9级：配件 VIP价（无单位价时）", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({ part: { vip_price: 12, unit_price: 10 } }),
      "p1",
      {}
    );
    expect(结果).toEqual({ price: 12, source: "配件VIP价" });
  });

  it("第10级：配件标准价 unit_price 兜底", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({ part: { unit_price: 10 } }),
      "p1",
      {}
    );
    expect(结果).toEqual({ price: 10, source: "配件标准价" });
  });

  it("全部无价格 → 返回空", async () => {
    const 结果 = await resolvePartSellingPrice(假客户端({}), "p1", {});
    expect(结果.price).toBeNull();
  });

  it("高级别压过低级别：车辆指定价 压 车型价 压 配件价", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({
        specials: [{ price: 1, vehicle_id: "v1" }],
        vehiclePrice: { standard_price: 44 },
        part: { standard_price: 15, unit_price: 100 },
      }),
      "p1",
      { vehicleId: "v1", vehicleModelId: "m1", customerId: "c9", companyName: "别家" }
    );
    expect(结果.price).toBe(1);
  });

  it("价格为 0 是有效值（0 元免费单也算命中）", async () => {
    const 结果 = await resolvePartSellingPrice(
      假客户端({ specials: [{ price: 0, vehicle_id: "v1" }] }),
      "p1",
      { vehicleId: "v1" }
    );
    expect(结果.price).toBe(0);
  });
});
