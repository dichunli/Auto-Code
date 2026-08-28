"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 库存入库 / 新增配件 Server Action ═══
 * 入库涉及库存数量，必须在服务端读取最新库存再更新，
 * 不能用客户端列表里的旧数量（可能已被别人改过）。 */

interface 入库结果 {
  success: boolean;
  error?: string;
  /* 软拦截标记（2026-08-16 双入库防重）：配件在未完成采购单上，
     前端收到后弹确认，用户确认后带 force=true 重发 */
  code?: "PO_IN_FLIGHT";
}

/* ─── 入库登记（现有配件补货 / 新增配件入库，含运单、批次、库存日志） ─── */
export async function 配件入库(参数: {
  newPartMode: boolean;
  selectedPartId: string;
  branchId: string;
  /* 软拦截确认后强制入库（2026-08-16 双入库防重） */
  force?: boolean;
  waybillMode: "none" | "existing" | "new";
  selectedWaybillId: string;
  newWaybill: {
    tracking_no: string;
    logistics_company_id: string;
    freight_amount: string;
    cod_amount: string;
    notes: string;
  };
  form: {
    part_number: string;
    barcode: string;
    part_name_id: string;
    brand_id: string;
    specification_id: string;
    specification_text: string;
    quantity: string;
    unit_cost: string;
    supplier: string;
    batch_no: string;
    notes: string;
  };
}): Promise<入库结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const { newPartMode, selectedPartId, branchId, waybillMode, selectedWaybillId, newWaybill, form } = 参数;
  const supabase = await createClient();

  const qty = parseInt(form.quantity) || 0;
  if (qty <= 0) {
    return { success: false, error: "入库数量必须大于0" };
  }

  /* ── 处理运单 ── */
  let waybillId: string | null = null;

  if (waybillMode === "new" && newWaybill.tracking_no) {
    let 物流公司名称: string | null = null;
    if (newWaybill.logistics_company_id) {
      const { data: company } = await supabase
        .from("logistics_companies")
        .select("name")
        .eq("id", newWaybill.logistics_company_id)
        .single();
      物流公司名称 = company?.name || null;
    }
    const { data: wb, error: wbErr } = await supabase
      .from("logistics_waybills")
      .insert({
        tracking_no: newWaybill.tracking_no,
        logistics_company_id: newWaybill.logistics_company_id || null,
        logistics_company_name: 物流公司名称,
        freight_amount: parseFloat(newWaybill.freight_amount) || 0,
        cod_amount: parseFloat(newWaybill.cod_amount) || 0,
        status: "received",
        received_at: new Date().toISOString(),
        notes: newWaybill.notes || null,
      })
      .select("id")
      .single();
    if (wbErr) return { success: false, error: wbErr.message };
    waybillId = wb.id;
  } else if (waybillMode === "existing" && selectedWaybillId) {
    waybillId = selectedWaybillId;
    await supabase
      .from("logistics_waybills")
      .update({ status: "received", received_at: new Date().toISOString() })
      .eq("id", waybillId);
  }

  const logNotes = `采购入库: ${form.supplier || "未知供应商"}${form.batch_no ? ` (批次: ${form.batch_no})` : ""}${waybillId ? " (关联运单)" : ""}`;

  if (newPartMode) {
    /* ── 新增配件入库 ── */
    if (!form.part_name_id) {
      return { success: false, error: "请选择配件名称" };
    }

    const { data: part, error: partError } = await supabase
      .from("parts")
      .insert({
        part_number: form.part_number,
        barcode: form.barcode || null,
        part_name_id: form.part_name_id,
        brand_id: form.brand_id || null,
        specification_id: form.specification_id || null,
        specification_text: form.specification_text || null,
        quantity: qty,
        unit_cost: parseFloat(form.unit_cost) || 0,
      })
      .select("id")
      .single();

    if (partError || !part) {
      return { success: false, error: partError?.message || "新增配件失败" };
    }

    if (form.batch_no) {
      await supabase.from("part_batches").insert({
        part_id: part.id,
        batch_no: form.batch_no,
        quantity: qty,
        remaining: qty,
        unit_cost: parseFloat(form.unit_cost) || 0,
      });
    }

    await supabase.from("inventory_logs").insert({
      part_id: part.id,
      type: "inbound",
      change_qty: qty,
      before_qty: 0,
      after_qty: qty,
      waybill_id: waybillId,
      notes: logNotes,
    });

    if (branchId) {
      await supabase.from("work_order_item_parts").update({ part_id: part.id }).eq("id", branchId);
    }
  } else {
    /* ── 现有配件补货：服务端读最新库存，不用客户端列表的旧数量 ── */
    if (!selectedPartId) {
      return { success: false, error: "请选择配件" };
    }

    /* 双入库防重（2026-08-16 批次1）：在途采购单上的配件走手工入库，
       之后采购「确认入库」会再加一次库存 → 重复。
       待入库(pending_storage/fully_received)硬拦截：货已到店，必须走确认入库；
       其他未完成状态软拦截：前端确认后带 force 重发（急件另购等正当场景）。 */
    if (!参数.force) {
      const { data: 在途明细 } = await supabase
        .from("purchase_order_items")
        .select("id, purchase_orders!inner(order_no, status)")
        .eq("part_id", selectedPartId)
        .in("purchase_orders.status", [
          "draft",
          "submitted",
          "approved",
          "partial_received",
          "fully_received",
          "pending_storage",
        ])
        .limit(20);
      interface 在途行 {
        id: string;
        purchase_orders: { order_no: string | null; status: string | null };
      }
      const 在途 = (在途明细 || []) as unknown as 在途行[];
      if (在途.length > 0) {
        const 待入库单 = 在途.find((r) =>
          ["pending_storage", "fully_received"].includes(r.purchase_orders.status || "")
        );
        if (待入库单) {
          return {
            success: false,
            error: `该配件在采购单「${待入库单.purchase_orders.order_no || "未知单号"}」中等待入库，请到采购管理「待入库」页走确认入库，避免库存重复`,
          };
        }
        const 单号列表 = 在途.map((r) => r.purchase_orders.order_no || "未知单号").join("、");
        return {
          success: false,
          code: "PO_IN_FLIGHT",
          error: `该配件在未完成采购单（${单号列表}）上。如果这是另一批货需要单独入库，请确认后继续。`,
        };
      }
    }

    const { data: 当前配件, error: 查询错误 } = await supabase
      .from("parts")
      .select("id, quantity")
      .eq("id", selectedPartId)
      .single();

    if (查询错误 || !当前配件) {
      return { success: false, error: "配件不存在" };
    }

    const beforeQty = 当前配件.quantity || 0;
    const afterQty = beforeQty + qty;

    const { error: updateError } = await supabase
      .from("parts")
      .update({ quantity: afterQty })
      .eq("id", selectedPartId);

    if (updateError) return { success: false, error: updateError.message };

    if (form.batch_no) {
      await supabase.from("part_batches").insert({
        part_id: selectedPartId,
        batch_no: form.batch_no,
        quantity: qty,
        remaining: qty,
        unit_cost: parseFloat(form.unit_cost) || 0,
      });
    }

    await supabase.from("inventory_logs").insert({
      part_id: selectedPartId,
      type: "inbound",
      change_qty: qty,
      before_qty: beforeQty,
      after_qty: afterQty,
      waybill_id: waybillId,
      notes: logNotes,
    });

    if (branchId) {
      await supabase.from("work_order_item_parts").update({ part_id: selectedPartId }).eq("id", branchId);
    }
  }

  revalidatePath("/inventory");
  return { success: true };
}

