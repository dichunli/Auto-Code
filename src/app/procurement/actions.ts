"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 采购模块 Server Action ═══
 * 入库、收货、建单等核心写操作统一走服务端:
 * 1. 先验证登录,避免客户端 session 异常导致 401/RLS 42501
 * 2. 多表写入由数据库函数(RPC)一个事务完成,任一失败整体回滚
 * 3. 库存数量以数据库当前值为准(SQL 原子自增),不用客户端快照
 */

interface 操作结果 {
  success: boolean;
  error?: string;
}

interface RPC返回 {
  success: boolean;
  error?: string;
  inbound_order_id?: string;
  inbound_no?: string;
}

/* ═══ 行内配件关联（usePartLinking 共享 Hook 的写库收编） ═══
 * 收货/入库/退货/采购 4 个列表的"行内编辑配件"写库统一走这里：
 * 主表 + 可选双写 WOI 副表，"为空才填"的当前值在服务端读最新（不用客户端快照）。
 * 字段级差异由客户端配置传入，语义与原 Hook 完全一致。 */
export interface 行内配件快照 {
  id: string;
  part_number?: string | null;
  barcode?: string | null;
  name?: string | null;
  unit?: string | null;
  unit_cost?: number | null;
  unit_price?: number | null;
  purchase_price?: number | null;
  part_names?: {
    name?: string | null;
    unit?: string | null;
    part_categories?: { name?: string | null } | null;
  } | null;
  part_brands?: { name?: string | null } | null;
  part_specifications?: { name?: string | null } | null;
}

