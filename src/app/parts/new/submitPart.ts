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

  let partId = editId;
  let finalSystemCode = systemCode;

  const basePayload = {
    part_number: partNumber.trim().toUpperCase(),
    barcode: barcode.trim() || null,
    interchange_code: interchangeCode.trim().toUpperCase() || null,
    oe_number: oeNumber.trim().toUpperCase() || null,
    vin17_group_id: vin17GroupId.trim() || null,
    document_name: documentName,
    part_name_id: partNameId,
    name: partName.trim(),
    brand_id: brandId,
    category_id: categoryId,
    unit: form.unit || "件",
    quantity: stockLocations.reduce((sum, row) => sum + (parseInt(row.quantity) || 0), 0),
    min_stock: parseInt(form.min_stock) || 10,
    purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
    reference_purchase_price: form.reference_purchase_price ? parseFloat(form.reference_purchase_price) : null,
    unit_price: form.unit_price ? parseFloat(form.unit_price) : null,
    standard_price: form.standard_price ? parseFloat(form.standard_price) : null,
    vip_price: form.vip_price ? parseFloat(form.vip_price) : null,
    wholesale_price: form.wholesale_price ? parseFloat(form.wholesale_price) : null,
    supplier_id: supplierId,
    notes: form.notes || null,
    auto_link_vehicle_model: form.auto_link_vehicle_model,
    auto_match_17vin_models: form.auto_match_17vin_models,
    is_consumable: form.is_consumable,
    require_scan_check: form.require_scan_check,
    require_location_check: form.require_location_check,
    sales_commission_type: form.sales_type || null,
    sales_commission_value: form.sales_value ? parseFloat(form.sales_value) : null,
    diagnosis_commission_type: form.diagnosis_type || null,
    diagnosis_commission_value: form.diagnosis_value ? parseFloat(form.diagnosis_value) : null,
    repair_commission_type: form.repair_type || null,
    repair_commission_value: form.repair_value ? parseFloat(form.repair_value) : null,
    qc_commission_type: form.qc_type || null,
    qc_commission_value: form.qc_value ? parseFloat(form.qc_value) : null,
    picking_commission_type: form.picking_type || null,
    picking_commission_value: form.picking_value ? parseFloat(form.picking_value) : null,
  };

  if (isEditMode && editId) {
    const { error: updateError } = await supabase
      .from("parts")
      .update(basePayload)
      .eq("id", editId);

    if (updateError) {
      return { success: false, error: "保存失败: " + updateError.message };
    }

    await supabase.from("parts_specifications").delete().eq("part_id", editId);
    await supabase.from("part_vehicle_models").delete().eq("part_id", editId);
    await supabase.from("part_images").delete().eq("part_id", editId);
    await supabase.from("part_stock_locations").delete().eq("part_id", editId);
    await supabase.from("part_special_prices").delete().eq("part_id", editId);
    await supabase.from("part_vehicle_prices").delete().eq("part_id", editId);
  } else {
    if (!finalSystemCode) {
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const prefix = `PJ${dateStr}`;
      const { data: existing } = await supabase
        .from("parts")
        .select("system_code")
        .ilike("system_code", `${prefix}%`)
        .order("system_code", { ascending: false })
        .limit(1);
      let seq = 1;
      if (existing && existing.length > 0 && existing[0].system_code) {
        const suffix = existing[0].system_code.slice(prefix.length);
        const num = parseInt(suffix, 10);
        if (!isNaN(num)) seq = num + 1;
      }
      finalSystemCode = `${prefix}${String(seq).padStart(3, "0")}`;
    } else {
      const { data: dup } = await supabase
        .from("parts")
        .select("id")
        .eq("system_code", finalSystemCode)
        .single();
      if (dup) {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const prefix = `PJ${dateStr}`;
        const { data: existing } = await supabase
          .from("parts")
          .select("system_code")
          .ilike("system_code", `${prefix}%`)
          .order("system_code", { ascending: false })
          .limit(1);
        let seq = 1;
        if (existing && existing.length > 0 && existing[0].system_code) {
          const suffix = existing[0].system_code.slice(prefix.length);
          const num = parseInt(suffix, 10);
          if (!isNaN(num)) seq = num + 1;
        }
        finalSystemCode = `${prefix}${String(seq).padStart(3, "0")}`;
      }
    }

    const { data: inserted, error } = await supabase
      .from("parts")
      .insert({ system_code: finalSystemCode, ...basePayload })
      .select("id")
      .single();

    if (error || !inserted) {
      return { success: false, error: "保存失败: " + (error?.message || "未知错误") };
    }

    partId = inserted.id;
  }

  if (!partId) {
    return { success: false, error: "保存失败: 未获取到配件ID" };
  }

  // Insert specifications
  if (selectedSpecs.length > 0) {
    await supabase
      .from("parts_specifications")
      .insert(selectedSpecs.map((s) => ({ part_id: partId, specification_id: s.id })));
  }

  // Insert vehicle models
  if (selectedVehicleModels.length > 0) {
    const { error: vmError } = await supabase
      .from("part_vehicle_models")
      .insert(selectedVehicleModels.map((v) => ({
        part_id: partId,
        vehicle_model_id: Number(v.id),
        notes: v.notes || null,
        fitment_position: v.fitment_position || null,
        source: v.source || "manual",
      })));
    if (vmError) {
      return { success: false, error: "适用车型保存失败: " + vmError.message };
    }
  }

  // Insert part images
  if (partImages.length > 0) {
    await supabase.from("part_images").insert(
      partImages.map((url, i) => ({
        part_id: partId,
        storage_path: url,
        sort_order: i,
      }))
    );
  }

  // Insert stock locations (create warehouses if needed)
  const validLocations = stockLocations.filter((row) => row.warehouseName.trim() || row.location.trim() || parseInt(row.quantity) > 0);
  if (validLocations.length > 0) {
    const warehouseMap = new Map<string, string>();
    for (const row of validLocations) {
      const wName = row.warehouseName.trim();
      if (!wName) continue;
      if (warehouseMap.has(wName)) continue;
      const { data: existing } = await supabase.from("warehouses").select("id").eq("name", wName).single();
      if (existing) {
        warehouseMap.set(wName, existing.id);
      } else {
        const { data: created } = await supabase.from("warehouses").insert({ name: wName }).select("id").single();
        if (created) warehouseMap.set(wName, created.id);
      }
    }

    const stockInserts = validLocations
      .filter((row) => warehouseMap.has(row.warehouseName.trim()))
      .map((row) => ({
        part_id: partId,
        warehouse_id: warehouseMap.get(row.warehouseName.trim()),
        location: row.location.trim() || null,
        quantity: parseInt(row.quantity) || 0,
        min_stock: parseInt(row.min_stock) || 0,
        max_stock: row.max_stock ? parseInt(row.max_stock) : null,
      }));

    if (stockInserts.length > 0) {
      await supabase.from("part_stock_locations").insert(stockInserts);
    }
  }

  // Save special prices
  if (specialPrices.length > 0) {
    const { error: spError } = await supabase.from("part_special_prices").insert(
      specialPrices.map((p) => ({
        part_id: partId,
        company_id: p.company_id || null,
        customer_id: p.customer_id || null,
        vehicle_id: p.vehicle_id || null,
        price: parseFloat(p.price),
      }))
    );
    if (spError) console.error("part_special_prices insert error:", spError);
  }

  // Save vehicle model prices
  if (vehicleModelPrices.length > 0) {
    const { error: vpError } = await supabase.from("part_vehicle_prices").insert(
      vehicleModelPrices.map((p) => ({
        part_id: partId,
        vehicle_model_id: Number(p.vehicle_model_id),
        sales_price: p.sales_price ? parseFloat(p.sales_price) : null,
        vip_price: p.vip_price ? parseFloat(p.vip_price) : null,
        standard_price: p.standard_price ? parseFloat(p.standard_price) : null,
      }))
    );
    if (vpError) console.error("part_vehicle_prices insert error:", vpError);
  }

  return { success: true, partId, finalSystemCode };
}
