import { SupabaseClient } from "@supabase/supabase-js";

export interface WorkOrderPriceContext {
  vehicleId?: string;
  customerId?: string;
  companyName?: string;
  vehicleModelId?: string;
}

export interface ResolvedPrice {
  price: number | null;
  source: string;
}

/**
 * 根据工单上下文解析配件最优销售价
 * 优先级（从高到低）：
 * 1. 指定用户价格 — 按车辆
 * 2. 指定用户价格 — 按用户
 * 3. 指定用户价格 — 按单位
 * 4. 指定车型价格 — 单位价
 * 5. 指定车型价格 — VIP价
 * 6. 指定车型价格 — 销售价
 * 7. 配件单位价 (standard_price)
 * 8. 配件车型价 (?? - 暂用 vehicle_prices 的 sales_price)
 * 9. 配件VIP价 (vip_price)
 * 10. 配件标准价 (unit_price)
 */
export async function resolvePartSellingPrice(
  supabase: SupabaseClient,
  partId: string,
  ctx: WorkOrderPriceContext
): Promise<ResolvedPrice> {
  if (!partId) return { price: null, source: "" };

  /* 并行查询三种价格源 */
  const [specialRes, vehicleRes, partRes] = await Promise.all([
    supabase
      .from("part_special_prices")
      .select("price, vehicle_id, customer_id, company_id, companies(name)")
      .eq("part_id", partId),
    ctx.vehicleModelId
      ? supabase
          .from("part_vehicle_prices")
          .select("sales_price, vip_price, standard_price")
          .eq("part_id", partId)
          .eq("vehicle_model_id", ctx.vehicleModelId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("parts")
      .select("unit_price, standard_price, vip_price")
      .eq("id", partId)
      .single(),
  ]);

  const specials = (specialRes.data || []) as any[];
  const vehiclePrice = vehicleRes.data as {
    sales_price?: number;
    vip_price?: number;
    standard_price?: number;
  } | null;
  const part = partRes.data as {
    unit_price?: number;
    standard_price?: number;
    vip_price?: number;
  } | null;

  /* 1. 指定用户价格 — 按车辆 */
  if (ctx.vehicleId) {
    const matched = specials.find((s) => s.vehicle_id === ctx.vehicleId);
    if (matched?.price != null) {
      return { price: matched.price, source: "指定用户价格(车辆)" };
    }
  }

  /* 2. 指定用户价格 — 按用户 */
  if (ctx.customerId) {
    const matched = specials.find((s) => s.customer_id === ctx.customerId);
    if (matched?.price != null) {
      return { price: matched.price, source: "指定用户价格(用户)" };
    }
  }

  /* 3. 指定用户价格 — 按单位 */
  if (ctx.companyName) {
    const matched = specials.find(
      (s) =>
        s.companies?.name &&
        s.companies.name.toLowerCase() === ctx.companyName!.toLowerCase()
    );
    if (matched?.price != null) {
      return { price: matched.price, source: "指定用户价格(单位)" };
    }
  }

  /* 4-6. 指定车型价格 */
  if (vehiclePrice) {
    if (vehiclePrice.standard_price != null) {
      return { price: vehiclePrice.standard_price, source: "指定车型价格(单位价)" };
    }
    if (vehiclePrice.vip_price != null) {
      return { price: vehiclePrice.vip_price, source: "指定车型价格(VIP价)" };
    }
    if (vehiclePrice.sales_price != null) {
      return { price: vehiclePrice.sales_price, source: "指定车型价格(销售价)" };
    }
  }

  /* 7. 配件单位价 */
  if (part?.standard_price != null) {
    return { price: part.standard_price, source: "配件单位价" };
  }

  /* 8. 配件车型价 — 暂用 vehicle_prices 的 sales_price 兜底 */
  /* 已在 4-6 处理，此处跳过避免重复 */

  /* 9. 配件VIP价 */
  if (part?.vip_price != null) {
    return { price: part.vip_price, source: "配件VIP价" };
  }

  /* 10. 配件标准价 */
  if (part?.unit_price != null) {
    return { price: part.unit_price, source: "配件标准价" };
  }

  return { price: null, source: "" };
}
