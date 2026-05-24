"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LinkedItem } from "@/components/VehicleModelSelector";
import { StockLocationRow } from "../components/StockLocationSection";
import { SpecialPriceItem, VehicleModelPriceItem } from "../components/SpecialPricingSection";
import { PartNameItem } from "../components/PartNameSearch";

interface SupplierItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface PrefillData {
  part_number?: string;
  name?: string;
  unit?: string;
  purchase_price?: string;
  notes?: string;
  document_name?: string;
}

interface FormState {
  name: string;
  unit: string;
  categoryName: string;
  min_stock: string;
  purchase_price: string;
  reference_purchase_price: string;
  unit_price: string;
  standard_price: string;
  vip_price: string;
  wholesale_price: string;
  notes: string;
  auto_link_vehicle_model: boolean;
  is_consumable: boolean;
  sales_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  sales_value: string;
  diagnosis_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  diagnosis_value: string;
  repair_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  repair_value: string;
  qc_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  qc_value: string;
  picking_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  picking_value: string;
}

interface Actions {
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setSystemCode: React.Dispatch<React.SetStateAction<string>>;
  setPartNumber: React.Dispatch<React.SetStateAction<string>>;
  setBarcode: React.Dispatch<React.SetStateAction<string>>;
  setInterchangeCode: React.Dispatch<React.SetStateAction<string>>;
  setOeNumber: React.Dispatch<React.SetStateAction<string>>;
  setDocNameQuery: React.Dispatch<React.SetStateAction<string>>;
  setSelectedPartName: React.Dispatch<React.SetStateAction<PartNameItem | null>>;
  setSelectedBrand: React.Dispatch<React.SetStateAction<LinkedItem | null>>;
  setSelectedSupplier: React.Dispatch<React.SetStateAction<SupplierItem | null>>;
  setSelectedSpecs: React.Dispatch<React.SetStateAction<LinkedItem[]>>;
  setSelectedVehicleModels: React.Dispatch<React.SetStateAction<LinkedItem[]>>;
  setPartImages: React.Dispatch<React.SetStateAction<string[]>>;
  setStockLocations: React.Dispatch<React.SetStateAction<StockLocationRow[]>>;
  setSpecialPrices: React.Dispatch<React.SetStateAction<SpecialPriceItem[]>>;
  setVehicleModelPrices: React.Dispatch<React.SetStateAction<VehicleModelPriceItem[]>>;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}

