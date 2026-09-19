import { SupabaseClient } from "@supabase/supabase-js";
import { LinkedItem } from "@/components/VehicleModelSelector";
import { StockLocationRow } from "./components/StockLocationSection";
import { SpecialPriceItem, VehicleModelPriceItem } from "./components/SpecialPricingSection";
import { PartNameItem } from "./components/PartNameSearch";

export interface SubmitPartFormData {
  name: string;
  unit: string;
  min_stock: string;
  purchase_price: string;
  reference_purchase_price: string;
  unit_price: string;
  standard_price: string;
  vip_price: string;
  wholesale_price: string;
  notes: string;
  auto_link_vehicle_model: boolean;
  auto_match_17vin_models: boolean;
  is_consumable: boolean;
  require_scan_check: boolean;
  require_location_check: boolean;
  /* 出库需库管确认（含该配件的领料单整单待确认，库管确认后才扣库存） */
  require_confirm: boolean;
  sales_type: string;
  sales_value: string;
  diagnosis_type: string;
  diagnosis_value: string;
  repair_type: string;
  repair_value: string;
  qc_type: string;
  qc_value: string;
  picking_type: string;
  picking_value: string;
}

export interface SubmitPartParams {
  supabase: SupabaseClient;
  isEditMode: boolean;
  editId?: string;
  systemCode: string;
  partNumber: string;
  barcode: string;
  interchangeCode: string;
  oeNumber: string;
  vin17GroupId: string;
  documentName: string | null;
  partNameId: string;
  partName: string;
  partCategories: PartNameItem["part_categories"];
  brandId: string | null;
  form: SubmitPartFormData;
  stockLocations: StockLocationRow[];
  selectedSpecs: LinkedItem[];
  selectedVehicleModels: LinkedItem[];
  partImages: string[];
  specialPrices: SpecialPriceItem[];
  vehicleModelPrices: VehicleModelPriceItem[];
  supplierId: string | null;
}

export interface SubmitPartResult {
  success: boolean;
  partId?: string;
  finalSystemCode?: string;
  error?: string;
}

/* ═══ 保存配件（新建/编辑）═══
 * 全部写库收敛为 save_part_form 一次 RPC 调用（一个事务，失败整体回滚）：
 * - 不再客户端"更新→删5表→逐表插"多步散写（中途失败留半账）
 * - 编辑不再用"表单仓位行之和"覆盖 parts.quantity（并发领料曾被静默抹掉），
 *   改由 RPC 按差额调整并逐笔记 adjust 流水
 * - 新建的初始库存由 RPC 建期初批次（批次必建，期初可领） */
export default async function submitPart(params: SubmitPartParams): Promise<SubmitPartResult> {
  const {
    supabase,
    isEditMode,
    editId,
    systemCode,
    partNumber,
    barcode,
    interchangeCode,
    oeNumber,
    vin17GroupId,
    documentName,
    partNameId,
    partName,
    partCategories,
    brandId,
    form,
    stockLocations,
    selectedSpecs,
    selectedVehicleModels,
    partImages,
    specialPrices,
    vehicleModelPrices,
    supplierId,
  } = params;

  const categoryId = (Array.isArray(partCategories) ? partCategories[0]?.id : partCategories?.id) || null;

  /* 仓位行过滤：至少一项有值才提交（与原 validLocations 口径一致） */
  const validLocations = stockLocations.filter(
    (row) => row.warehouseName.trim() || row.location.trim() || parseInt(row.quantity) > 0
  );

  const { data: rpc结果, error: rpc错误 } = await supabase.rpc("save_part_form", {
    p_part_id: isEditMode && editId ? editId : null,
    p_part: {
      system_code: systemCode,
      part_number: partNumber,
      barcode,
      interchange_code: interchangeCode,
      oe_number: oeNumber,
      vin17_group_id: vin17GroupId,
      document_name: documentName,
      part_name_id: partNameId,
      name: partName,
      brand_id: brandId,
      category_id: categoryId,
      unit: form.unit || "件",
      min_stock: form.min_stock,
      purchase_price: form.purchase_price,
      reference_purchase_price: form.reference_purchase_price,
      unit_price: form.unit_price,
      standard_price: form.standard_price,
      vip_price: form.vip_price,
      wholesale_price: form.wholesale_price,
      supplier_id: supplierId,
      notes: form.notes,
      auto_link_vehicle_model: form.auto_link_vehicle_model,
      auto_match_17vin_models: form.auto_match_17vin_models,
      is_consumable: form.is_consumable,
      require_scan_check: form.require_scan_check,
      require_location_check: form.require_location_check,
      require_confirm: form.require_confirm,
      sales_commission_type: form.sales_type,
      sales_commission_value: form.sales_value,
      diagnosis_commission_type: form.diagnosis_type,
      diagnosis_commission_value: form.diagnosis_value,
      repair_commission_type: form.repair_type,
      repair_commission_value: form.repair_value,
      qc_commission_type: form.qc_type,
      qc_commission_value: form.qc_value,
      picking_commission_type: form.picking_type,
      picking_commission_value: form.picking_value,
    },
    p_specs: selectedSpecs.map((s) => s.id),
    p_vehicle_models: selectedVehicleModels.map((v) => ({
      vehicle_model_id: Number(v.id),
      notes: v.notes || null,
      fitment_position: v.fitment_position || null,
      source: v.source || "manual",
    })),
    p_images: partImages,
    p_stock_locations: validLocations.map((row) => ({
      warehouse_name: row.warehouseName.trim(),
      location: row.location.trim(),
      quantity: parseInt(row.quantity) || 0,
      min_stock: parseInt(row.min_stock) || 0,
      max_stock: row.max_stock ? parseInt(row.max_stock) : null,
    })),
    p_special_prices: specialPrices.map((p) => ({
      company_id: p.company_id || null,
      customer_id: p.customer_id || null,
      vehicle_id: p.vehicle_id || null,
      price: parseFloat(p.price),
    })),
    p_vehicle_prices: vehicleModelPrices.map((p) => ({
      vehicle_model_id: Number(p.vehicle_model_id),
      sales_price: p.sales_price ? parseFloat(p.sales_price) : null,
      vip_price: p.vip_price ? parseFloat(p.vip_price) : null,
      standard_price: p.standard_price ? parseFloat(p.standard_price) : null,
    })),
  });

  if (rpc错误) {
    return { success: false, error: "保存失败: " + rpc错误.message };
  }
  const 结果 = rpc结果 as { success: boolean; part_id?: string; system_code?: string; error?: string } | null;
  if (!结果?.success) {
    return { success: false, error: "保存失败: " + (结果?.error || "未知错误") };
  }

  return { success: true, partId: 结果.part_id, finalSystemCode: 结果.system_code };
}
