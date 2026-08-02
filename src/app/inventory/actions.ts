"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 库存入库 / 新增配件 Server Action ═══
 * 入库涉及库存数量，必须在服务端读取最新库存再更新，
 * 不能用客户端列表里的旧数量（可能已被别人改过）。 */

interface 入库结果 {
  success: boolean;
  error?: string;
}

/* ─── 入库登记（现有配件补货 / 新增配件入库，含运单、批次、库存日志） ─── */
export async function 配件入库(参数: {
  newPartMode: boolean;
  selectedPartId: string;
  branchId: string;
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
