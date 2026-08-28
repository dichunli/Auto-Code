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
import { 行内配件关联, type 行内配件快照 } from "@/app/procurement/actions";

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

export function usePartLinking<T>(配置: PartLinking配置<T>) {
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

  /* ========== 弹窗保存后回写（handlePartSaved） ==========
   * 写库走 Server Action：配件信息在服务端读，主表+副表一次完成 */
  async function handlePartSaved(partId: string) {
    if (!editRow) return;
    配置.setSubmitting(busyKeyOf("edit", 配置.getRowId(editRow)));
    try {
      const result = await 行内配件关联({
        主表: 配置.主表,
        主表行id: 配置.getRowId(editRow),
        副表行id: 配置.getWoiId(editRow),
        双写WOI: 配置.双写WOI,
        写WoiPartId: 配置.写WoiPartId,
        行内unitCost来源: 配置.行内unitCost来源,
        行内写售价: 配置.行内写售价,
        弹窗写supplierPartName: 配置.弹窗写supplierPartName,
        弹窗写WoiDocumentName: 配置.弹窗写WoiDocumentName,
        弹窗规格来源: 配置.弹窗规格来源,
        模式: "弹窗保存",
        partId,
      });
      if (!result.success) throw new Error(result.error || "同步失败");

      closeEditModal();
      配置.reload();
    } catch (err: unknown) {
      const e = err as Error;
      alert("同步配件信息失败: " + (e.message || String(err)));
    } finally {
      配置.setSubmitting(null);
    }
  }

  /* ========== 行内搜索选中配件（handleInlinePartSelect） ==========
   * 写库走 Server Action："为空才填"的当前值在服务端读最新 */
  async function handleInlinePartSelect(row: T, part: 行内配件) {
    const rowId = 配置.getRowId(row);
    配置.setSubmitting(busyKeyOf("inline", rowId));
    try {
      const result = await 行内配件关联({
        主表: 配置.主表,
        主表行id: rowId,
        副表行id: 配置.getWoiId(row),
        双写WOI: 配置.双写WOI,
        写WoiPartId: 配置.写WoiPartId,
        行内unitCost来源: 配置.行内unitCost来源,
        行内写售价: 配置.行内写售价,
        弹窗写supplierPartName: 配置.弹窗写supplierPartName,
        弹窗写WoiDocumentName: 配置.弹窗写WoiDocumentName,
        弹窗规格来源: 配置.弹窗规格来源,
        模式: "行内选中",
        行内配件: part as 行内配件快照,
      });
      if (!result.success) throw new Error(result.error || "更新失败");

      配置.reload();
    } catch (err: unknown) {
      const e = err as Error;
      alert("更新配件信息失败: " + (e.message || String(err)));
    } finally {
      配置.setSubmitting(null);
    }
  }

  /* ========== 行内清除配件关联（handleInlineClear） ==========
   * 写库走 Server Action */
  async function handleInlineClear(row: T) {
    const rowId = 配置.getRowId(row);
    配置.setSubmitting(busyKeyOf("inline", rowId));
    try {
      const result = await 行内配件关联({
        主表: 配置.主表,
        主表行id: rowId,
        副表行id: 配置.getWoiId(row),
        双写WOI: 配置.双写WOI,
        写WoiPartId: 配置.写WoiPartId,
        行内unitCost来源: 配置.行内unitCost来源,
        行内写售价: 配置.行内写售价,
        弹窗写supplierPartName: 配置.弹窗写supplierPartName,
        弹窗写WoiDocumentName: 配置.弹窗写WoiDocumentName,
        弹窗规格来源: 配置.弹窗规格来源,
        模式: "行内清除",
      });
      if (!result.success) throw new Error(result.error || "清除失败");

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