export default function usePartFormInit(
  editId: string | undefined,
  prefillData: PrefillData | undefined,
  isEmbedded: boolean,
  isEditMode: boolean,
  partNumber: string,
  actions: Actions
) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const {
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
  } = actions;

  /* 1. 系统码生成 */
  useEffect(() => {
    if (isEditMode) return;
    async function generateCode() {
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const prefix = `PJ${dateStr}`;
      const { data } = await supabase
        .from("parts")
        .select("system_code")
        .ilike("system_code", `${prefix}%`)
        .order("system_code", { ascending: false })
        .limit(1);

      let seq = 1;
      if (data && data.length > 0 && data[0].system_code) {
        const suffix = data[0].system_code.slice(prefix.length);
        const num = parseInt(suffix, 10);
        if (!isNaN(num)) seq = num + 1;
      }
      setSystemCode(`${prefix}${String(seq).padStart(3, "0")}`);
    }
    generateCode();
  }, [supabase, isEditMode, setSystemCode]);

  /* 2. copy-from 加载 */
  useEffect(() => {
    const copyFromId = searchParams.get("copy_from");
    if (!copyFromId) return;

    async function loadPart() {
      const { data: part } = await supabase
        .from("parts")
        .select("*")
        .eq("id", copyFromId)
        .single();
      if (!part) return;

      const [
        { data: partName },
        { data: brand },
        { data: supplier },
        { data: specs },
        { data: vms },
      ] = await Promise.all([
        part.part_name_id
          ? supabase.from("part_names").select("*, part_categories(*)").eq("id", part.part_name_id).single()
          : Promise.resolve({ data: null }),
        part.brand_id
          ? supabase.from("part_brands").select("*").eq("id", part.brand_id).single()
          : Promise.resolve({ data: null }),
        part.supplier_id
          ? supabase.from("suppliers").select("*").eq("id", part.supplier_id).single()
          : Promise.resolve({ data: null }),
        supabase.from("parts_specifications").select("specification_id, specifications(*)").eq("part_id", copyFromId),
        supabase.from("part_vehicle_models").select("vehicle_model_id, vehicle_models(厂商, 品牌, 车系, 车型, 销售版本, 年款, 排量, 发动机型号, 燃油类型, 进气形式, 变速箱类型, 变速箱代号, 底盘代号, 驱动方式, 车身类型, 排放标准, 前轮胎规格, 后轮胎规格), notes, fitment_position, source").eq("part_id", copyFromId),
      ]);

      if (partName) setSelectedPartName(partName);
      if (brand) setSelectedBrand({ id: brand.id, name: brand.name });
      if (supplier) setSelectedSupplier(supplier);
      if (specs) {
        setSelectedSpecs(
          specs
            .map((s: unknown) => ({
              id: (s as Record<string, unknown>).specification_id as string,
              name: ((s as Record<string, unknown>).specifications as Record<string, unknown> | undefined)?.name as string | undefined,
            }))
            .filter((s: { id: string; name?: string }) => s.name) as LinkedItem[]
        );
      }
      if (vms) {
        const mapped = (vms as unknown[])
          .map((v: unknown) => {
            const vm = ((v as Record<string, unknown>).vehicle_models as Record<string, unknown> | undefined);
            if (!vm) return null;
            const brand = (vm.品牌 as string) || "";
            const series = (vm.车系 as string) || "";
            const model_name = (vm.车型 as string) || "";
            const name = `${brand} ${series} ${model_name}`.trim();
            if (!name) return null;
            return {
              id: String((v as Record<string, unknown>).vehicle_model_id),
              name,
              manufacturer: vm.厂商,
              brand,
              series,
              model_name,
              sales_version: vm.销售版本,
              year_start: vm.年款,
              year_end: vm.年款,
              displacement: vm.排量,
              engine: vm.发动机型号,
              fuel_type: vm.燃油类型,
              intake_form: vm.进气形式,
              chassis_code: vm.底盘代号,
              transmission_type: vm.变速箱类型,
              transmission_code: vm.变速箱代号,
              drive_type: vm.驱动方式,
              body_type: vm.车身类型,
              emission_standard: vm.排放标准,
              front_tire: vm.前轮胎规格,
              rear_tire: vm.后轮胎规格,
              fitment_position: (v as Record<string, unknown>).fitment_position as string || "",
              source: (v as Record<string, unknown>).source as string || "manual",
            };
          })
          .filter((v: unknown) => v !== null);
        setSelectedVehicleModels(mapped as LinkedItem[]);
      }

      setOeNumber("");
      setDocNameQuery(part.document_name || "");
      setForm((prev) => ({
        ...prev,
        name: "",
        unit: part.unit || "件",
        categoryName:
          (Array.isArray(partName?.part_categories)
            ? partName?.part_categories[0]?.name
            : partName?.part_categories?.name) || "",
        min_stock: String(part.min_stock || 10),
        purchase_price: "",
        reference_purchase_price: "",
        unit_price: "",
        standard_price: "",
        vip_price: "",
        wholesale_price: "",
        notes: "",
        auto_link_vehicle_model: part.auto_link_vehicle_model || false,
        is_consumable: part.is_consumable || false,
        sales_type: part.sales_commission_type || "",
        sales_value: part.sales_commission_value ? String(part.sales_commission_value) : "",
        diagnosis_type: part.diagnosis_commission_type || "",
        diagnosis_value: part.diagnosis_commission_value ? String(part.diagnosis_commission_value) : "",
        repair_type: part.repair_commission_type || "",
        repair_value: part.repair_commission_value ? String(part.repair_commission_value) : "",
        qc_type: part.qc_commission_type || "",
        qc_value: part.qc_commission_value ? String(part.qc_commission_value) : "",
        picking_type: part.picking_commission_type || "",
        picking_value: part.picking_commission_value ? String(part.picking_commission_value) : "",
      }));

      setPartImages([]);
      setStockLocations([
        { id: crypto.randomUUID(), warehouseName: "", location: "", quantity: "0", min_stock: "0", max_stock: "" },
      ]);
    }

    loadPart();
  }, [searchParams, supabase, setSelectedPartName, setSelectedBrand, setSelectedSupplier, setSelectedSpecs, setSelectedVehicleModels, setOeNumber, setDocNameQuery, setForm, setPartImages, setStockLocations]);

  /* 3. 编辑数据加载 */
  useEffect(() => {
    if (!editId) return;
    async function loadEditData() {
      setLoading(true);
      try {
        const { data: part } = await supabase.from("parts").select("*").eq("id", editId).single();
        if (!part) {
          alert("配件不存在");
          router.push("/inventory");
          return;
        }

        const [
          { data: partName },
          { data: brand },
          { data: supplier },
          { data: specs },
          { data: vms },
          { data: images },
          { data: stocks },
          { data: specialData },
          { data: vehiclePriceData },
        ] = await Promise.all([
          part.part_name_id
            ? supabase.from("part_names").select("*, part_categories(*)").eq("id", part.part_name_id).single()
            : Promise.resolve({ data: null }),
          part.brand_id
            ? supabase.from("part_brands").select("*").eq("id", part.brand_id).single()
            : Promise.resolve({ data: null }),
          part.supplier_id
            ? supabase.from("suppliers").select("*").eq("id", part.supplier_id).single()
            : Promise.resolve({ data: null }),
          supabase.from("parts_specifications").select("specification_id, part_specifications(name)").eq("part_id", editId),
          supabase.from("part_vehicle_models").select("vehicle_model_id, vehicle_models(厂商, 品牌, 车系, 车型, 销售版本, 年款, 排量, 发动机型号, 燃油类型, 进气形式, 变速箱类型, 变速箱代号, 底盘代号, 驱动方式, 车身类型, 排放标准), notes, fitment_position, source").eq("part_id", editId),
          supabase.from("part_images").select("*").eq("part_id", editId).order("sort_order", { ascending: true }),
          supabase.from("part_stock_locations").select("*, warehouses(name)").eq("part_id", editId),
          supabase.from("part_special_prices").select("*, companies(name), customers(name, phone), vehicles(plate_number, vin)").eq("part_id", editId),
          supabase.from("part_vehicle_prices").select("*, vehicle_models(品牌, 车系, 车型, 年款, 发动机型号)").eq("part_id", editId),
        ]);

        if (partName) setSelectedPartName(partName);
        if (brand) setSelectedBrand({ id: brand.id, name: brand.name });
        if (supplier) setSelectedSupplier(supplier);
        if (specs) {
          setSelectedSpecs(
            specs
              .map((s: unknown) => ({
                id: (s as Record<string, unknown>).specification_id as string,
                name: ((s as Record<string, unknown>).part_specifications as Record<string, unknown> | undefined)?.name as string | undefined,
              }))
              .filter((s: { id: string; name?: string }) => s.name) as LinkedItem[]
          );
        }
        if (vms) {
          setSelectedVehicleModels(
            (vms as unknown[]).map((v: unknown) => {
              const vm = ((v as Record<string, unknown>).vehicle_models as Record<string, unknown> | undefined);
              const brand = (vm?.品牌 as string) || "";
              const series = (vm?.车系 as string) || "";
              const model_name = (vm?.车型 as string) || "";
              const name = `${brand} ${series} ${model_name}`.trim();
              return {
                id: String((v as Record<string, unknown>).vehicle_model_id),
                name,
                manufacturer: vm?.厂商 as string | undefined,
                brand,
                series,
                model_name,
                sales_version: vm?.销售版本 as string | undefined,
                year_start: vm?.年款 as number | undefined,
                year_end: vm?.年款 as number | undefined,
                displacement: vm?.排量 as string | undefined,
                engine: vm?.发动机型号 as string | undefined,
                fuel_type: vm?.燃油类型 as string | undefined,
                intake_form: vm?.进气形式 as string | undefined,
                chassis_code: vm?.底盘代号 as string | undefined,
                transmission_type: vm?.变速箱类型 as string | undefined,
                transmission_code: vm?.变速箱代号 as string | undefined,
                drive_type: vm?.驱动方式 as string | undefined,
                body_type: vm?.车身类型 as string | undefined,
                emission_standard: vm?.排放标准 as string | undefined,
                notes: (v as Record<string, unknown>).notes as string || "",
                fitment_position: (v as Record<string, unknown>).fitment_position as string || "",
                source: (v as Record<string, unknown>).source as string || "manual",
              };
            }) as LinkedItem[]
          );
        }
        if (images) {
          setPartImages(images.map((img: unknown) => (img as Record<string, unknown>).storage_path as string));
        }
        if (stocks && stocks.length > 0) {
          setStockLocations(
            stocks.map((s: unknown) => {
              const row = s as Record<string, unknown>;
              const wh = row.warehouses as Record<string, unknown> | undefined;
              return {
                id: row.id as string,
                warehouseName: wh?.name as string || "",
                location: row.location as string || "",
                quantity: String(row.quantity || 0),
                min_stock: String(row.min_stock || 0),
                max_stock: row.max_stock ? String(row.max_stock) : "",
              };
            })
          );
        }

        setPartNumber(part.part_number || "");
        setBarcode(part.barcode || "");
        setInterchangeCode(part.interchange_code || "");
        setOeNumber(part.oe_number || "");
        setDocNameQuery(part.document_name || "");
        setSystemCode(part.system_code || "");

        setForm({
          name: part.name || "",
          unit: part.unit || "件",
          categoryName:
            (Array.isArray(partName?.part_categories)
              ? partName?.part_categories[0]?.name
              : partName?.part_categories?.name) || "",
          min_stock: String(part.min_stock || 10),
          purchase_price: part.purchase_price ? String(part.purchase_price) : "",
          reference_purchase_price: part.reference_purchase_price ? String(part.reference_purchase_price) : "",
          unit_price: part.unit_price ? String(part.unit_price) : "",
          standard_price: part.standard_price ? String(part.standard_price) : "",
          vip_price: part.vip_price ? String(part.vip_price) : "",
          wholesale_price: part.wholesale_price ? String(part.wholesale_price) : "",
          notes: part.notes || "",
          auto_link_vehicle_model: part.auto_link_vehicle_model || false,
          is_consumable: part.is_consumable || false,
          sales_type: part.sales_commission_type || "",
          sales_value: part.sales_commission_value ? String(part.sales_commission_value) : "",
          diagnosis_type: part.diagnosis_commission_type || "",
          diagnosis_value: part.diagnosis_commission_value ? String(part.diagnosis_commission_value) : "",
          repair_type: part.repair_commission_type || "",
          repair_value: part.repair_commission_value ? String(part.repair_commission_value) : "",
          qc_type: part.qc_commission_type || "",
          qc_value: part.qc_commission_value ? String(part.qc_commission_value) : "",
          picking_type: part.picking_commission_type || "",
          picking_value: part.picking_commission_value ? String(part.picking_commission_value) : "",
        });

        if (specialData) {
          setSpecialPrices(
            specialData.map((s: unknown) => {
              const row = s as Record<string, unknown>;
              const companies = row.companies as Record<string, unknown> | undefined;
              const customers = row.customers as Record<string, unknown> | undefined;
              const vehicles = row.vehicles as Record<string, unknown> | undefined;
              return {
                id: row.id as string,
                company_id: row.company_id as string | undefined || undefined,
                company_name: companies?.name as string | undefined || undefined,
                customer_id: row.customer_id as string | undefined || undefined,
                customer_name: customers?.name as string | undefined || undefined,
                vehicle_id: row.vehicle_id as string | undefined || undefined,
                vehicle_name: vehicles ? `${vehicles.plate_number || ""}`.trim() : undefined,
                price: String(row.price),
              };
            })
          );
        }

        if (vehiclePriceData) {
          setVehicleModelPrices(
            vehiclePriceData.map((v: unknown) => {
              const row = v as Record<string, unknown>;
              const vm = row.vehicle_models as Record<string, unknown> | undefined;
              const brand = (vm?.品牌 as string) || "";
              const series = (vm?.车系 as string) || "";
              const model_name = (vm?.车型 as string) || "";
              const name = `${brand} ${series} ${model_name}`.trim();
              return {
                vehicle_model_id: String(row.vehicle_model_id),
                vehicle_name: name,
                brand,
                series,
                model_name,
                year_start: vm?.年款 as number | undefined,
                year_end: vm?.年款 as number | undefined,
                engine: vm?.发动机型号 as string | undefined,
                sales_price: row.sales_price ? String(row.sales_price) : "",
                vip_price: row.vip_price ? String(row.vip_price) : "",
                standard_price: row.standard_price ? String(row.standard_price) : "",
              };
            })
          );
        }
      } catch (err: unknown) {
        alert("加载配件数据失败: " + ((err as Error).message || "未知错误"));
      } finally {
        setLoading(false);
      }
    }
    loadEditData();
  }, [editId, supabase, router, setLoading, setSystemCode, setPartNumber, setBarcode, setInterchangeCode, setOeNumber, setDocNameQuery, setSelectedPartName, setSelectedBrand, setSelectedSupplier, setSelectedSpecs, setSelectedVehicleModels, setPartImages, setStockLocations, setForm, setSpecialPrices, setVehicleModelPrices]);

  /* 4. 弹窗预填数据 */
  useEffect(() => {
    if (editId || !prefillData) return;
    if (prefillData.part_number) setPartNumber(prefillData.part_number);
    if (prefillData.name) {
      setForm((prev) => ({ ...prev, name: prefillData.name! }));
      supabase
        .from("part_names")
        .select("id, name, part_categories(id, name)")
        .ilike("name", `%${prefillData.name}%`)
        .limit(10)
        .then(({ data }) => {
          if (data && data.length > 0) {
            const exact = data.find((p: unknown) => (p as Record<string, unknown>).name === prefillData.name);
            setSelectedPartName(exact || data[0]);
          }
        });
    }
    if (prefillData.unit) setForm((prev) => ({ ...prev, unit: prefillData.unit! }));
    if (prefillData.purchase_price) setForm((prev) => ({ ...prev, purchase_price: prefillData.purchase_price! }));
    if (prefillData.notes) setForm((prev) => ({ ...prev, notes: prefillData.notes! }));
    if (prefillData.document_name) setDocNameQuery(prefillData.document_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 5. 弹窗模式下：编码精确匹配配件库时自动填充 */
  useEffect(() => {
    if (!isEmbedded || !partNumber.trim() || isEditMode) return;
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("parts")
        .select(
          "id, part_number, name, unit, purchase_price, notes, document_name, barcode, interchange_code, min_stock, unit_price, standard_price, vip_price, wholesale_price, supplier_id, brand_id, part_brands(id, name), specification_id, part_specifications(id, name), category_id, part_categories(id, name), part_images(image_path), part_stock_locations(warehouse_id, warehouses(name), location, quantity, min_stock, max_stock), auto_link_vehicle_model, is_consumable, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, picking_commission_type, picking_commission_value"
        )
        .eq("part_number", partNumber.trim().toUpperCase())
        .single();
      if (!data) return;
      setPartNumber(data.part_number || "");
      setBarcode(data.barcode || "");
      setInterchangeCode(data.interchange_code || "");
      setDocNameQuery(data.document_name || "");
      setForm((prev) => ({
        ...prev,
        name: data.name || prev.name,
        unit: data.unit || prev.unit,
        min_stock: String(data.min_stock || 10),
        purchase_price: data.purchase_price != null ? String(data.purchase_price) : prev.purchase_price,
        reference_purchase_price: "",
        unit_price: data.unit_price != null ? String(data.unit_price) : prev.unit_price,
        standard_price: data.standard_price != null ? String(data.standard_price) : prev.standard_price,
        vip_price: data.vip_price != null ? String(data.vip_price) : prev.vip_price,
        wholesale_price: data.wholesale_price != null ? String(data.wholesale_price) : prev.wholesale_price,
        notes: data.notes || prev.notes,
        auto_link_vehicle_model: data.auto_link_vehicle_model || false,
        is_consumable: data.is_consumable || false,
        sales_type: (data.sales_commission_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
        sales_value: data.sales_commission_value != null ? String(data.sales_commission_value) : "",
        diagnosis_type: (data.diagnosis_commission_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
        diagnosis_value: data.diagnosis_commission_value != null ? String(data.diagnosis_commission_value) : "",
        repair_type: (data.repair_commission_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
        repair_value: data.repair_commission_value != null ? String(data.repair_commission_value) : "",
        qc_type: (data.qc_commission_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
        qc_value: data.qc_commission_value != null ? String(data.qc_commission_value) : "",
        picking_type: (data.picking_commission_type as "" | "revenue_pct" | "profit_pct" | "fixed") || "",
        picking_value: data.picking_commission_value != null ? String(data.picking_commission_value) : "",
      }));
      if (data.part_images?.length > 0) {
        setPartImages(data.part_images.map((img: unknown) => (img as Record<string, unknown>).image_path as string).filter(Boolean));
      }
      if (data.part_brands) {
        const pb = Array.isArray(data.part_brands) ? data.part_brands[0] : data.part_brands;
        if (pb) setSelectedBrand({ id: pb.id, name: pb.name });
      }
      if (data.part_specifications) {
        const ps = Array.isArray(data.part_specifications) ? data.part_specifications[0] : data.part_specifications;
        if (ps) setSelectedSpecs([{ id: ps.id, name: ps.name }]);
      }
      if (data.part_categories) {
        setSelectedPartName((prev: PartNameItem | null) =>
          prev
            ? { ...prev, part_categories: data.part_categories }
            : { id: "", name: data.name, part_categories: data.part_categories }
        );
      }
      if (data.supplier_id) {
        supabase.from("suppliers").select("id, name").eq("id", data.supplier_id).single().then(({ data: s }) => {
          if (s) setSelectedSupplier(s as SupplierItem);
        });
      }
      if (data.part_stock_locations?.length > 0) {
        setStockLocations(
          data.part_stock_locations.map((loc: unknown) => {
            const l = loc as Record<string, unknown>;
            const wh = l.warehouses as Record<string, unknown> | undefined;
            return {
              id: crypto.randomUUID(),
              warehouseName: wh?.name as string || "",
              location: l.location as string || "",
              quantity: String(l.quantity || 0),
              min_stock: String(l.min_stock || 0),
              max_stock: l.max_stock != null ? String(l.max_stock) : "",
            };
          })
        );
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partNumber, isEmbedded, isEditMode]);
}
