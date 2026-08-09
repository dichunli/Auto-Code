"use client";

/* ============================================================
 * usePartLinking — 待办列表「行内配件编辑」共享逻辑
 *
 * 背景：收货/入库/退货/采购 4 个列表各有约 200 行近乎复制粘贴的
 * 八件套（编辑弹窗 + 行内搜索选中/清除/新建），字段级差异见对照表：
 *   - 收货/入库：主表 purchase_order_items + 双写 work_order_item_parts（不写 part_id，有意保持）
 *   - 退货：仅写 work_order_item_parts，行内 unit_cost 来源是 purchase_price（字段错位，保持现状）
 *   - 采购：仅写 work_order_item_parts，行内补 unit_price，规格走 join 名
 * 同时修复了两个历史缺陷：
 *   1. 行内选中时 category 读错对象路径（原读 part.part_categories，实际在
 *      part_names.part_categories 里）导致分类永远写不进去 → 改为正确路径
 *   2. 行内点「新建配件」时用户输入的查询词被 openEditModal 清空 →
 *      新建走独立入口 openCreateNewModal，保留查询词预填
 * ============================================================ */

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/* 行内下拉选中的配件（PartSearchDropdown 的 MatchedPart 结构） */
export interface 行内配件 {
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

/* WOI 行当前值（"为空才填"判断用） */
interface WOI当前值 {
  name?: string | null;
  unit?: string | null;
  brand?: string | null;
  specification?: string | null;
  unit_cost?: number | null;
  unit_price?: number | null;
}

/* 弹窗预填所需的最小行视图（各组件用自己的 accessor 提供） */
export interface 弹前行视图 {
  part_id?: string | null;
  part_number?: string | null;
  name?: string | null;
  unit?: string | null;
  brand?: string | null;
  specification?: string | null;
  unit_cost?: number | null;
  unit_price?: number | null;
  notes?: string | null;
  supplier_part_name?: string | null;
}

export interface PartLinking配置<T> {
  supabase: SupabaseClient;
  /* 主表：收货/入库=purchase_order_items（双写 WOI 副表）；退货/采购=work_order_item_parts（单表） */
  主表: "purchase_order_items" | "work_order_item_parts";
  双写WOI: boolean;
  getRowId: (row: T) => string;
  getWoiId: (row: T) => string | null;
  /* 收货/入库需要 pre-query WOI 当前值；退货/采购直接从行上读（包成函数返回即可） */
  getWoi当前值: (row: T) => Promise<WOI当前值 | null> | WOI当前值 | null;
  /* 缺陷 3 保持现状：收货/入库=false（不回写 WOI.part_id），退货/采购=true */
  写WoiPartId: boolean;
  /* 行内 unit_cost 来源：退货="purchase_price"（字段错位保持），其余="unit_cost" */
  行内unitCost来源: "unit_cost" | "purchase_price";
  行内写售价: boolean;
  /* 弹窗保存时 POI.supplier_part_name ← parts.document_name（收货/入库=true） */
  弹窗写supplierPartName: boolean;
  /* 弹窗保存时 WOI.document_name ← parts.document_name（退货=false） */
  弹窗写WoiDocumentName: boolean;
  /* 弹窗保存规格来源：采购="join"，其余="specification_text" */
  弹窗规格来源: "specification_text" | "join";
  /* 弹窗预填取值器（退货从 row.work_order_item_parts 取，采购/收货/入库从行本身取） */
  取弹前行: (row: T) => 弹前行视图;
  setSubmitting: (key: string | null) => void;
  reload: () => void;
}

/* 关联数组/单对象两种 join 返回形态的名字 */
function 取join名(v: { name?: string | null }[] | { name?: string | null } | null | undefined): string | null {
  const name = Array.isArray(v) ? v[0]?.name : v?.name;
  return name ?? null;
}

export function usePartLinking<T>(配置: PartLinking配置<T>) {
  const { supabase } = 配置;
  const [editRow, setEditRow] = useState<T | null>(null);
  const [newPartQuery, setNewPartQuery] = useState("");

  const busyKeyOf = (kind: "edit" | "inline", id: string) => `${kind}-${id}`;

  function openEditModal(row: T) {
    setNewPartQuery("");
    setEditRow(row);
  }

  /* 行内「新建配件」入口：保留用户已输入的查询词（修历史缺陷：原 openEditModal 会清空） */
  function openCreateNewModal(row: T, query: string) {
    setNewPartQuery(query);
    setEditRow(row);
  }

  function closeEditModal() {
    setNewPartQuery("");
    setEditRow(null);
  }

  /* ========== 弹窗保存后回写（handlePartSaved） ========== */
  async function handlePartSaved(partId: string) {
    if (!editRow) return;
    配置.setSubmitting(busyKeyOf("edit", 配置.getRowId(editRow)));
    try {
      const { data: part } = await supabase
        .from("parts")
        .select("part_number, name, unit, category_id, part_categories(name), brand_id, part_brands(name), specification_text, specification_id, part_specifications(name), purchase_price, notes, document_name")
        .eq("id", partId)
        .single();

      const p = (part || {}) as Record<string, unknown>;
      const brandName = 取join名(p.part_brands as { name?: string }[] | { name?: string } | null | undefined);

      /* ----- 主表写入 ----- */
      const 主表Updates: Record<string, unknown> = { part_id: partId };
      if (p.part_number != null) 主表Updates.part_number = p.part_number;
      if (p.name != null) 主表Updates.name = p.name;
      if (p.unit != null) 主表Updates.unit = p.unit;
      if (p.brand_id != null) 主表Updates.brand = brandName;
      if (p.purchase_price != null) 主表Updates.unit_cost = p.purchase_price;
      if (p.notes != null) 主表Updates.notes = p.notes;

      if (配置.主表 === "purchase_order_items") {
        /* POI 专属字段：分类 join 名 + 规格文本 + 单据名（配置） */
        const catName = 取join名(p.part_categories as { name?: string }[] | { name?: string } | null | undefined);
        if (catName != null) 主表Updates.category = catName;
        if (p.specification_text != null) 主表Updates.specification = p.specification_text;
        if (配置.弹窗写supplierPartName && p.document_name != null) {
          主表Updates.supplier_part_name = p.document_name;
        }
      } else {
        /* WOI 主表字段：规格按配置来源 + 单据名（配置） */
        if (配置.弹窗规格来源 === "join") {
          const specName = 取join名(p.part_specifications as { name?: string }[] | { name?: string } | null | undefined);
          if (specName != null) 主表Updates.specification = specName;
        } else if (p.specification_text != null) {
          主表Updates.specification = p.specification_text;
        }
        if (配置.弹窗写WoiDocumentName && p.document_name != null) {
          主表Updates.document_name = p.document_name;
        }
      }

      const { error: 主表Err } = await supabase
        .from(配置.主表)
        .update(主表Updates)
        .eq("id", 配置.getRowId(editRow));
      if (主表Err) throw 主表Err;

      /* ----- 双写 WOI 副表（收货/入库，且行有关联 WOI 时） ----- */
      if (配置.双写WOI) {
        const woiId = 配置.getWoiId(editRow);
        if (woiId) {
          const woiUpdates: Record<string, unknown> = {};
          /* 缺陷 3 保持：副表不写 part_id（配置.写WoiPartId 此时为 false） */
          if (配置.写WoiPartId) woiUpdates.part_id = partId;
          if (p.part_number != null) woiUpdates.part_number = p.part_number;
          if (p.name != null) woiUpdates.name = p.name;
          if (p.unit != null) woiUpdates.unit = p.unit;
          if (p.brand_id != null) woiUpdates.brand = brandName;
          if (p.specification_text != null) woiUpdates.specification = p.specification_text;
          if (p.purchase_price != null) woiUpdates.unit_cost = p.purchase_price;
          if (p.notes != null) woiUpdates.notes = p.notes;
          if (配置.弹窗写WoiDocumentName && p.document_name != null) {
            woiUpdates.document_name = p.document_name;
          }
          if (Object.keys(woiUpdates).length > 0) {
            const { error: woiErr } = await supabase
              .from("work_order_item_parts")
              .update(woiUpdates)
              .eq("id", woiId);
            if (woiErr) console.warn("同步工单配件信息失败:", woiErr);
          }
        }
      }

      closeEditModal();
      配置.reload();
    } catch (err: unknown) {
      const e = err as Error;
      alert("同步配件信息失败: " + (e.message || String(err)));
    } finally {
      配置.setSubmitting(null);
    }
  }

  /* ========== 行内搜索选中配件（handleInlinePartSelect） ========== */
  async function handleInlinePartSelect(row: T, part: 行内配件) {
    const rowId = 配置.getRowId(row);
    配置.setSubmitting(busyKeyOf("inline", rowId));
    try {
      const 行视图 = 配置.取弹前行(row);

      /* ----- 主表写入：part_id 无条件、part_number 无条件+barcode 兜底、其余"为空才填" ----- */
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

      if (配置.主表 === "purchase_order_items") {
        /* POI 专属：分类（修历史缺陷：原读错路径，正确路径在 part_names 里） */
        const poi行 = row as { category?: string | null };
        if (!poi行.category) {
          const catName = part.part_names?.part_categories?.name;
          if (catName != null) 主表Updates.category = catName;
        }
      }

      /* 主表为 WOI（退货/采购）时，价格/part_id 也在主表写 */
      if (配置.主表 === "work_order_item_parts") {
        if (配置.写WoiPartId) 主表Updates.part_id = part.id;
        const 行woi = 行视图 as WOI当前值;
        const cost来源 = 配置.行内unitCost来源 === "purchase_price" ? part.purchase_price : part.unit_cost;
        if ((行woi.unit_cost == null || 行woi.unit_cost === 0) && cost来源 != null) {
          主表Updates.unit_cost = cost来源;
        }
        if (配置.行内写售价 && 行woi.unit_price == null && part.unit_price != null) {
          主表Updates.unit_price = part.unit_price;
        }
      }

      const { error: 主表Err } = await supabase
        .from(配置.主表)
        .update(主表Updates)
        .eq("id", rowId);
      if (主表Err) throw 主表Err;

      /* ----- 双写 WOI 副表（收货/入库）：先取当前值再按"为空才填" ----- */
      if (配置.双写WOI) {
        const woiId = 配置.getWoiId(row);
        if (woiId) {
          const woiCurrent = (await 配置.getWoi当前值(row)) || {};
          const woiUpdates: Record<string, unknown> = {};
          if (part.part_number != null) woiUpdates.part_number = part.part_number;
          if (!woiCurrent.name && part.name != null) woiUpdates.name = part.name;
          if (!woiCurrent.unit && part.unit != null) woiUpdates.unit = part.unit;
          if (!woiCurrent.brand && part.part_brands?.name != null) woiUpdates.brand = part.part_brands.name;
          if (!woiCurrent.specification && part.part_specifications?.name != null) woiUpdates.specification = part.part_specifications.name;

          const cost来源 = 配置.行内unitCost来源 === "purchase_price" ? part.purchase_price : part.unit_cost;
          if ((woiCurrent.unit_cost == null || woiCurrent.unit_cost === 0) && cost来源 != null) {
            woiUpdates.unit_cost = cost来源;
          }
          if (配置.行内写售价 && woiCurrent.unit_price == null && part.unit_price != null) {
            woiUpdates.unit_price = part.unit_price;
          }

          if (Object.keys(woiUpdates).length > 0) {
            const { error: woiErr } = await supabase
              .from("work_order_item_parts")
              .update(woiUpdates)
              .eq("id", woiId);
            if (woiErr) console.warn("同步工单配件信息失败:", woiErr);
          }
        }
      }

      配置.reload();
    } catch (err: unknown) {
      const e = err as Error;
      alert("更新配件信息失败: " + (e.message || String(err)));
    } finally {
      配置.setSubmitting(null);
    }
  }

  /* ========== 行内清除配件关联（handleInlineClear） ========== */
  async function handleInlineClear(row: T) {
    const rowId = 配置.getRowId(row);
    配置.setSubmitting(busyKeyOf("inline", rowId));
    try {
      const { error: 主表Err } = await supabase
        .from(配置.主表)
        .update({ part_id: null, part_number: null })
        .eq("id", rowId);
      if (主表Err) throw 主表Err;

      if (配置.双写WOI) {
        const woiId = 配置.getWoiId(row);
        if (woiId) {
          const { error: woiErr } = await supabase
            .from("work_order_item_parts")
            .update({ part_id: null, part_number: null })
            .eq("id", woiId);
          if (woiErr) console.warn("同步清除工单配件信息失败:", woiErr);
        }
      }

      配置.reload();
    } catch (err: unknown) {
      const e = err as Error;
      alert("清除配件关联失败: " + (e.message || String(err)));
    } finally {
      配置.setSubmitting(null);
    }
  }

  /* ========== 弹窗预填数据（purchase_price 非空才传，与原逻辑一致） ========== */
  const 弹前行 = editRow ? 配置.取弹前行(editRow) : null;
  const prefillData = 弹前行
    ? {
        part_number: newPartQuery || 弹前行.part_number || "",
        name: 弹前行.name || "",
        unit: 弹前行.unit || "",
        ...(弹前行.unit_cost != null ? { purchase_price: String(弹前行.unit_cost) } : {}),
        notes: 弹前行.notes || "",
        ...(配置.弹窗写supplierPartName ? { document_name: 弹前行.supplier_part_name || "" } : {}),
      }
    : undefined;

  return {
    editRow,
    newPartQuery,
    editModalOpen: editRow !== null,
    editId: 弹前行?.part_id || undefined,
    prefillData,
    busyKeyOf,
    openEditModal,
    openCreateNewModal,
    closeEditModal,
    handlePartSaved,
    handleInlinePartSelect,
    handleInlineClear,
  };
}