export async function 行内配件关联(参数: {
  主表: "purchase_order_items" | "work_order_item_parts";
  主表行id: string;
  副表行id: string | null;
  双写WOI: boolean;
  写WoiPartId: boolean;
  行内unitCost来源: "unit_cost" | "purchase_price";
  行内写售价: boolean;
  弹窗写supplierPartName: boolean;
  弹窗写WoiDocumentName: boolean;
  弹窗规格来源: "specification_text" | "join";
  模式: "弹窗保存" | "行内选中" | "行内清除";
  partId?: string;
  行内配件?: 行内配件快照;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const 取join名 = (v: { name?: string | null }[] | { name?: string | null } | null | undefined): string | null =>
    Array.isArray(v) ? v[0]?.name ?? null : v?.name ?? null;

  /* ── 行内清除：解除配件关联 ── */
  if (参数.模式 === "行内清除") {
    const { error: 主表Err } = await supabase
      .from(参数.主表)
      .update({ part_id: null, part_number: null })
      .eq("id", 参数.主表行id);
    if (主表Err) return { success: false, error: 主表Err.message };

    if (参数.双写WOI && 参数.副表行id) {
      const { error: woiErr } = await supabase
        .from("work_order_item_parts")
        .update({ part_id: null, part_number: null })
        .eq("id", 参数.副表行id);
      if (woiErr) console.warn("同步清除工单配件信息失败:", woiErr);
    }
    revalidatePath("/procurement");
    return { success: true };
  }

  /* ── 弹窗保存：服务端读配件全量信息，写主表 + 双写副表 ── */
  if (参数.模式 === "弹窗保存") {
    if (!参数.partId) return { success: false, error: "缺少配件信息" };

    const { data: part } = await supabase
      .from("parts")
      .select("part_number, name, unit, part_categories(name), part_brands(name), specification_text, part_specifications(name), purchase_price, notes, document_name")
      .eq("id", 参数.partId)
      .single();
    const p = (part || {}) as Record<string, unknown>;
    const brandName = 取join名(p.part_brands as { name?: string }[] | { name?: string } | null | undefined);

    const 主表Updates: Record<string, unknown> = { part_id: 参数.partId };
    if (p.part_number != null) 主表Updates.part_number = p.part_number;
    if (p.name != null) 主表Updates.name = p.name;
    if (p.unit != null) 主表Updates.unit = p.unit;
    if (p.brand_id != null) 主表Updates.brand = brandName;
    if (p.purchase_price != null) 主表Updates.unit_cost = p.purchase_price;
    if (p.notes != null) 主表Updates.notes = p.notes;

    if (参数.主表 === "purchase_order_items") {
      const catName = 取join名(p.part_categories as { name?: string }[] | { name?: string } | null | undefined);
      if (catName != null) 主表Updates.category = catName;
      if (p.specification_text != null) 主表Updates.specification = p.specification_text;
      if (参数.弹窗写supplierPartName && p.document_name != null) {
        主表Updates.supplier_part_name = p.document_name;
      }
    } else {
      if (参数.弹窗规格来源 === "join") {
        const specName = 取join名(p.part_specifications as { name?: string }[] | { name?: string } | null | undefined);
        if (specName != null) 主表Updates.specification = specName;
      } else if (p.specification_text != null) {
        主表Updates.specification = p.specification_text;
      }
      if (参数.弹窗写WoiDocumentName && p.document_name != null) {
        主表Updates.document_name = p.document_name;
      }
    }

    const { error: 主表Err } = await supabase
      .from(参数.主表)
      .update(主表Updates)
      .eq("id", 参数.主表行id);
    if (主表Err) return { success: false, error: 主表Err.message };

    if (参数.双写WOI && 参数.副表行id) {
      const woiUpdates: Record<string, unknown> = {};
      /* 缺陷保持：副表不写 part_id（写WoiPartId 此时为 false） */
      if (参数.写WoiPartId) woiUpdates.part_id = 参数.partId;
      if (p.part_number != null) woiUpdates.part_number = p.part_number;
      if (p.name != null) woiUpdates.name = p.name;
      if (p.unit != null) woiUpdates.unit = p.unit;
      if (p.brand_id != null) woiUpdates.brand = brandName;
      if (p.specification_text != null) woiUpdates.specification = p.specification_text;
      if (p.purchase_price != null) woiUpdates.unit_cost = p.purchase_price;
      if (p.notes != null) woiUpdates.notes = p.notes;
      if (参数.弹窗写WoiDocumentName && p.document_name != null) {
        woiUpdates.document_name = p.document_name;
      }
      if (Object.keys(woiUpdates).length > 0) {
        const { error: woiErr } = await supabase
          .from("work_order_item_parts")
          .update(woiUpdates)
          .eq("id", 参数.副表行id);
        if (woiErr) console.warn("同步工单配件信息失败:", woiErr);
      }
    }

    revalidatePath("/procurement");
    return { success: true };
  }

  /* ── 行内选中：客户端传入配件快照，"为空才填"的当前值在服务端读最新 ── */
  const part = 参数.行内配件;
  if (!part) return { success: false, error: "缺少配件信息" };

  /* 读主表行当前值（两表列不同：POI 无 unit_price、有 category；WOI 相反） */
  const { data: 主表行 } = 参数.主表 === "purchase_order_items"
    ? await supabase
        .from(参数.主表)
        .select("name, unit, brand, specification, unit_cost, category")
        .eq("id", 参数.主表行id)
        .single()
    : await supabase
        .from(参数.主表)
        .select("name, unit, brand, specification, unit_cost, unit_price")
        .eq("id", 参数.主表行id)
        .single();
  const 行视图 = (主表行 || {}) as Record<string, unknown>;

  const 主表Updates: Record<string, unknown> = { part_id: part.id };
  if (part.part_number != null) 主表Updates.part_number = part.part_number;
  if (part.barcode != null && !part.part_number) 主表Updates.part_number = part.barcode;
  if (!行视图.name) {
    if (part.name != null) 主表Updates.name = part.name;
    else if (part.part_names?.name != null) 主表Updates.name = part.part_names.name;
  }
  if (!行视图.unit) {
    if (part.unit != null) 主表Updates.unit = part.unit;
    else if (part.part_names?.unit != null) 主表Updates.unit = part.part_names.unit;
  }
  if (!行视图.brand && part.part_brands?.name != null) 主表Updates.brand = part.part_brands.name;
  if (!行视图.specification && part.part_specifications?.name != null) 主表Updates.specification = part.part_specifications.name;

  if (参数.主表 === "purchase_order_items") {
    /* POI 专属：分类（正确路径在 part_names 里） */
    if (!行视图.category) {
      const catName = part.part_names?.part_categories?.name;
      if (catName != null) 主表Updates.category = catName;
    }
  }

  /* 主表为 WOI（退货/采购）时，价格/part_id 也在主表写 */
  if (参数.主表 === "work_order_item_parts") {
    if (参数.写WoiPartId) 主表Updates.part_id = part.id;
    const cost来源 = 参数.行内unitCost来源 === "purchase_price" ? part.purchase_price : part.unit_cost;
    if ((行视图.unit_cost == null || 行视图.unit_cost === 0) && cost来源 != null) {
      主表Updates.unit_cost = cost来源;
    }
    if (参数.行内写售价 && 行视图.unit_price == null && part.unit_price != null) {
      主表Updates.unit_price = part.unit_price;
    }
  }

  const { error: 主表Err } = await supabase
    .from(参数.主表)
    .update(主表Updates)
    .eq("id", 参数.主表行id);
  if (主表Err) return { success: false, error: 主表Err.message };

  /* 双写 WOI 副表（收货/入库）：服务端读副表当前值再按"为空才填" */
  if (参数.双写WOI && 参数.副表行id) {
    const { data: woi行 } = await supabase
      .from("work_order_item_parts")
      .select("name, unit, brand, specification, unit_cost, unit_price")
      .eq("id", 参数.副表行id)
      .single();
    const woiCurrent = (woi行 || {}) as Record<string, unknown>;

    const woiUpdates: Record<string, unknown> = {};
    if (part.part_number != null) woiUpdates.part_number = part.part_number;
    if (!woiCurrent.name && part.name != null) woiUpdates.name = part.name;
    if (!woiCurrent.unit && part.unit != null) woiUpdates.unit = part.unit;
    if (!woiCurrent.brand && part.part_brands?.name != null) woiUpdates.brand = part.part_brands.name;
    if (!woiCurrent.specification && part.part_specifications?.name != null) woiUpdates.specification = part.part_specifications.name;

    const cost来源 = 参数.行内unitCost来源 === "purchase_price" ? part.purchase_price : part.unit_cost;
    if ((woiCurrent.unit_cost == null || woiCurrent.unit_cost === 0) && cost来源 != null) {
      woiUpdates.unit_cost = cost来源;
    }
    if (参数.行内写售价 && woiCurrent.unit_price == null && part.unit_price != null) {
      woiUpdates.unit_price = part.unit_price;
    }

    if (Object.keys(woiUpdates).length > 0) {
      const { error: woiErr } = await supabase
        .from("work_order_item_parts")
        .update(woiUpdates)
        .eq("id", 参数.副表行id);
      if (woiErr) console.warn("同步工单配件信息失败:", woiErr);
    }
  }

  revalidatePath("/procurement");
  return { success: true };
}


/* ─── 入库明细(前端弹窗确认后的每行) ─── */
export interface 入库明细输入 {
  purchase_order_item_id: string;
  quantity: number;
  batch_no: string;
  warehouse_id: string;
  location: string;
  notes: string;
  is_excess: boolean;
  /* 销售单口径（2026-08-21）：自定义入库价（可空=采购明细价）、手动运费（可空=自动分摊） */
  unit_cost?: number | null;
  freight_alloc?: number | null;
}

/* ─── 确认入库:一个事务写 8 张表,失败整体回滚 ─── */
export async function 确认采购入库(
  采购单id: string,
  明细: 入库明细输入[],
  运费: number,
  抹零: number | null = null,
  销售单单号: string | null = null,
  销售单金额: number | null = null
): Promise<操作结果 & { inbound_no?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!明细 || 明细.length === 0) {
    return { success: false, error: "入库明细不能为空" };
  }
  for (const m of 明细) {
    if (!m.purchase_order_item_id) {
      return { success: false, error: "入库明细缺少采购明细信息" };
    }
    if (!m.is_excess && (!Number.isInteger(m.quantity) || m.quantity <= 0)) {
      return { success: false, error: "入库数量必须是大于 0 的整数" };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_purchase_inbound", {
    p_purchase_order_id: 采购单id,
    p_items: 明细,
    p_freight_amount: 运费 || 0,
    p_operator_id: user.id,
    p_discount_amount: 抹零,
    p_supplier_order_no: 销售单单号,
    p_supplier_order_amount: 销售单金额,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "入库失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/inbound-orders");
  return { success: true, inbound_no: 结果.inbound_no };
}

/* ─── 退回待收货:清空处理结果、删补货分支、状态回退,一个事务 ─── */
export async function 退回待收货(采购单id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_pending_storage", {
    p_purchase_order_id: 采购单id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "退回失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 退回已入库(2026-08-16 批次1 错账收口):整单回滚入库,一个事务 ───
 * 替代原 CompletedStorageList 客户端 10 步连环写(无事务、库存先读再写、
 * 非 admin 删单被 RLS 静默拦→错账)。库存净额回滚+退库回补+到货标记回退。 */
export async function 退回已入库(采购单id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_completed_inbound", {
    p_purchase_order_id: 采购单id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "退回失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/inbound-orders");
  return { success: true };
}

/* ─── 撤销/作废采购单(2026-08-17):仅未收货可操作,单据只废不删 ───
 * revoke 撤销:配件回待采购(工单行 is_purchased 回 false、暂存件回暂存表);
 * void 作废:配件不回,单据留档。两种模式单据都标 cancelled 留档。 */
export async function 撤销作废采购单(
  采购单id: string,
  模式: "revoke" | "void"
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_purchase_order", {
    p_purchase_order_id: 采购单id,
    p_mode: 模式,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "操作失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/procurement/orders");
  return { success: true };
}