/* ─── 新增配件（库存管理的新建配件页） ─── */
export async function 新增配件(参数: {
  part_number: string;
  barcode: string;
  part_name_id: string;
  brand_id: string;
  specification_id: string;
  specification_text: string;
  quantity: string;
  min_stock: string;
  unit_cost: string;
  unit_price: string;
  location: string;
  notes: string;
}): Promise<入库结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const form = 参数;
  if (!form.part_name_id) {
    return { success: false, error: "请选择配件名称" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("parts").insert({
    part_number: form.part_number,
    barcode: form.barcode || null,
    part_name_id: form.part_name_id,
    brand_id: form.brand_id || null,
    specification_id: form.specification_id || null,
    specification_text: form.specification_text || null,
    quantity: parseInt(form.quantity) || 0,
    min_stock: parseInt(form.min_stock) || 10,
    unit_cost: parseFloat(form.unit_cost) || 0,
    unit_price: parseFloat(form.unit_price) || 0,
    location: form.location || null,
    notes: form.notes || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/inventory");
  return { success: true };
}

/* ─── 现场新建品牌 / 规格（入库页和新建配件页共用） ─── */
export async function 新建配件品牌(name: string): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!name.trim()) {
    return { success: false, error: "品牌名称不能为空" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("part_brands")
    .insert({ name: name.trim() })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || "创建失败" };
  }
  return { success: true, id: data.id };
}

export async function 新建配件规格(name: string): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!name.trim()) {
    return { success: false, error: "规格名称不能为空" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("part_specifications")
    .insert({ name: name.trim() })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || "创建失败" };
  }
  return { success: true, id: data.id };
}

