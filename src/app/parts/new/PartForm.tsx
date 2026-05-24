"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import usePartFormInit from "./hooks/usePartFormInit";
import { PageHeader } from "@/components/PageHeader";
import VehicleModelSelector, { LinkedItem } from "@/components/VehicleModelSelector";
import StockLocationSection, { StockLocationRow } from "./components/StockLocationSection";
import SpecialPricingSection, { SpecialPriceItem, VehicleModelPriceItem } from "./components/SpecialPricingSection";
import PricingSection from "./components/PricingSection";
import NotesImagesSection from "./components/NotesImagesSection";
import PartNumberField from "./components/PartNumberField";
import PartNameSearch, { PartNameItem, CommissionFillData } from "./components/PartNameSearch";
import DocNameSearch from "./components/DocNameSearch";
import BrandSearch from "./components/BrandSearch";
import SpecSearch from "./components/SpecSearch";
import CommissionSection, { CommissionFormData } from "./components/CommissionSection";
import FormActions from "./components/FormActions";
import submitPart from "./submitPart";

/* 供应商查询结果 */
interface SupplierItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

export default function PartForm({
  editId,
  onSaved,
  onCancel,
  prefillData,
}: {
  editId?: string;
  onSaved?: (partId: string) => void;
  onCancel?: () => void;
  prefillData?: {
    part_number?: string;
    name?: string;
    unit?: string;
    purchase_price?: string;
    notes?: string;
    document_name?: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const isEditMode = !!editId;
  const isEmbedded = !!onSaved;
  const [loading, setLoading] = useState(false);
  const [systemCode, setSystemCode] = useState("");

  // Part number
  const [partNumber, setPartNumber] = useState("");
  const [hasDuplicatePartNumber, setHasDuplicatePartNumber] = useState(false);

  // Document name
  const [docNameQuery, setDocNameQuery] = useState("");

  const [selectedSupplier, setSelectedSupplier] = useState<SupplierItem | null>(null);

  // Part name
  const [selectedPartName, setSelectedPartName] = useState<PartNameItem | null>(null);

  // Brand
  const [selectedBrand, setSelectedBrand] = useState<LinkedItem | null>(null);

  // Specification (multiple)
  const [selectedSpecs, setSelectedSpecs] = useState<LinkedItem[]>([]);

  // Vehicle model search (multiple)
  const [selectedVehicleModels, setSelectedVehicleModels] = useState<LinkedItem[]>([]);

  // Stock locations
  const [stockLocations, setStockLocations] = useState<StockLocationRow[]>([
    { id: crypto.randomUUID(), warehouseName: "", location: "", quantity: "0", min_stock: "0", max_stock: "" },
  ]);


  const [barcode, setBarcode] = useState("");
  const [interchangeCode, setInterchangeCode] = useState("");
  const [oeNumber, setOeNumber] = useState("");
  const [partImages, setPartImages] = useState<string[]>([]);

  const [form, setForm] = useState({
    name: "",
    unit: "",
    categoryName: "",
    min_stock: "10",
    purchase_price: "",
    reference_purchase_price: "",
    unit_price: "",
    standard_price: "",
    vip_price: "",
    wholesale_price: "",
    notes: "",
    auto_link_vehicle_model: false,
    is_consumable: false,
    sales_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    sales_value: "",
    diagnosis_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    diagnosis_value: "",
    repair_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    repair_value: "",
    qc_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    qc_value: "",
    picking_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    picking_value: "",
  });


  // Special pricing state (unified: company/customer/vehicle)
  const [specialPrices, setSpecialPrices] = useState<SpecialPriceItem[]>([]);

  // Vehicle model pricing state (three prices)
  const [vehicleModelPrices, setVehicleModelPrices] = useState<VehicleModelPriceItem[]>([]);

  usePartFormInit(editId, prefillData, isEmbedded, isEditMode, partNumber, {
    setLoading,
    setSystemCode,
    setPartNumber,
    setBarcode,
    setInterchangeCode,
    setOeNumber,
    setDocNameQuery,
    setSelectedPartName,
    setSelectedBrand,
    setSelectedSupplier,
    setSelectedSpecs,
    setSelectedVehicleModels,
    setPartImages,
    setStockLocations,
    setSpecialPrices,
    setVehicleModelPrices,
    setForm,
  });

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+S / Cmd+S — 保存
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
        return;
      }
      // Ctrl+Shift+D — 复制新建
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
        e.preventDefault();
        const copyId = isEditMode ? editId : searchParams.get("copy_from");
        if (copyId) router.push(`/parts/new?copy_from=${copyId}`);
        return;
      }
      // Ctrl+Shift+R — 重新输入
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "R") {
        e.preventDefault();
        window.location.reload();
        return;
      }
      // Escape — 取消
      if (e.key === "Escape") {
        if (onCancel) onCancel();
        else router.back();
        return;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSubmit, isEditMode, editId, searchParams, router]);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!partNumber.trim()) {
      alert("请填写配件编码");
      return;
    }
    if (!selectedPartName) {
      alert("请选择配件名称");
      return;
    }
    if (!form.unit_price.trim()) {
      alert("请填写销售价");
      return;
    }
    if (hasDuplicatePartNumber) {
      alert("该配件编码已存在，请更换");
      return;
    }

    setLoading(true);
    const result = await submitPart({
      supabase,
      isEditMode,
      editId,
      systemCode,
      partNumber,
      barcode,
      interchangeCode,
      oeNumber,
      documentName: docNameQuery.trim() || null,
      partNameId: selectedPartName.id,
      partName: form.name,
      partCategories: selectedPartName.part_categories,
      brandId: selectedBrand?.id || null,
      form,
      stockLocations,
      selectedSpecs,
      selectedVehicleModels,
      partImages,
      specialPrices,
      vehicleModelPrices,
      supplierId: selectedSupplier?.id || null,
    });
    setLoading(false);

    if (!result.success) {
      alert(result.error);
      return;
    }

    if (result.finalSystemCode) {
      setSystemCode(result.finalSystemCode);
    }

    if (onSaved && result.partId) {
      onSaved(result.partId);
    } else if (isEditMode) {
      router.push(`/parts/${editId}`);
    } else {
      router.push('/inventory');
    }
    router.refresh();
  }

  function handleCommissionFill(data: CommissionFillData) {
    setForm((prev) => ({
      ...prev,
      name: data.name,
      unit: data.unit,
      categoryName: data.categoryName,
      auto_link_vehicle_model: data.auto_link_vehicle_model,
      is_consumable: data.is_consumable,
      sales_type: (data.sales_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
      sales_value: data.sales_value,
      diagnosis_type: (data.diagnosis_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
      diagnosis_value: data.diagnosis_value,
      repair_type: (data.repair_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
      repair_value: data.repair_value,
      qc_type: (data.qc_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
      qc_value: data.qc_value,
      picking_type: (data.picking_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
      picking_value: data.picking_value,
    }));
  }

  function handleClearCommission() {
    setForm((prev) => ({
      ...prev,
      name: "",
      unit: "",
      categoryName: "",
      auto_link_vehicle_model: false,
      is_consumable: false,
      sales_type: "",
      sales_value: "",
      diagnosis_type: "",
      diagnosis_value: "",
      repair_type: "",
      repair_value: "",
      qc_type: "",
      qc_value: "",
      picking_type: "",
      picking_value: "",
    }));
  }

  return (
    <div className={isEmbedded ? "relative" : ""}>
      {!isEmbedded && (
        <PageHeader
          title={isEditMode ? "编辑配件" : searchParams.get("copy_from") ? "复制添加配件" : "新增配件"}
          description={searchParams.get("copy_from") ? "已带入原配件信息，请修改不允许重复的内容后保存" : undefined}
        />
      )}

      <form onSubmit={handleSubmit} className="max-w-6xl relative space-y-6">
        {/* 基础信息 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 relative">
          <div className="absolute top-4 left-6">
            <span className="text-xs text-gray-400 font-mono tracking-wider select-none">{systemCode || ""}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4 mt-2">
            <PartNumberField
              value={partNumber}
              onChange={setPartNumber}
              editId={editId || null}
              onHasDuplicateChange={setHasDuplicatePartNumber}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">条形码</label>
              <input
                type="text"
                placeholder="扫码或手动输入"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">互换码</label>
              <input
                type="text"
                placeholder="替代配件编码"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={interchangeCode}
                onChange={(e) => setInterchangeCode(e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">OE号</label>
              <input
                type="text"
                placeholder="原厂编码"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={oeNumber}
                onChange={(e) => setOeNumber(e.target.value.toUpperCase())}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-6 gap-4 mb-4">
            <PartNameSearch
              selectedPartName={selectedPartName}
              onSelectPartName={setSelectedPartName}
              onCommissionFill={handleCommissionFill}
              onClearCommission={handleClearCommission}
            />
            <DocNameSearch value={docNameQuery} onChange={setDocNameQuery} />
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-gray-50"
                value={form.unit}
                readOnly
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-gray-50"
                value={form.categoryName}
                readOnly
              />
            </div>
          </div>

          <div className="grid grid-cols-6 gap-4 mb-4">
            <BrandSearch
              selectedBrand={selectedBrand}
              onSelectBrand={setSelectedBrand}
              selectedPartName={selectedPartName}
            />
            <SpecSearch
              selectedSpecs={selectedSpecs}
              onSelectSpecsChange={setSelectedSpecs}
              selectedPartName={selectedPartName}
            />
          </div>
        </div>

        <PricingSection
          purchasePrice={form.purchase_price}
          onPurchasePriceChange={(v) => setForm((prev) => ({ ...prev, purchase_price: v }))}
          referencePurchasePrice={form.reference_purchase_price}
          onReferencePurchasePriceChange={(v) => setForm((prev) => ({ ...prev, reference_purchase_price: v }))}
          unitPrice={form.unit_price}
          onUnitPriceChange={(v) => setForm((prev) => ({ ...prev, unit_price: v }))}
          standardPrice={form.standard_price}
          onStandardPriceChange={(v) => setForm((prev) => ({ ...prev, standard_price: v }))}
          vipPrice={form.vip_price}
          onVipPriceChange={(v) => setForm((prev) => ({ ...prev, vip_price: v }))}
          wholesalePrice={form.wholesale_price}
          onWholesalePriceChange={(v) => setForm((prev) => ({ ...prev, wholesale_price: v }))}
          minStock={form.min_stock}
          onMinStockChange={(v) => setForm((prev) => ({ ...prev, min_stock: v }))}
          selectedSupplier={selectedSupplier}
          onSelectSupplier={setSelectedSupplier}
        />

        <CommissionSection
          data={form}
          onChange={(partial) => setForm((prev) => ({ ...prev, ...partial }))}
        />

        <StockLocationSection value={stockLocations} onChange={setStockLocations} />

        <NotesImagesSection
          notes={form.notes}
          onNotesChange={(v) => setForm((prev) => ({ ...prev, notes: v }))}
          partImages={partImages}
          onImagesChange={setPartImages}
        />

        <VehicleModelSelector
          value={selectedVehicleModels}
          onChange={setSelectedVehicleModels}
        />

        <SpecialPricingSection
          specialPrices={specialPrices}
          onSpecialPricesChange={setSpecialPrices}
          vehicleModelPrices={vehicleModelPrices}
          onVehicleModelPricesChange={setVehicleModelPrices}
        />

        <FormActions
          loading={loading}
          disabled={loading || !!hasDuplicatePartNumber || !partNumber.trim() || !selectedPartName || !form.unit_price.trim()}
          isEmbedded={isEmbedded}
          isEditMode={isEditMode}
          hasCopyFrom={!!searchParams.get("copy_from")}
          onSave={handleSubmit}
          onCopyNew={() => {
            const copyId = isEditMode ? editId : searchParams.get("copy_from");
            if (copyId) router.push(`/parts/new?copy_from=${copyId}`);
          }}
          onReload={() => window.location.reload()}
          onCancel={() => (onCancel ? onCancel() : router.back())}
        />
      </form>
    </div>
  );
}