/* ═══ 采购建单 ═══ */

export interface 采购明细输入 {
  part_id?: string | null;
  part_name_id?: string | null;
  part_number?: string | null;
  name: string;
  supplier_part_name?: string | null;
  brand?: string | null;
  specification?: string | null;
  quantity: number;
  unit?: string | null;
  unit_cost?: number | null;
  category?: string | null;
  license_plate?: string | null;
  photos?: string[];
  notes?: string | null;
  work_order_item_part_id?: string | null;
}

export interface 采购单分组输入 {
  supplier_id: string;
  status?: string;
  logistics_company_id?: string | null;
  notes?: string | null;
  items: 采购明细输入[];
}

interface 建单RPC返回 {
  success: boolean;
  error?: string;
  orders?: { id: string; order_no: string }[];
}

/* ─── 创建采购单:建头+明细+回写工单配件行+清理暂存行,一个事务;支持一次多张(按供应商分组) ───
 * 暂存ids（2026-08-19 收编）：发起采购涉及的 custom_purchase_staging 行 id，
 * 由 RPC 在同一事务内删除（原为客户端补删，失败残留会导致暂存件重复显示） */
export async function 创建采购单(
  分组: 采购单分组输入[],
  暂存ids: string[] = []
): Promise<操作结果 & { orders?: { id: string; order_no: string }[] }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!分组 || 分组.length === 0) {
    return { success: false, error: "采购单不能为空" };
  }
  for (const g of 分组) {
    if (!g.supplier_id) {
      return { success: false, error: "请选择供应商" };
    }
    if (!g.items || g.items.length === 0) {
      return { success: false, error: "采购明细不能为空" };
    }
    for (const it of g.items) {
      if (!it.name || !it.name.trim()) {
        return { success: false, error: "配件名称不能为空" };
      }
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
        return { success: false, error: "采购数量必须是大于 0 的整数" };
      }
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_orders", {
    p_orders: 分组,
    p_staging_ids: 暂存ids,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as 建单RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "创建采购单失败" };
  }

  revalidatePath("/procurement");
  return { success: true, orders: 结果.orders };
}