/* ═══ 采购退库（涉库存，走原子事务 RPC） ═══
 * 原来是客户端"扣批次→扣总库存→建退货单→记日志"四步连写，
 * 中途失败库存就乱。收编为 create_purchase_return RPC 一个事务，
 * 批次/库存在服务端加锁读最新值再原子扣减。 */
export async function 新建采购退货(参数: {
  partId: string;
  batchId: string;
  quantity: number;
  reason: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data: result, error: rpcError } = await supabase.rpc("create_purchase_return", {
    p_part_id: 参数.partId,
    p_batch_id: 参数.batchId,
    p_quantity: 参数.quantity,
    p_reason: 参数.reason,
  });

  if (rpcError) return { success: false, error: rpcError.message };
  const rpcResult = result as { success: boolean; error?: string };
  if (!rpcResult?.success) {
    return { success: false, error: rpcResult?.error || "保存失败" };
  }

  revalidatePath("/inventory/returns");
  revalidatePath("/inventory");
  return { success: true };
}

/* ═══ Excel 批量导入配件 Server Action ═══
 * 导入的写库阶段（建缺失名称/品牌/规格 → 分批插配件 → 建规格关联）收口到服务端。
 * 解析 Excel、编号查重等只读步骤仍留在客户端。 */
export async function 批量导入配件(参数: {
  /* 客户端比对后确认缺失、需要新建的名称 */
  newPartNames: string[];
  newBrands: string[];
  newSpecs: string[];
  records: {
    name: string;
    part_number: string;
    oe_number: string | null;
    /* 已是 UUID 或名称字符串（服务端再解析成 UUID） */
    part_name_id: string | null;
    category_id: string | null;
    brand_name: string | null;
    spec_name: string | null;
    unit: string;
    quantity: number;
    min_stock: number;
    unit_cost: number | null;
    unit_price: number | null;
    supplier_id: string | null;
    location: string | null;
    notes: string | null;
  }[];
}): Promise<{ success: boolean; inserted?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  interface NamedRow {
    id: string;
    name: string;
  }

  /* 服务端自建名称→ID 映射（与客户端查询口径一致，不信任客户端传入的映射） */
  const [
    { data: partNames },
    { data: brands },
    { data: specs },
  ] = await Promise.all([
    supabase.from("part_names").select("id, name").limit(100),
    supabase.from("part_brands").select("id, name").limit(100),
    supabase.from("part_specifications").select("id, name").limit(100),
  ]);

  const partNameMap = new Map((partNames || []).map((p: NamedRow) => [p.name, p.id]));
  const brandMap = new Map((brands || []).map((b: NamedRow) => [b.name, b.id]));
  const specMap = new Map((specs || []).map((s: NamedRow) => [s.name, s.id]));

  /* 创建缺失的配件名称 */
  if (参数.newPartNames.length > 0) {
    const { data: insertedNames, error: nameErr } = await supabase
      .from("part_names")
      .insert(参数.newPartNames.map((name) => ({ name })))
      .select("id, name");
    if (nameErr) {
      return { success: false, error: "创建配件名称失败: " + nameErr.message };
    }
    (insertedNames || []).forEach((p: NamedRow) => partNameMap.set(p.name, p.id));
  }

  /* 创建缺失的品牌 */
  if (参数.newBrands.length > 0) {
    const { data: insertedBrands, error: brandErr } = await supabase
      .from("part_brands")
      .insert(参数.newBrands.map((name) => ({ name })))
      .select("id, name");
    if (brandErr) {
      return { success: false, error: "创建品牌失败: " + brandErr.message };
    }
    (insertedBrands || []).forEach((b: NamedRow) => brandMap.set(b.name, b.id));
  }

  /* 创建缺失的规格 */
  if (参数.newSpecs.length > 0) {
    const { data: insertedSpecs, error: specErr } = await supabase
      .from("part_specifications")
      .insert(参数.newSpecs.map((name) => ({ name })))
      .select("id, name");
    if (specErr) {
      return { success: false, error: "创建规格失败: " + specErr.message };
    }
    (insertedSpecs || []).forEach((s: NamedRow) => specMap.set(s.name, s.id));
  }

  /* 构建最终插入数据 */
  interface InsertPartData {
    name: string;
    part_number: string;
    oe_number: string | null;
    part_name_id: string | undefined;
    category_id: string | null;
    unit: string;
    quantity: number;
    min_stock: number;
    unit_cost: number | null;
    unit_price: number | null;
    supplier_id: string | null;
    location: string | null;
    notes: string | null;
    brand_id?: string | null;
  }

  const insertData: InsertPartData[] = 参数.records.map((r) => {
    const data: InsertPartData = {
      name: r.name,
      part_number: r.part_number,
      oe_number: r.oe_number,
      part_name_id: typeof r.part_name_id === "string" && r.part_name_id.length === 36
        ? r.part_name_id
        : partNameMap.get(r.part_name_id as string),
      category_id: r.category_id,
      unit: r.unit,
      quantity: r.quantity,
      min_stock: r.min_stock,
      unit_cost: r.unit_cost,
      unit_price: r.unit_price,
      supplier_id: r.supplier_id,
      location: r.location,
      notes: r.notes,
    };
    if (r.brand_name) {
      data.brand_id = brandMap.get(r.brand_name) || null;
    }
    return data;
  });

  /* 分批插入配件 */
  const batchSize = 50;
  let inserted = 0;
  const insertedPartIds: string[] = [];

  for (let i = 0; i < insertData.length; i += batchSize) {
    const batch = insertData.slice(i, i + batchSize);
    const { data: insertedParts, error } = await supabase
      .from("parts")
      .insert(batch)
      .select("id");
    if (error) {
      return { success: false, error: `第 ${i + 1} 批导入失败: ${error.message}` };
    }
    (insertedParts || []).forEach((p: { id: string }) => insertedPartIds.push(p.id));
    inserted += batch.length;
  }

  /* 创建规格关联 */
  const specLinks = 参数.records
    .filter((r, idx) => r.spec_name && insertedPartIds[idx])
    .map((r, idx) => ({
      part_id: insertedPartIds[idx],
      specification_id: specMap.get(r.spec_name as string),
    }))
    .filter((l): l is { part_id: string; specification_id: string } => !!l.specification_id);

  if (specLinks.length > 0) {
    await supabase.from("parts_specifications").insert(specLinks);
  }

  revalidatePath("/inventory");
  return { success: true, inserted };
}
