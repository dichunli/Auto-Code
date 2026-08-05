"use server";

import { randomBytes } from "crypto";
import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/* ═══ 供应商自助报价（询价链接）Server Action ═══
 * 内部操作（生成/列表/作废/采用）必须登录；
 * 公开操作（供应商查单/查编码/提交报价）只凭链接 token，
 * 用 service role 写库，token 即凭证，全部校验有效期和状态。 */

/* 询价链接有效期：3 小时（用户定） */
const 有效期毫秒 = 3 * 60 * 60 * 1000;

/* ── 简单限流：同一 token 每小时最多查 60 次编码（防接口被薅配件库） ── */
const 查询限流桶 = new Map<string, { count: number; resetAt: number }>();
function 检查限流(token: string): boolean {
  const now = Date.now();
  const 桶 = 查询限流桶.get(token);
  if (!桶 || 桶.resetAt < now) {
    查询限流桶.set(token, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (桶.count >= 60) return false;
  桶.count++;
  return true;
}

interface 结果 {
  success: boolean;
  error?: string;
}

/* ═══════════ 内部：采购员操作 ═══════════ */

/* 生成询价单：勾选待询价配件行 → 建单 + 写供应商名到配件行 */
export async function 生成询价单(参数: {
  partRowIds: string[];
  supplierId: string | null;
  supplierName: string;
}): Promise<结果 & { token?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录" };

  const { partRowIds, supplierId, supplierName } = 参数;
  if (partRowIds.length === 0) return { success: false, error: "未选择配件行" };
  if (!supplierName.trim()) return { success: false, error: "请选择供应商" };

  const supabase = await createClient();

  /* 查配件行（带工单和车型），已结算/已取消工单、已采购/已到货的行不能发询价 */
  const { data: 行列表, error: 查询错误 } = await supabase
    .from("work_order_item_parts")
    .select(`
      id, name, quantity, unit,
      is_purchased, is_arrived,
      work_order_items(
        work_orders(
          settled_at, order_type,
          vehicles(vehicle_model_id)
        )
      )
    `)
    .in("id", partRowIds);

  if (查询错误) return { success: false, error: 查询错误.message };

  interface 配件行 {
    id: string;
    name: string | null;
    quantity: number | null;
    unit: string | null;
    is_purchased: boolean | null;
    is_arrived: boolean | null;
    work_order_items: {
      work_orders: {
        settled_at: string | null;
        order_type: string | null;
        vehicles: { vehicle_model_id: string | null } | null;
      } | null;
    } | null;
  }

  const 有效行 = ((行列表 || []) as unknown as 配件行[]).filter((r) => {
    const wo = r.work_order_items?.work_orders;
    if (!wo || wo.settled_at || wo.order_type === "cancelled") return false;
    if (r.is_purchased || r.is_arrived) return false;
    return true;
  });

  if (有效行.length === 0) return { success: false, error: "选中行都不可询价（已采购/已到货/工单已结算）" };

  /* 车型显示文本 */
  const 车型id列表 = [...new Set(有效行.map((r) => r.work_order_items?.work_orders?.vehicles?.vehicle_model_id).filter(Boolean))] as string[];
  const 车型Map = new Map<string, string>();
  if (车型id列表.length > 0) {
    const { data: 车型数据 } = await supabase
      .from("vehicle_models")
      .select("id, 品牌, 车系, 车型, 年款, 排量")
      .in("id", 车型id列表);
    for (const v of (车型数据 || []) as { id: string; 品牌: string | null; 车系: string | null; 车型: string | null; 年款: string | null; 排量: string | null }[]) {
      车型Map.set(v.id, [v.品牌, v.车系, v.车型, v.年款, v.排量].filter(Boolean).join(" "));
    }
  }

  /* 建单 */
  const token = randomBytes(24).toString("base64url"); // 32 位随机串
  const { data: 新单, error: 建单错误 } = await supabase
    .from("supplier_quote_sheets")
    .insert({
      token,
      supplier_id: supplierId,
      supplier_name: supplierName.trim(),
      status: "open",
      expires_at: new Date(Date.now() + 有效期毫秒).toISOString(),
      created_by: user.id,
    })
    .select("id")
    .single();

  if (建单错误 || !新单) return { success: false, error: 建单错误?.message || "创建询价单失败" };

  const 单id = (新单 as { id: string }).id;
  const { error: 明细错误 } = await supabase.from("supplier_quote_items").insert(
    有效行.map((r) => ({
      sheet_id: 单id,
      work_order_item_part_id: r.id,
      part_name: r.name,
      /* 数量原样快照：NULL 表示工单里就没填，不兜底（用户要求保留"未填"信号） */
      quantity: r.quantity,
      unit: r.unit,
      vehicle_model: 车型Map.get(r.work_order_items?.work_orders?.vehicles?.vehicle_model_id || "") || null,
    }))
  );

  if (明细错误) return { success: false, error: 明细错误.message };

  /* 注意：生成时【不写】配件行的供应商名——否则供应商名已存、采购价还空，
   * 采购员后续编辑这些行会被"供应商和采购价必须同时填"规则拦截。
   * 供应商名只存在询价单上，等供应商提交报价时连同采购价一起回写。 */

  return { success: true, token };
}

/* 询价单列表项（管理页签用） */
export interface 询价单列表项 {
  id: string;
  token: string;
  supplier_name: string;
  status: string;
  expires_at: string;
  created_at: string;
  submitted_at: string | null;
  条目数: number;
  已填价数: number;
}

/* 询价单列表（管理页签用）。服务器时间戳在 Action 里取：
 * 组件渲染期禁调 Date.now()（react-hooks/purity 规则），过期判断要用当前时间 */
export async function 获取询价单列表(): Promise<{
  success: boolean;
  error?: string;
  data?: { 列表: 询价单列表项[]; 服务器时间戳: number };
}> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_quote_sheets")
    .select("id, token, supplier_name, status, expires_at, created_at, submitted_at, supplier_quote_items(id, quoted_price)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { success: false, error: error.message };

  interface 单行 {
    id: string;
    token: string;
    supplier_name: string;
    status: string;
    expires_at: string;
    created_at: string;
    submitted_at: string | null;
    supplier_quote_items: { id: string; quoted_price: number | null }[] | null;
  }

  return {
    success: true,
    data: {
      服务器时间戳: Date.now(),
      列表: ((data || []) as unknown as 单行[]).map((s) => ({
        id: s.id,
        token: s.token,
        supplier_name: s.supplier_name,
        status: s.status,
        expires_at: s.expires_at,
        created_at: s.created_at,
        submitted_at: s.submitted_at,
        条目数: s.supplier_quote_items?.length || 0,
        已填价数: (s.supplier_quote_items || []).filter((i) => i.quoted_price != null && Number(i.quoted_price) > 0).length,
      })),
    },
  };
}

/* 作废询价单（已采用的不能作废） */
export async function 作废询价单(sheetId: string): Promise<结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("supplier_quote_sheets")
    .update({ status: "cancelled" })
    .eq("id", sheetId)
    .neq("status", "adopted");

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* 采用报价：锁死，供应商不能再改 */
export async function 采用询价单(sheetId: string): Promise<结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("supplier_quote_sheets")
    .update({ status: "adopted", adopted_at: new Date().toISOString() })
    .eq("id", sheetId)
    .eq("status", "submitted");

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ═══════════ 公开：供应商操作（凭 token 免登录） ═══════════ */

export interface 询价单公开信息 {
  supplierName: string;
  status: string;
  expiresAt: string;
  submittedAt: string | null;
  items: {
    itemId: string;
    partName: string;
    quantity: number | null;
    unit: string;
    vehicleModel: string;
    quotedPartNumber: string;
    quotedBrand: string;
    quotedSpec: string;
    quotedPrice: string;
    quotedNotes: string;
  }[];
}

/* 校验 token 并返回单（内部共用） */
async function 校验并取单(token: string) {
  if (!token || token.length < 20) return { 错误: "链接无效" as const };
  const admin = createAdminClient();
  const { data: 单 } = await admin
    .from("supplier_quote_sheets")
    .select("id, supplier_name, status, expires_at, submitted_at")
    .eq("token", token)
    .maybeSingle();

  if (!单) return { 错误: "链接无效或已被删除" as const };
  interface 单类型 { id: string; supplier_name: string; status: string; expires_at: string; submitted_at: string | null }
  const s = 单 as unknown as 单类型;
  if (s.status === "cancelled") return { 错误: "该询价单已作废，请联系采购员重新发送" as const };
  if (new Date(s.expires_at).getTime() < Date.now()) return { 错误: "该询价单已过期（3 小时有效），请联系采购员重新发送" as const };
  return { 单: s, admin };
}

/* 供应商打开链接：查单 + 明细 */
export async function 获取询价单公开信息(token: string): Promise<结果 & { data?: 询价单公开信息 }> {
  const 结果0 = await 校验并取单(token);
  if ("错误" in 结果0) return { success: false, error: 结果0.错误 };
  const { 单, admin } = 结果0;

  const { data: 明细 } = await admin
    .from("supplier_quote_items")
    .select("id, part_name, quantity, unit, vehicle_model, quoted_part_number, quoted_brand, quoted_specification, quoted_price, quoted_notes")
    .eq("sheet_id", 单.id)
    .order("created_at", { ascending: true });

  interface 明细行 {
    id: string;
    part_name: string | null;
    quantity: number | null;
    unit: string | null;
    vehicle_model: string | null;
    quoted_part_number: string | null;
    quoted_brand: string | null;
    quoted_specification: string | null;
    quoted_price: number | null;
    quoted_notes: string | null;
  }

  return {
    success: true,
    data: {
      supplierName: 单.supplier_name,
      status: 单.status,
      expiresAt: 单.expires_at,
      submittedAt: 单.submitted_at,
      items: ((明细 || []) as unknown as 明细行[]).map((i) => ({
        itemId: i.id,
        partName: i.part_name || "配件",
        quantity: i.quantity,
        unit: i.unit || "件",
        vehicleModel: i.vehicle_model || "",
        quotedPartNumber: i.quoted_part_number || "",
        quotedBrand: i.quoted_brand || "",
        quotedSpec: i.quoted_specification || "",
        quotedPrice: i.quoted_price != null ? String(i.quoted_price) : "",
        quotedNotes: i.quoted_notes || "",
      })),
    },
  };
}

/* 供应商填编码失焦：查库存配件（只返回名称/品牌/规格/单位，不暴露库存和价格） */
export async function 按编码查配件(token: string, 编码: string): Promise<结果 & {
  data?: { partId: string; name: string; partNumber: string; brand: string; spec: string; unit: string };
}> {
  const 结果0 = await 校验并取单(token);
  if ("错误" in 结果0) return { success: false, error: 结果0.错误 };
  const { 单, admin } = 结果0;

  /* 已采用的单锁死，不需要再查 */
  if (单.status === "adopted") return { success: false, error: "该询价单已采用，不能再修改" };
  if (!检查限流(token)) return { success: false, error: "查询太频繁，请稍后再试" };

  const code = 编码.trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return { success: false, error: "编码为空" };

  const { data } = await admin
    .from("parts")
    .select("id, name, part_number, unit, part_brands(name), part_specifications(name)")
    .or(`part_number.eq.${code},barcode.eq.${code}`)
    .limit(1);

  interface 配件 {
    id: string;
    name: string | null;
    part_number: string | null;
    unit: string | null;
    part_brands: { name: string | null } | null;
    part_specifications: { name: string | null } | null;
  }

  const p = ((data || []) as unknown as 配件[])[0];
  if (!p) return { success: false, error: "未找到该编码" };

  return {
    success: true,
    data: {
      partId: p.id,
      name: p.name || "",
      partNumber: p.part_number || code,
      brand: p.part_brands?.name || "",
      spec: p.part_specifications?.name || "",
      unit: p.unit || "",
    },
  };
}

/* 供应商提交报价：校验 → 写明细 → 回写配件行（采购价+供应商+编码关联）→ 单变已报价 */
export async function 提交报价(token: string, 报价列表: {
  itemId: string;
  partNumber: string;
  brand: string;
  spec: string;
  price: string;
  notes: string;
}[]): Promise<结果> {
  const 结果0 = await 校验并取单(token);
  if ("错误" in 结果0) return { success: false, error: 结果0.错误 };
  const { 单, admin } = 结果0;

  if (单.status === "adopted") return { success: false, error: "该询价单已采用，不能再修改" };

  /* 取本单明细，校验报价属于本单且每行都填了价格（采购价必填） */
  const { data: 明细 } = await admin
    .from("supplier_quote_items")
    .select("id, work_order_item_part_id, part_name")
    .eq("sheet_id", 单.id);

  interface 明细行 { id: string; work_order_item_part_id: string; part_name: string | null }
  const 明细列表 = (明细 || []) as unknown as 明细行[];
  const 明细Map = new Map(明细列表.map((i) => [i.id, i]));

  if (明细列表.length === 0) return { success: false, error: "询价单没有明细" };

  for (const b of 报价列表) {
    const m = 明细Map.get(b.itemId);
    if (!m) return { success: false, error: "报价数据与询价单不匹配，请刷新页面重试" };
    const 价 = Number(b.price);
    if (!Number.isFinite(价) || 价 <= 0) {
      return { success: false, error: `「${m.part_name || "配件"}」还没填采购价，每行都要填` };
    }
    if (价 > 99999999) return { success: false, error: `「${m.part_name || "配件"}」价格异常，请检查` };
  }

  /* 编码统一在服务端匹配（不信客户端传的匹配结果） */
  const 编码列表 = [...new Set(报价列表.map((b) => b.partNumber.trim().toUpperCase()).filter(Boolean))];
  const 编码匹配Map = new Map<string, { id: string; part_number: string | null }>();
  if (编码列表.length > 0) {
    const { data: 配件数据 } = await admin
      .from("parts")
      .select("id, part_number, barcode")
      .or(编码列表.map((c) => `part_number.eq.${c},barcode.eq.${c}`).join(","));
    for (const p of (配件数据 || []) as { id: string; part_number: string | null; barcode: string | null }[]) {
      if (p.part_number) 编码匹配Map.set(p.part_number.toUpperCase(), { id: p.id, part_number: p.part_number });
      if (p.barcode) 编码匹配Map.set(p.barcode.toUpperCase(), { id: p.id, part_number: p.part_number });
    }
  }

  const 现在 = new Date().toISOString();

  /* 1. 更新询价明细 */
  for (const b of 报价列表) {
    const code = b.partNumber.trim().toUpperCase();
    const 匹配 = code ? 编码匹配Map.get(code) : undefined;
    await admin
      .from("supplier_quote_items")
      .update({
        quoted_part_number: code || null,
        quoted_brand: b.brand.trim() || null,
        quoted_specification: b.spec.trim() || null,
        quoted_price: Number(b.price),
        quoted_notes: b.notes.trim() || null,
        matched_part_id: 匹配?.id || null,
        updated_at: 现在,
      })
      .eq("id", b.itemId);
  }

  /* 2. 回写工单配件行：采购价+供应商（+填了的编码/品牌/规格；编码匹配上关联库存件，没匹配上解除关联） */
  for (const b of 报价列表) {
    const m = 明细Map.get(b.itemId)!;
    const code = b.partNumber.trim().toUpperCase();
    const 回写: Record<string, string | number | null> = {
      unit_cost: Number(b.price),
      supplier_name: 单.supplier_name,
    };
    if (code) {
      const 匹配 = 编码匹配Map.get(code);
      回写.part_number = 匹配?.part_number || code;
      回写.part_id = 匹配?.id || null;
    }
    if (b.brand.trim()) 回写.brand = b.brand.trim();
    if (b.spec.trim()) 回写.specification = b.spec.trim();

    await admin
      .from("work_order_item_parts")
      .update(回写)
      .eq("id", m.work_order_item_part_id);
  }

  /* 3. 单状态推进（重复提交只更新时间和内容，状态不变） */
  await admin
    .from("supplier_quote_sheets")
    .update({ status: "submitted", submitted_at: 现在 })
    .eq("id", 单.id);

  return { success: true };
}