/* ═══ 自定义采购暂存（2026-08-15） ═══
 * 安全库存补货/自定义采购弹窗不直接建采购单，先暂存，
 * 在「待采购」页与工单配件一起勾选后统一发起采购。 */

export interface 采购暂存输入 {
  part_id: string | null;
  part_number: string | null;
  name: string;
  brand: string | null;
  specification: string | null;
  document_name: string | null;
  unit: string | null;
  unit_cost: number | null;
  quantity: number;
  supplier_id: string;
  source: "safety_stock" | "custom";
}

export async function 添加采购暂存(行列表: 采购暂存输入[]): Promise<操作结果 & { count?: number }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!行列表 || 行列表.length === 0) {
    return { success: false, error: "没有要添加的配件" };
  }
  for (const r of 行列表) {
    if (!r.name || !r.name.trim()) return { success: false, error: "配件名称不能为空" };
    if (!r.supplier_id) return { success: false, error: `「${r.name}」还没选供应商` };
    if (!Number.isInteger(r.quantity) || r.quantity <= 0) {
      return { success: false, error: `「${r.name}」的采购数量必须是大于 0 的整数` };
    }
  }

  const supabase = await createClient();

  /* 供应商名称以服务端为准，不信客户端传的文字 */
  const 供应商ids = [...new Set(行列表.map((r) => r.supplier_id))];
  const { data: 供应商列表 } = await supabase.from("suppliers").select("id, name").in("id", 供应商ids);
  const 供应商名Map = new Map(((供应商列表 || []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  for (const r of 行列表) {
    if (!供应商名Map.has(r.supplier_id)) return { success: false, error: "供应商不存在，请刷新后重试" };
  }

  const { error } = await supabase.from("custom_purchase_staging").insert(
    行列表.map((r) => ({
      part_id: r.part_id || null,
      part_number: r.part_number?.trim() || null,
      name: r.name.trim(),
      brand: r.brand?.trim() || null,
      specification: r.specification?.trim() || null,
      document_name: r.document_name?.trim() || null,
      unit: r.unit?.trim() || null,
      unit_cost: r.unit_cost ?? null,
      quantity: r.quantity,
      supplier_id: r.supplier_id,
      supplier_name: 供应商名Map.get(r.supplier_id),
      source: r.source,
      created_by: user.id,
    }))
  );
  if (error) return { success: false, error: error.message };

  revalidatePath("/procurement");
  return { success: true, count: 行列表.length };
}

/* ═══ 收货处理 ═══ */

/* ─── 收货登记:更新明细+克隆补货分支+服务端重算状态+运单联动,一个事务 ─── */
export async function 提交收货处理(
  采购单id: string,
  明细id: string,
  处理动作: string,
  实收数量: number,
  凭证照片: string[] | null,
  更新凭证: boolean
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!Number.isInteger(实收数量) || 实收数量 < 0) {
    return { success: false, error: "实收数量必须是 ≥ 0 的整数" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_purchase_item", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_handle_action: 处理动作,
    p_received_qty: 实收数量,
    p_evidence_photos: 凭证照片,
    p_set_evidence: 更新凭证,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "收货失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 撤销收货:清空处理结果+删补货分支+状态回退,一个事务 ─── */
export async function 撤销收货处理(采购单id: string, 明细id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_purchase_receipt", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "撤销失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 部分收货(采购单详情页):实收原子累加,收满推进待入库,不加库存 ─── */
export async function 部分收货登记(
  采购单id: string,
  明细id: string,
  本次数量: number
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!Number.isInteger(本次数量) || 本次数量 <= 0) {
    return { success: false, error: "收货数量必须是大于 0 的整数" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_purchase_item_partial", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_qty: 本次数量,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "收货失败" };
  }

  revalidatePath("/procurement");
  revalidatePath(`/procurement/${采购单id}`);
  return { success: true };
}

/* ═══ 退货 / 采退单 ═══ */

/* ─── 标记退货记录已完成(2026-08-19 起记账) ───
 * 与"生成采退单"口径统一：标记完成时按 数量×采购价 记应收冲减(credit)，
 * 供应商按名称文本匹配；匹配不到供应商/无采购价则只改状态不记账(accounted=false)。 */
export async function 完成退货记录(记录id: string): Promise<操作结果 & { accounted?: boolean }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_return_record", {
    p_record_id: 记录id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as { success: boolean; error?: string; accounted?: boolean };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "操作失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/supplier-returns");
  return { success: true, accounted: 结果.accounted };
}

/* ─── 批量撤销退货:含入库单整单回滚/弃货加回库存,一个事务 ─── */
export async function 批量撤销退货(记录ids: string[]): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!记录ids || 记录ids.length === 0) {
    return { success: false, error: "请先选择要撤销的记录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_supplier_returns", {
    p_record_ids: 记录ids,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "撤销失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/supplier-returns");
  return { success: true };
}

/* ─── 撤销已退货(2026-08-16 批次2):删采退单+应收冲减+记录回 pending,一个事务 ───
 * 替代原 CompletedReturnList 客户端 5 步连环删(无事务,中途失败留半成品)。
 * 注意:撤销的是整张采退单(同单全部退货记录回 pending),不是只撤一条。 */
export async function 撤销已退货记录(记录id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_purchase_return_order", {
    p_record_id: 记录id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "撤销失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/supplier-returns");
  revalidatePath("/return-orders");
  return { success: true };
}

/* ─── 采退单分组(按供应商) ─── */
export interface 采退单分组输入 {
  supplier_id: string | null;
  supplier_name: string;
  logistics_company?: string | null;
  tracking_no?: string | null;
  return_shipping_fee?: number;
  shipping_fee_payer?: string | null;
  notes?: string | null;
  records: {
    record_id: string;
    part_id?: string | null;
    part_number?: string | null;
    name?: string | null;
    brand?: string | null;
    specification?: string | null;
    quantity: number;
    return_reason?: string | null;
    unit_cost?: number | null;
  }[];
}

/* ─── 生成采退单:建单+明细+退货记录完成+应收冲减,全部供应商一个事务 ─── */
export async function 生成采退单(
  分组: 采退单分组输入[]
): Promise<操作结果 & { orders?: { id: string; return_no: string }[] }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!分组 || 分组.length === 0) {
    return { success: false, error: "采退单不能为空" };
  }
  for (const g of 分组) {
    if (!g.records || g.records.length === 0) {
      return { success: false, error: "采退单明细不能为空" };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_return_orders", {
    p_groups: 分组,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回 & { orders?: { id: string; return_no: string }[] };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "生成采退单失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/return-orders");
  revalidatePath("/supplier-returns");
  return { success: true, orders: 结果.orders };
}

/* ─── 更新工单配件客户意见(待采购页可改:改"未确定"退回待确认,改"否决"不再推进) ─── */
export async function 更新工单配件客户意见(行id: string, 意见: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!["pending", "agree", "reject"].includes(意见)) {
    return { success: false, error: "非法的客户意见值" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_parts")
    .update({ customer_opinion: 意见 })
    .eq("id", 行id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 更新单据名称(各 Tab 失焦即存) ───
 * 单据名称有两个存放点:
 *  - 工单配件行 work_order_item_parts.document_name(待询价/待报价/待确认/待采购/退货环节的展示来源)
 *  - 采购明细快照 purchase_order_items.supplier_part_name(待收货/待入库/已入库的展示来源)
 * 改动任一处时联动同步另一处,保证各 Tab 看到的单据名称一致。
 * 联动范围:工单配件行改名 → 只同步「未完成采购单」的明细快照(已完成的是历史凭证不动)。 */
export async function 更新配件单据名称(参数: {
  工单配件行id?: string | null;
  采购明细id?: string | null;
  单据名称: string;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const { 工单配件行id, 采购明细id } = 参数;
  const 新名称 = 参数.单据名称.trim() || null;
  if (!工单配件行id && !采购明细id) {
    return { success: false, error: "缺少要更新的行信息" };
  }

  const supabase = await createClient();

  if (工单配件行id) {
    const { error } = await supabase
      .from("work_order_item_parts")
      .update({ document_name: 新名称 })
      .eq("id", 工单配件行id);
    if (error) return { success: false, error: error.message };

    /* 联动同步:该配件行关联的、采购单未完成的明细快照(先查出目标明细 id 再更新) */
    const { data: 待同步 } = await supabase
      .from("purchase_order_items")
      .select("id, purchase_orders!inner(status)")
      .eq("work_order_item_part_id", 工单配件行id)
      .not("purchase_orders.status", "in", "(completed,cancelled)");
    const 待同步ids = (待同步 || []).map((r: { id: string }) => r.id);
    if (待同步ids.length > 0) {
      const { error: 联动错误 } = await supabase
        .from("purchase_order_items")
        .update({ supplier_part_name: 新名称 })
        .in("id", 待同步ids);
      if (联动错误) console.warn("联动同步采购明细单据名称失败:", 联动错误);
    }
  }

  if (采购明细id) {
    const { data: 明细, error: 读错误 } = await supabase
      .from("purchase_order_items")
      .select("work_order_item_part_id")
      .eq("id", 采购明细id)
      .single();
    if (读错误) return { success: false, error: 读错误.message };

    const { error } = await supabase
      .from("purchase_order_items")
      .update({ supplier_part_name: 新名称 })
      .eq("id", 采购明细id);
    if (error) return { success: false, error: error.message };

    /* 联动回写工单配件行(源头一致) */
    if (明细?.work_order_item_part_id) {
      const { error: 联动错误 } = await supabase
        .from("work_order_item_parts")
        .update({ document_name: 新名称 })
        .eq("id", 明细.work_order_item_part_id);
      if (联动错误) console.warn("联动回写工单配件单据名称失败:", 联动错误);
    }
  }

  revalidatePath("/procurement");
  return { success: true };
}
export async function 删除采购明细(采购单id: string, 明细id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_purchase_item", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "删除失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 单个配件撤销退回待采购(2026-08-20):配件级版"撤销整单" ───
 * 收货前发现某个配件这次不需要买了：工单行 is_purchased 回 false(回待采购列表)、
 * 暂存件回暂存表、删采购明细；明细删空时整单标 cancelled 留档(只废不删)。
 * 与"作废"(删除采购明细,上面)的区别：撤销=配件回待采购可重新组单，作废=彻底删除。 */
export async function 撤销采购明细退回待采购(采购单id: string, 明细id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_purchase_item_to_pending", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "撤销失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 移除采购暂存行（从待采购列表移除，不生成采购单） ─── */
export async function 移除采购暂存行(stagingId: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("custom_purchase_staging").delete().eq("id", stagingId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 保存采购暂存行数量（自定义采购项数量必填） ─── */
export async function 保存暂存行数量(参数: {
  stagingId: string;
  quantity: number | null;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.quantity === null) {
    return { success: false, error: "自定义采购项数量必填" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_purchase_staging")
    .update({ quantity: 参数.quantity })
    .eq("id", 参数.stagingId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 保存待采购配件数量（配件分支行，数量可空=未填） ─── */
export async function 保存待采购配件数量(参数: {
  partId: string;
  quantity: number | null;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_parts")
    .update({ quantity: 参数.quantity })
    .eq("id", 参数.partId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 批量撤销配件客户意见（待采购列表"撤销"操作） ─── */
export async function 批量撤销配件意见(参数: {
  ids: string[];
  opinion: string;
  reason: string;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.ids.length === 0) {
    return { success: false, error: "请先选择配件" };
  }
  if (!参数.reason.trim()) {
    return { success: false, error: "请填写撤销原因" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_parts")
    .update({ customer_opinion: 参数.opinion, revoke_reason: 参数.reason.trim() })
    .in("id", 参数.ids);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 保存采购明细配件图片（手机收货时补拍实物图，追加即落库） ─── */
export async function 保存采购明细图片(参数: {
  itemId: string;
  paths: string[];
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_order_items")
    .update({ photos: 参数.paths })
    .eq("id", 参数.itemId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/m/receiving");
  return { success: true };
}

/* ─── 保存供应商销售单（收货时顺带保存，选填不阻塞） ─── */
export async function 保存供应商销售单(参数: {
  orderId: string;
  slipNo: string;
  slipAmount: number | null;
  slipPhotos: string[];
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({
      supplier_order_no: 参数.slipNo.trim() || null,
      supplier_order_amount: 参数.slipAmount,
      supplier_slip_photos: 参数.slipPhotos.length > 0 ? 参数.slipPhotos : null,
    })
    .eq("id", 参数.orderId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  revalidatePath("/m/receiving");
  return { success: true };
}

/* ═══ 跨单收货：暂存 + 手动统一提交（2026-09-04 用户拍板） ═══
 * 同一供应商多张采购单可跨单收货；确认收货先暂存（不关页面也在），
 * 收完一批手动「提交收货」一次事务统一入账；不新建到货确认单。 */

/* ─── 写暂存（收货弹窗确认时调，不入账） ─── */
export async function 暂存收货(
  明细id: string,
  数量: number,
  动作: string,
  凭证: string[] | null
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!Number.isInteger(数量) || 数量 < 0) {
    return { success: false, error: "暂存数量必须是 ≥0 的整数" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stage_receiving_item", {
    p_item_id: 明细id,
    p_qty: 数量,
    p_action: 动作,
    p_evidence: 凭证 && 凭证.length > 0 ? 凭证 : null,
    p_operator_id: user.id,
  });
  if (error) return { success: false, error: error.message };
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) return { success: false, error: 结果?.error || "暂存失败" };
  return { success: true };
}

/* ─── 撤销暂存（收错了重收） ─── */
export async function 撤销暂存收货(明细id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unstage_receiving_item", {
    p_item_id: 明细id,
    p_operator_id: user.id,
  });
  if (error) return { success: false, error: error.message };
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) return { success: false, error: 结果?.error || "撤销失败" };
  return { success: true };
}

/* ─── 提交暂存收货（按供应商统一入账，一次事务） ─── */
export async function 提交暂存收货(
  供应商id: string,
  销售单号: string | null
): Promise<操作结果 & { count?: number }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!供应商id) {
    return { success: false, error: "缺少供应商信息" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_staged_batch", {
    p_supplier_id: 供应商id,
    p_supplier_order_no: 销售单号?.trim() || null,
    p_operator_id: user.id,
  });
  if (error) return { success: false, error: error.message };
  const 结果 = data as unknown as RPC返回 & { count?: number };
  if (!结果?.success) return { success: false, error: 结果?.error || "提交失败" };

  revalidatePath("/procurement");
  revalidatePath("/m/receiving");
  return { success: true, count: 结果.count };
}

/* ─── 按收货批次入库（2026-09-04）：跨采购单一次入库，应付款按批次（销售单口径）合并 ─── */
export async function 确认批次入库(
  批次id: string,
  明细: 入库明细输入[],
  运费: number,
  抹零: number | null = null,
  销售单金额: number | null = null
): Promise<操作结果 & { inbound_no?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!明细 || 明细.length === 0) {
    return { success: false, error: "入库明细不能为空" };
  }
  for (const m of 明细) {
    if (!m.purchase_order_item_id) {
      return { success: false, error: "入库明细缺少采购明细信息" };
    }
    if (!m.is_excess && (!Number.isInteger(m.quantity) || m.quantity <= 0)) {
      return { success: false, error: "入库数量必须是大于 0 的整数" };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_batch_inbound", {
    p_batch_id: 批次id,
    p_items: 明细,
    p_freight_amount: 运费 || 0,
    p_operator_id: user.id,
    p_discount_amount: 抹零,
    p_supplier_order_amount: 销售单金额,
  });
  if (error) return { success: false, error: error.message };
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) return { success: false, error: 结果?.error || "入库失败" };

  revalidatePath("/procurement");
  revalidatePath("/inbound-orders");
  return { success: true, inbound_no: 结果.inbound_no };
}
