"use client";

import { useState, useEffect, useRef, Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";

interface LinkedItem {
  id: string;
  name: string;
  brand?: string;
  series?: string;
  model_name?: string;
  year_start?: number;
  year_end?: number;
  engine?: string;
  notes?: string;
}

interface StockLocationRow {
  id: string;
  warehouseName: string;
  location: string;
  quantity: string;
  min_stock: string;
  max_stock: string;
}

interface SpecialPriceItem {
  id: string;
  company_id?: string;
  company_name?: string;
  customer_id?: string;
  customer_name?: string;
  vehicle_id?: string;
  vehicle_name?: string;
  price: string;
}

interface VehicleModelPriceItem {
  vehicle_model_id: string;
  vehicle_name: string;
  brand: string;
  series: string;
  model_name: string;
  year_start?: number;
  year_end?: number;
  engine?: string;
  sales_price: string;
  vip_price: string;
  standard_price: string;
}

export default function PartForm({ editId }: { editId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const isEditMode = !!editId;
  const [loading, setLoading] = useState(false);
  const [systemCode, setSystemCode] = useState("");

  // Part number search
  const [partNumber, setPartNumber] = useState("");
  const [pnResults, setPnResults] = useState<any[] | null>(null);
  const [pnSearching, setPnSearching] = useState(false);
  const pnTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Document name search
  const [docNameQuery, setDocNameQuery] = useState("");
  const [docNameResults, setDocNameResults] = useState<string[] | null>(null);
  const [docNameSearching, setDocNameSearching] = useState(false);
  const dnTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Supplier search
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierResults, setSupplierResults] = useState<any[] | null>(null);
  const [supplierSearching, setSupplierSearching] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<any | null>(null);
  const spTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Part name search
  const [partNameQuery, setPartNameQuery] = useState("");
  const [partNameResults, setPartNameResults] = useState<any[] | null>(null);
  const [partNameSearching, setPartNameSearching] = useState(false);
  const [selectedPartName, setSelectedPartName] = useState<any | null>(null);
  const [highlightedNameIndex, setHighlightedNameIndex] = useState(-1);
  const pnNameTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Brand search
  const [brandQuery, setBrandQuery] = useState("");
  const [brandResults, setBrandResults] = useState<any[] | null>(null);
  const [brandSearching, setBrandSearching] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<LinkedItem | null>(null);
  const [brandFocus, setBrandFocus] = useState(false);
  const [highlightedBrandIndex, setHighlightedBrandIndex] = useState(-1);
  const brandTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Specification search (multiple)
  const [specQuery, setSpecQuery] = useState("");
  const [specResults, setSpecResults] = useState<any[] | null>(null);
  const [specSearching, setSpecSearching] = useState(false);
  const [selectedSpecs, setSelectedSpecs] = useState<LinkedItem[]>([]);
  const [highlightedSpecIndex, setHighlightedSpecIndex] = useState(-1);
  const specTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Vehicle model search (multiple)
  const [selectedVehicleModels, setSelectedVehicleModels] = useState<LinkedItem[]>([]);
  const [checkedVehicleModelIds, setCheckedVehicleModelIds] = useState<string[]>([]);

  // Vehicle model modal
  const [vmModalOpen, setVmModalOpen] = useState(false);
  const [vmModalQuery, setVmModalQuery] = useState('');
  const [vmModalList, setVmModalList] = useState<any[]>([]);
  const [vmModalLoading, setVmModalLoading] = useState(false);
  const [vmModalSelected, setVmModalSelected] = useState<Set<string>>(new Set());

  // Stock locations
  const [stockLocations, setStockLocations] = useState<StockLocationRow[]>([
    { id: crypto.randomUUID(), warehouseName: "", location: "", quantity: "0", min_stock: "0", max_stock: "" },
  ]);


  const [allWarehouses, setAllWarehouses] = useState<any[]>([]);
  const [whResultsMap, setWhResultsMap] = useState<Record<string, any[]>>({});
  const [locResultsMap, setLocResultsMap] = useState<Record<string, any[]>>({});
  const [warehouseLocationMap, setWarehouseLocationMap] = useState<Record<string, any[]>>({});

  const [barcode, setBarcode] = useState("");
  const [interchangeCode, setInterchangeCode] = useState("");
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

  // Company search for special pricing
  const [spCompanyQuery, setSpCompanyQuery] = useState('');
  const [spCompanyResults, setSpCompanyResults] = useState<any[]>([]);
  const [spCompanySearching, setSpCompanySearching] = useState(false);
  const [spCompanySelected, setSpCompanySelected] = useState<{ id: string; name: string } | null>(null);
  const spCompanyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Customer search for special pricing
  const [spCustomerQuery, setSpCustomerQuery] = useState('');
  const [spCustomerResults, setSpCustomerResults] = useState<any[]>([]);
  const [spCustomerSearching, setSpCustomerSearching] = useState(false);
  const [spCustomerSelected, setSpCustomerSelected] = useState<{ id: string; name: string } | null>(null);
  const spCustomerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Vehicle search for special pricing
  const [spVehicleQuery, setSpVehicleQuery] = useState('');
  const [spVehicleResults, setSpVehicleResults] = useState<any[]>([]);
  const [spVehicleSearching, setSpVehicleSearching] = useState(false);
  const [spVehicleSelected, setSpVehicleSelected] = useState<{ id: string; name: string } | null>(null);
  const spVehicleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [spNewPrice, setSpNewPrice] = useState('');

  // Vehicle model pricing state (three prices)
  const [vehicleModelPrices, setVehicleModelPrices] = useState<VehicleModelPriceItem[]>([]);

  // Group by price for display
  const groupedVehiclePrices = useMemo(() => {
    const map = new Map<string, VehicleModelPriceItem[]>();
    for (const p of vehicleModelPrices) {
      const key = `${p.sales_price}|${p.vip_price}|${p.standard_price}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.values()).map((items) => ({
      sales_price: items[0].sales_price,
      vip_price: items[0].vip_price,
      standard_price: items[0].standard_price,
      items,
    }));
  }, [vehicleModelPrices]);

  // Vehicle model search for pricing
  const [vmPriceQuery, setVmPriceQuery] = useState('');
  const [vmPriceResults, setVmPriceResults] = useState<any[]>([]);
  const [vmPriceSearching, setVmPriceSearching] = useState(false);
  const [vmPriceSelected, setVmPriceSelected] = useState<{
    id: string;
    name: string;
    brand: string;
    series: string;
    model_name: string;
    year_start?: number;
    year_end?: number;
    engine?: string;
  } | null>(null);
  const [vmNewSalesPrice, setVmNewSalesPrice] = useState('');
  const [vmNewVipPrice, setVmNewVipPrice] = useState('');
  const [vmNewStandardPrice, setVmNewStandardPrice] = useState('');
  const vmPriceTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  const totalQuantity = stockLocations.reduce((sum, row) => sum + (parseInt(row.quantity) || 0), 0);

  // Generate system code on mount (only for new)
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
  }, [supabase, isEditMode]);

  // Load copy-from part data
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

      // Load associations
      const [
        { data: partName },
        { data: brand },
        { data: supplier },
        { data: specs },
        { data: vms },
        { data: images },
        { data: stocks },
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
        supabase.from("part_vehicle_models").select("vehicle_model_id, vehicle_models(*)").eq("part_id", copyFromId),
        supabase.from("part_images").select("*").eq("part_id", copyFromId).order("sort_order", { ascending: true }),
        supabase.from("part_stock_locations").select("*, warehouses(name)").eq("part_id", copyFromId),
      ]);

      if (partName) setSelectedPartName(partName);
      if (brand) setSelectedBrand({ id: brand.id, name: brand.name });
      if (supplier) setSelectedSupplier(supplier);
      if (specs) setSelectedSpecs(specs.map((s: any) => ({ id: s.specification_id, name: s.specifications?.name })).filter((s: any) => s.name));
      if (vms) setSelectedVehicleModels(vms.map((v: any) => ({ id: v.vehicle_model_id, name: v.vehicle_models?.name })).filter((v: any) => v.name));

      setDocNameQuery(part.document_name || "");
      setForm((prev) => ({
        ...prev,
        name: "",
        unit: part.unit || "件",
        categoryName: (Array.isArray(partName?.part_categories) ? partName?.part_categories[0]?.name : partName?.part_categories?.name) || "",
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
  }, [searchParams, supabase]);

  // Load edit data
  useEffect(() => {
    if (!editId) return;
    async function loadEditData() {
      setLoading(true);
      try {
        const { data: part } = await supabase.from("parts").select("*").eq("id", editId).single();
        if (!part) { alert("配件不存在"); router.push("/inventory"); return; }

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
          supabase.from("part_vehicle_models").select("vehicle_model_id, vehicle_models(brand, series, model_name, year_start, year_end, engine), notes").eq("part_id", editId),
          supabase.from("part_images").select("*").eq("part_id", editId).order("sort_order", { ascending: true }),
          supabase.from("part_stock_locations").select("*, warehouses(name)").eq("part_id", editId),
          supabase.from("part_special_prices").select("*, companies(name), customers(name, phone), vehicles(plate_number, vin)").eq("part_id", editId),
          supabase.from("part_vehicle_prices").select("*, vehicle_models(brand, series, model_name, year_start, year_end, engine)").eq("part_id", editId),
        ]);

        if (partName) {
          setSelectedPartName(partName);
          setPartNameQuery(partName.name);
        }
        if (brand) {
          setSelectedBrand({ id: brand.id, name: brand.name });
          setBrandQuery(brand.name);
        }
        if (supplier) {
          setSelectedSupplier(supplier);
          setSupplierQuery(supplier.name);
        }
        if (specs) {
          setSelectedSpecs(specs.map((s: any) => ({ id: s.specification_id, name: s.part_specifications?.name })).filter((s: any) => s.name));
        }
        if (vms) {
          setSelectedVehicleModels(vms.map((v: any) => {
            const vm = v.vehicle_models;
            const name = vm ? `${vm.brand} ${vm.series} ${vm.model_name || ""}`.trim() : "";
            return { id: v.vehicle_model_id, name, brand: vm?.brand, series: vm?.series, model_name: vm?.model_name, year_start: vm?.year_start, year_end: vm?.year_end, engine: vm?.engine, notes: v.notes || "" };
          }));
        }
        if (images) {
          setPartImages(images.map((img: any) => img.storage_path));
        }
        if (stocks && stocks.length > 0) {
          setStockLocations(stocks.map((s: any) => ({
            id: s.id,
            warehouseName: s.warehouses?.name || "",
            location: s.location || "",
            quantity: String(s.quantity || 0),
            min_stock: String(s.min_stock || 0),
            max_stock: s.max_stock ? String(s.max_stock) : "",
          })));
        }

        setPartNumber(part.part_number || "");
        setBarcode(part.barcode || "");
        setInterchangeCode(part.interchange_code || "");
        setDocNameQuery(part.document_name || "");
        setSystemCode(part.system_code || "");

        setForm({
          name: part.name || "",
          unit: part.unit || "件",
          categoryName: (Array.isArray(partName?.part_categories) ? partName?.part_categories[0]?.name : partName?.part_categories?.name) || "",
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
          setSpecialPrices(specialData.map((s: any) => ({
            id: s.id,
            company_id: s.company_id || undefined,
            company_name: s.companies?.name || undefined,
            customer_id: s.customer_id || undefined,
            customer_name: s.customers?.name || undefined,
            vehicle_id: s.vehicle_id || undefined,
            vehicle_name: s.vehicles ? `${s.vehicles.plate_number || ""}`.trim() : undefined,
            price: String(s.price),
          })));
        }

        if (vehiclePriceData) {
          setVehicleModelPrices(vehiclePriceData.map((v: any) => {
            const vm = v.vehicle_models;
            const name = vm ? `${vm.brand} ${vm.series} ${vm.model_name || ""}`.trim() : "";
            return {
              vehicle_model_id: v.vehicle_model_id,
              vehicle_name: name,
              brand: vm?.brand || "",
              series: vm?.series || "",
              model_name: vm?.model_name || "",
              year_start: vm?.year_start,
              year_end: vm?.year_end,
              engine: vm?.engine,
              sales_price: v.sales_price ? String(v.sales_price) : "",
              vip_price: v.vip_price ? String(v.vip_price) : "",
              standard_price: v.standard_price ? String(v.standard_price) : "",
            };
          }));
        }
      } catch (err: any) {
        alert("加载配件数据失败: " + (err.message || "未知错误"));
      } finally {
        setLoading(false);
      }
    }
    loadEditData();
  }, [editId, supabase, router]);


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
      // Escape — 取消（仅在无弹窗时生效）
      if (e.key === "Escape" && !vmModalOpen) {
        router.back();
        return;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSubmit, isEditMode, editId, searchParams, router, vmModalOpen]);

  // Load all warehouses for stock location selection
  useEffect(() => {
    async function loadWarehouses() {
      const { data } = await supabase.from('warehouses').select('id, name').order('name');
      setAllWarehouses(data || []);
    }
    loadWarehouses();
  }, [supabase]);


  // Part number debounced search
  useEffect(() => {
    if (pnTimeoutRef.current) clearTimeout(pnTimeoutRef.current);
    const value = partNumber.trim().toUpperCase();
    if (!value) {
      setPnResults(null);
      setPnSearching(false);
      return;
    }
    setPnSearching(true);
    pnTimeoutRef.current = setTimeout(async () => {
      let query = supabase
        .from("parts")
        .select("id, part_number, name")
        .ilike("part_number", `%${value}%`)
        .limit(5);
      if (editId) {
        query = query.neq("id", editId);
      }
      const { data } = await query;
      setPnResults(data || []);
      setPnSearching(false);
    }, 300);
    return () => {
      if (pnTimeoutRef.current) clearTimeout(pnTimeoutRef.current);
    };
  }, [partNumber, supabase, editId]);

  function handlePartNumberChange(value: string) {
    if (/[一-龥]/.test(value)) return;
    if (value.length > 20) return;
    setPartNumber(value.toUpperCase());
  }

  // Document name debounced search
  useEffect(() => {
    if (dnTimeoutRef.current) clearTimeout(dnTimeoutRef.current);
    const value = docNameQuery.trim();
    if (!value) {
      setDocNameResults(null);
      setDocNameSearching(false);
      return;
    }
    setDocNameSearching(true);
    dnTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("parts")
        .select("document_name")
        .not("document_name", "is", null)
        .ilike("document_name", "%" + value + "%")
        .limit(10);
      const names = Array.from(new Set((data || []).map((d: any) => d.document_name).filter(Boolean)));
      setDocNameResults(names as string[]);
      setDocNameSearching(false);
    }, 300);
    return () => {
      if (dnTimeoutRef.current) clearTimeout(dnTimeoutRef.current);
    };
  }, [docNameQuery, supabase]);

  // Supplier debounced search
  useEffect(() => {
    if (spTimeoutRef.current) clearTimeout(spTimeoutRef.current);
    const value = supplierQuery.trim();
    if (!value) {
      setSupplierResults(null);
      setSupplierSearching(false);
      return;
    }
    setSupplierSearching(true);
    spTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("id, name")
        .ilike("name", "%" + value + "%")
        .limit(10);
      setSupplierResults(data || []);
      setSupplierSearching(false);
    }, 300);
    return () => {
      if (spTimeoutRef.current) clearTimeout(spTimeoutRef.current);
    };
  }, [supplierQuery, supabase]);

  // Part name debounced search
  useEffect(() => {
    if (pnNameTimeoutRef.current) clearTimeout(pnNameTimeoutRef.current);
    const value = partNameQuery.trim();
    if (selectedPartName && value === selectedPartName.name) {
      setPartNameResults(null);
      setPartNameSearching(false);
      return;
    }
    if (!value) {
      setPartNameResults(null);
      setPartNameSearching(false);
      return;
    }
    setPartNameSearching(true);
    pnNameTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("part_names")
        .select(
          `id, name, unit, search_keywords,
           auto_link_vehicle_model, is_consumable,
           sales_commission_type, sales_commission_value,
           diagnosis_commission_type, diagnosis_commission_value,
           repair_commission_type, repair_commission_value,
           qc_commission_type, qc_commission_value,
           picking_commission_type, picking_commission_value,
           part_categories(id, name,
             auto_link_vehicle_model, is_consumable,
             sales_commission_type, sales_commission_value,
             diagnosis_commission_type, diagnosis_commission_value,
             repair_commission_type, repair_commission_value,
             qc_commission_type, qc_commission_value,
             picking_commission_type, picking_commission_value
           )`
        )
        .or(`name.ilike.%${value}%,search_keywords.ilike.%${value}%`)
        .order("name")
        .limit(10);
      setPartNameResults(data || []);
      setPartNameSearching(false);
    }, 300);
    return () => {
      if (pnNameTimeoutRef.current) clearTimeout(pnNameTimeoutRef.current);
    };
  }, [partNameQuery, supabase, selectedPartName]);

  function selectPartName(item: any) {
    setSelectedPartName(item);
    setPartNameQuery(item.name);
    setPartNameResults(null);

    // Supabase 嵌套查询可能返回对象或数组，统一处理为对象
    const rawCat = item.part_categories;
    const cat = Array.isArray(rawCat) ? (rawCat[0] || {}) : (rawCat || {});

    // 优先取配件名称自身的设置，如果没有则取分类设置
    // 注意：布尔字段使用 || 而非 ??，因为数据库默认值为 false，需要允许分类的 true 覆盖
    const autoLink = item.auto_link_vehicle_model || cat.auto_link_vehicle_model || false;
    const consumable = item.is_consumable || cat.is_consumable || false;

    const pick = (nameVal: any, catVal: any) =>
      nameVal !== null && nameVal !== undefined ? nameVal : catVal;

    setForm((prev) => ({
      ...prev,
      name: item.name,
      unit: item.unit || "件",
      categoryName: cat.name || "",
      auto_link_vehicle_model: autoLink,
      is_consumable: consumable,
      sales_type: pick(item.sales_commission_type, cat.sales_commission_type) || "",
      sales_value: pick(item.sales_commission_value, cat.sales_commission_value)?.toString() || "",
      diagnosis_type: pick(item.diagnosis_commission_type, cat.diagnosis_commission_type) || "",
      diagnosis_value: pick(item.diagnosis_commission_value, cat.diagnosis_commission_value)?.toString() || "",
      repair_type: pick(item.repair_commission_type, cat.repair_commission_type) || "",
      repair_value: pick(item.repair_commission_value, cat.repair_commission_value)?.toString() || "",
      qc_type: pick(item.qc_commission_type, cat.qc_commission_type) || "",
      qc_value: pick(item.qc_commission_value, cat.qc_commission_value)?.toString() || "",
      picking_type: pick(item.picking_commission_type, cat.picking_commission_type) || "",
      picking_value: pick(item.picking_commission_value, cat.picking_commission_value)?.toString() || "",
    }));
  }

  // Brand debounced search with priority
  useEffect(() => {
    if (brandTimeoutRef.current) clearTimeout(brandTimeoutRef.current);
    const value = brandQuery.trim();
    if (selectedBrand) {
      setBrandResults(null);
      setBrandSearching(false);
      return;
    }
    if (!brandFocus && !value) {
      setBrandResults(null);
      setBrandSearching(false);
      return;
    }
    setBrandSearching(true);
    brandTimeoutRef.current = setTimeout(async () => {
      let linked: any[] = [];
      let others: any[] = [];

      if (selectedPartName) {
        let linkedQuery = supabase
          .from("part_brands")
          .select("id, name, part_name_brands!inner(part_name_id)")
          .eq("part_name_brands.part_name_id", selectedPartName.id);
        if (value) {
          linkedQuery = linkedQuery.ilike("name", `%${value}%`);
        }
        const { data: linkedData } = await linkedQuery.limit(10);
        linked = (linkedData || []).map((b: any) => ({ id: b.id, name: b.name, linked: true }));
      }

      if (value) {
        const excludeIds = linked.map((b) => b.id);
        let otherQuery = supabase.from("part_brands").select("id, name").ilike("name", `%${value}%`);
        if (excludeIds.length > 0) otherQuery = otherQuery.not("id", "in", `(${excludeIds.join(",")})`);
        const { data: otherData } = await otherQuery.limit(10);
        others = (otherData || []).map((b: any) => ({ id: b.id, name: b.name, linked: false }));
      }

      setBrandResults([...linked, ...others]);
      setBrandSearching(false);
    }, 300);
    return () => {
      if (brandTimeoutRef.current) clearTimeout(brandTimeoutRef.current);
    };
  }, [brandQuery, selectedPartName, brandFocus, supabase, selectedBrand]);

  async function createBrandAndSelect() {
    const name = brandQuery.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("part_brands")
      .insert({ name })
      .select("id, name")
      .single();
    if (error || !data) {
      alert("创建品牌失败: " + (error?.message || "未知错误"));
      return;
    }
    setSelectedBrand({ id: data.id, name: data.name });
    setBrandQuery(data.name);
    setBrandResults(null);
    setHighlightedBrandIndex(-1);
    if (selectedPartName) {
      await supabase
        .from("part_name_brands")
        .insert({ part_name_id: selectedPartName.id, brand_id: data.id })
        .then(({ error }) => {
          if (error && !error.message.includes("duplicate")) console.error(error);
        });
    }
  }

  function selectBrand(item: any) {
    setSelectedBrand({ id: item.id, name: item.name });
    setBrandQuery(item.name);
    setBrandResults(null);
    setHighlightedBrandIndex(-1);
    if (selectedPartName && !item.linked) {
      supabase
        .from("part_name_brands")
        .insert({ part_name_id: selectedPartName.id, brand_id: item.id })
        .then(({ error }) => {
          if (error && !error.message.includes("duplicate")) console.error(error);
        });
    }
  }

  function removeBrand() {
    setSelectedBrand(null);
    setBrandQuery("");
    setHighlightedBrandIndex(-1);
  }

  // Specification debounced search (only linked to part name)
  useEffect(() => {
    if (specTimeoutRef.current) clearTimeout(specTimeoutRef.current);
    const value = specQuery.trim();
    if (!value || !selectedPartName) {
      setSpecResults(null);
      setSpecSearching(false);
      return;
    }
    setSpecSearching(true);
    specTimeoutRef.current = setTimeout(async () => {
      const { data: linkedData } = await supabase
        .from("part_specifications")
        .select("id, name, part_name_specifications!inner(part_name_id)")
        .ilike("name", `%${value}%`)
        .eq("part_name_specifications.part_name_id", selectedPartName.id)
        .limit(10);
      const linked = (linkedData || [])
        .map((s: any) => ({ id: s.id, name: s.name }))
        .filter((s: any) => !selectedSpecs.some((sel) => sel.id === s.id));

      setSpecResults(linked);
      setSpecSearching(false);
    }, 300);
    return () => {
      if (specTimeoutRef.current) clearTimeout(specTimeoutRef.current);
    };
  }, [specQuery, selectedPartName, selectedSpecs, supabase]);

  async function createSpecAndAdd() {
    const name = specQuery.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("part_specifications")
      .insert({ name })
      .select("id, name")
      .single();
    if (error || !data) {
      alert("创建规格失败: " + (error?.message || "未知错误"));
      return;
    }
    addSpec({ id: data.id, name: data.name });
    if (selectedPartName) {
      await supabase
        .from("part_name_specifications")
        .insert({ part_name_id: selectedPartName.id, specification_id: data.id })
        .then(({ error }) => {
          if (error && !error.message.includes("duplicate")) console.error(error);
        });
    }
  }

  function addSpec(item: LinkedItem) {
    if (selectedSpecs.some((s) => s.id === item.id)) return;
    setSelectedSpecs((prev) => [...prev, item]);
    setSpecQuery("");
    setSpecResults(null);
    setHighlightedSpecIndex(-1);
    setTimeout(() => document.getElementById("spec-input")?.focus(), 0);
    if (selectedPartName) {
      supabase
        .from("part_name_specifications")
        .insert({ part_name_id: selectedPartName.id, specification_id: item.id })
        .then(({ error }) => {
          if (error && !error.message.includes("duplicate")) console.error(error);
        });
    }
  }

  function removeSpec(id: string) {
    setSelectedSpecs((prev) => prev.filter((s) => s.id !== id));
  }



  // Special pricing - company search
  useEffect(() => {
    if (spCompanyTimeoutRef.current) clearTimeout(spCompanyTimeoutRef.current);
    const value = spCompanyQuery.trim();
    if (!value) { setSpCompanyResults([]); setSpCompanySearching(false); return; }
    setSpCompanySearching(true);
    spCompanyTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase.from('companies').select('id, name').ilike('name', '%' + value + '%').limit(10);
      setSpCompanyResults(data || []);
      setSpCompanySearching(false);
    }, 300);
    return () => { if (spCompanyTimeoutRef.current) clearTimeout(spCompanyTimeoutRef.current); };
  }, [spCompanyQuery, supabase]);

  // Special pricing - customer search
  useEffect(() => {
    if (spCustomerTimeoutRef.current) clearTimeout(spCustomerTimeoutRef.current);
    const value = spCustomerQuery.trim();
    if (!value) { setSpCustomerResults([]); setSpCustomerSearching(false); return; }
    setSpCustomerSearching(true);
    spCustomerTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase.from('customers').select('id, name, phone').or('name.ilike.%' + value + '%,phone.ilike.%' + value + '%').limit(10);
      setSpCustomerResults(data || []);
      setSpCustomerSearching(false);
    }, 300);
    return () => { if (spCustomerTimeoutRef.current) clearTimeout(spCustomerTimeoutRef.current); };
  }, [spCustomerQuery, supabase]);

  // Special pricing - vehicle search
  useEffect(() => {
    if (spVehicleTimeoutRef.current) clearTimeout(spVehicleTimeoutRef.current);
    const value = spVehicleQuery.trim();
    if (!value) { setSpVehicleResults([]); setSpVehicleSearching(false); return; }
    setSpVehicleSearching(true);
    spVehicleTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('id, plate_number, brand, model, vin, customers(name)')
        .or('plate_number.ilike.%' + value + '%,vin.ilike.%' + value + '%,brand.ilike.%' + value + '%,model.ilike.%' + value + '%')
        .limit(10);
      setSpVehicleResults(data || []);
      setSpVehicleSearching(false);
    }, 300);
    return () => { if (spVehicleTimeoutRef.current) clearTimeout(spVehicleTimeoutRef.current); };
  }, [spVehicleQuery, supabase]);

  // Vehicle model pricing search
  useEffect(() => {
    if (vmPriceTimeoutRef.current) clearTimeout(vmPriceTimeoutRef.current);
    const value = vmPriceQuery.trim();
    if (!value) { setVmPriceResults([]); setVmPriceSearching(false); return; }
    setVmPriceSearching(true);
    vmPriceTimeoutRef.current = setTimeout(async () => {
      const excludeIds = vehicleModelPrices.map((v) => v.vehicle_model_id);
      let query = supabase
        .from('vehicle_models')
        .select('id, brand, series, model_name, year_start, year_end, engine')
        .or('brand.ilike.%' + value + '%,series.ilike.%' + value + '%,model_name.ilike.%' + value + '%')
        .limit(10);
      if (excludeIds.length > 0) query = query.not('id', 'in', '(' + excludeIds.join(',') + ')');
      const { data } = await query;
      setVmPriceResults(data || []);
      setVmPriceSearching(false);
    }, 300);
    return () => { if (vmPriceTimeoutRef.current) clearTimeout(vmPriceTimeoutRef.current); };
  }, [vmPriceQuery, vehicleModelPrices, supabase]);

  // Vehicle model modal search
  useEffect(() => {
    if (!vmModalOpen) return;
    setVmModalLoading(true);
    const timer = setTimeout(async () => {
      const value = vmModalQuery.trim();
      const excludeIds = selectedVehicleModels.map((v) => v.id);
      let query = supabase
        .from('vehicle_models')
        .select('id, brand, series, model_name, year_start, year_end, engine')
        .order('brand')
        .order('series')
        .limit(100);
      if (value) {
        query = query.or(`brand.ilike.%${value}%,series.ilike.%${value}%,model_name.ilike.%${value}%`);
      }
      if (excludeIds.length > 0) {
        query = query.not('id', 'in', `(${excludeIds.join(',')})`);
      }
      const { data } = await query;
      setVmModalList(data || []);
      setVmModalLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [vmModalOpen, vmModalQuery, selectedVehicleModels, supabase]);

  function removeVehicleModel(id: string) {
    setSelectedVehicleModels((prev) => prev.filter((v) => v.id !== id));
    setCheckedVehicleModelIds((prev) => prev.filter((vid) => vid !== id));
  }

  function batchRemoveVehicleModels() {
    setSelectedVehicleModels((prev) => prev.filter((v) => !checkedVehicleModelIds.includes(v.id)));
    setCheckedVehicleModelIds([]);
  }

  function updateVehicleModelNotes(id: string, notes: string) {
    setSelectedVehicleModels((prev) => prev.map((v) => (v.id === id ? { ...v, notes } : v)));
  }

  // Vehicle model modal helpers
  function openVmModal() {
    setVmModalOpen(true);
    setVmModalQuery('');
    setVmModalSelected(new Set());
  }

  function toggleVmModalSelection(id: string) {
    setVmModalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmVmModal() {
    const selected = vmModalList.filter((v) => vmModalSelected.has(v.id));
    const newItems = selected
      .filter((v) => !selectedVehicleModels.some((existing) => String(existing.id) === String(v.id)))
      .map((v) => {
        const name = v.model_name ? `${v.brand} ${v.series} ${v.model_name}` : `${v.brand} ${v.series}`;
        return {
          id: v.id,
          name,
          brand: v.brand,
          series: v.series,
          model_name: v.model_name,
          year_start: v.year_start,
          year_end: v.year_end,
          engine: v.engine,
          notes: '',
        };
      });
    setSelectedVehicleModels((prev) => [...prev, ...newItems]);
    setVmModalOpen(false);
  }

  // Stock locations helpers
  function updateStockLocation(id: string, field: keyof StockLocationRow, value: string) {
    setStockLocations((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }


  async function loadLocationsForWarehouse(warehouseName: string) {
    const wh = allWarehouses.find((w) => w.name === warehouseName);
    if (!wh || warehouseLocationMap[wh.id]) return;
    const { data } = await supabase.from('warehouse_locations').select('*').eq('warehouse_id', wh.id).order('name');
    setWarehouseLocationMap((prev) => ({ ...prev, [wh.id]: data || [] }));
  }

  async function createNewLocation(warehouseName: string, locationName: string) {
    const wh = allWarehouses.find((w) => w.name === warehouseName);
    if (!wh) { alert('请先选择仓库'); return; }
    if (!locationName.trim()) return;
    const name = locationName.trim().toUpperCase().replace(/[^一-龥A-Z0-9-]/g, '');
    if (!name) { alert('仓位名称只能包含中文、英文、数字和-'); return; }
    const { error } = await supabase.from('warehouse_locations').insert({ warehouse_id: wh.id, name });
    if (error) { alert('创建仓位失败：' + error.message); return; }
    await loadLocationsForWarehouse(warehouseName);
  }


  function addStockLocation() {
    setStockLocations((prev) => [...prev, { id: crypto.randomUUID(), warehouseName: "", location: "", quantity: "0", min_stock: "0", max_stock: "" }]);
  }

  function removeStockLocation(id: string) {
    setStockLocations((prev) => prev.filter((row) => row.id !== id));
  }

  // Special pricing helpers
  function addSpecialPrice() {
    const company = spCompanySelected;
    const customer = spCustomerSelected;
    const vehicle = spVehicleSelected;
    const price = parseFloat(spNewPrice);

    if (!company && !customer && !vehicle) {
      alert('请至少选择单位、客户或车辆中的一个');
      return;
    }
    if (!price || price <= 0) {
      alert('请输入有效的价格');
      return;
    }
    // Check for exact same combination
    const duplicate = specialPrices.some((p) =>
      p.company_id === (company?.id || undefined) &&
      p.customer_id === (customer?.id || undefined) &&
      p.vehicle_id === (vehicle?.id || undefined)
    );
    if (duplicate) { alert('该组合已存在'); return; }

    const item: SpecialPriceItem = {
      id: crypto.randomUUID(),
      price: spNewPrice,
    };
    if (company) { item.company_id = company.id; item.company_name = company.name; }
    if (customer) { item.customer_id = customer.id; item.customer_name = customer.name; }
    if (vehicle) { item.vehicle_id = vehicle.id; item.vehicle_name = vehicle.name; }

    setSpecialPrices((prev) => [...prev, item]);
    setSpCompanySelected(null);
    setSpCompanyQuery('');
    setSpCustomerSelected(null);
    setSpCustomerQuery('');
    setSpVehicleSelected(null);
    setSpVehicleQuery('');
    setSpNewPrice('');
  }

  function removeSpecialPrice(id: string) {
    setSpecialPrices((prev) => prev.filter((p) => p.id !== id));
  }

  // Vehicle model pricing helpers
  function addVehicleModelPrice() {
    if (!vmPriceSelected) { alert('请选择车型'); return; }
    const salesVal = parseFloat(vmNewSalesPrice);
    if (!vmNewSalesPrice || isNaN(salesVal) || salesVal <= 0) {
      alert('销售价为必填项，请输入有效的价格');
      return;
    }
    if (vehicleModelPrices.some((p) => p.vehicle_model_id === vmPriceSelected.id)) {
      alert('该车型已存在');
      return;
    }
    setVehicleModelPrices((prev) => [...prev, {
      vehicle_model_id: vmPriceSelected.id,
      vehicle_name: vmPriceSelected.name,
      brand: vmPriceSelected.brand,
      series: vmPriceSelected.series,
      model_name: vmPriceSelected.model_name,
      year_start: vmPriceSelected.year_start,
      year_end: vmPriceSelected.year_end,
      engine: vmPriceSelected.engine,
      sales_price: vmNewSalesPrice,
      vip_price: vmNewVipPrice,
      standard_price: vmNewStandardPrice,
    }]);
    setVmPriceSelected(null);
    setVmPriceQuery('');
    setVmNewSalesPrice('');
    setVmNewVipPrice('');
    setVmNewStandardPrice('');
  }

  function removeVehicleModelPrice(vehicleModelId: string) {
    setVehicleModelPrices((prev) => prev.filter((p) => p.vehicle_model_id !== vehicleModelId));
  }

  function removeVehicleModelPriceGroup(salesPrice: string, vipPrice: string, standardPrice: string) {
    setVehicleModelPrices((prev) => prev.filter((p) =>
      p.sales_price !== salesPrice || p.vip_price !== vipPrice || p.standard_price !== standardPrice
    ));
  }


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
    const duplicateExists = pnResults && pnResults.some((r) => r.part_number.toUpperCase() === partNumber.trim().toUpperCase() && r.id !== editId);
    if (duplicateExists) {
      alert("该配件编码已存在，请更换");
      return;
    }

    setLoading(true);

    const documentName = docNameQuery.trim() || null;
    const supplierId = selectedSupplier?.id || null;

    let partId = editId;

    if (isEditMode) {
      const { error: updateError } = await supabase
        .from("parts")
        .update({
          part_number: partNumber.trim().toUpperCase(),
          barcode: barcode.trim() || null,
          interchange_code: interchangeCode.trim().toUpperCase() || null,
          document_name: documentName,
          part_name_id: selectedPartName.id,
          name: form.name.trim(),
          brand_id: selectedBrand?.id || null,
          category_id: selectedPartName.part_categories?.id || null,
          unit: form.unit || "件",
          quantity: totalQuantity,
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
          is_consumable: form.is_consumable,
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
        })
        .eq("id", editId);

      if (updateError) {
        alert("保存失败: " + updateError.message);
        setLoading(false);
        return;
      }

      // Delete existing related data
      await supabase.from("parts_specifications").delete().eq("part_id", editId);
      await supabase.from("part_vehicle_models").delete().eq("part_id", editId);
      await supabase.from("part_images").delete().eq("part_id", editId);
      await supabase.from("part_stock_locations").delete().eq("part_id", editId);
      await supabase.from("part_special_prices").delete().eq("part_id", editId);
      await supabase.from("part_vehicle_prices").delete().eq("part_id", editId);
    } else {
      // 新建模式：重新生成系统码以确保唯一性
      let finalSystemCode = systemCode;
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
        setSystemCode(finalSystemCode);
      } else {
        // 检查当前系统码是否已被占用
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
          setSystemCode(finalSystemCode);
        }
      }

      const { data: inserted, error } = await supabase
        .from("parts")
        .insert({
        system_code: finalSystemCode,
        part_number: partNumber.trim().toUpperCase(),
        barcode: barcode.trim() || null,
        interchange_code: interchangeCode.trim().toUpperCase() || null,
        document_name: documentName,
        part_name_id: selectedPartName.id,
        name: form.name.trim(),
        brand_id: selectedBrand?.id || null,
        category_id: selectedPartName.part_categories?.id || null,
        unit: form.unit || "件",
        quantity: totalQuantity,
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
        is_consumable: form.is_consumable,
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
      })
      .select("id")
      .single();

    if (error || !inserted) {
      alert("保存失败: " + (error?.message || "未知错误"));
      setLoading(false);
      return;
    }

    partId = inserted.id;
    }

    // Insert specifications
    if (selectedSpecs.length > 0) {
      await supabase
        .from("parts_specifications")
        .insert(selectedSpecs.map((s) => ({ part_id: partId, specification_id: s.id })));
    }

    // Insert vehicle models
    if (selectedVehicleModels.length > 0) {
      await supabase
        .from("part_vehicle_models")
        .insert(selectedVehicleModels.map((v) => ({ part_id: partId, vehicle_model_id: v.id, notes: v.notes || null })));
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
      // Get or create warehouses
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

    // Save special prices (unified: company/customer/vehicle)
    if (specialPrices.length > 0) {
      const { error: spError } = await supabase.from('part_special_prices').insert(
        specialPrices.map((p) => ({
          part_id: partId,
          company_id: p.company_id || null,
          customer_id: p.customer_id || null,
          vehicle_id: p.vehicle_id || null,
          price: parseFloat(p.price),
        }))
      );
      if (spError) console.error('part_special_prices insert error:', spError);
    }

    // Save vehicle model prices (three prices)
    if (vehicleModelPrices.length > 0) {
      const { error: vpError } = await supabase.from('part_vehicle_prices').insert(
        vehicleModelPrices.map((p) => ({
          part_id: partId,
          vehicle_model_id: p.vehicle_model_id,
          sales_price: p.sales_price ? parseFloat(p.sales_price) : null,
          vip_price: p.vip_price ? parseFloat(p.vip_price) : null,
          standard_price: p.standard_price ? parseFloat(p.standard_price) : null,
        }))
      );
      if (vpError) console.error('part_vehicle_prices insert error:', vpError);
    }

    if (isEditMode) {
      router.push(`/parts/${editId}`);
    } else {
      router.push('/inventory');
    }
    router.refresh();
  }

  const hasDuplicatePartNumber =
    pnResults !== null && pnResults.some((r) => r.part_number.toUpperCase() === partNumber.trim().toUpperCase() && r.id !== editId);

  function CommissionField({
    label,
    typeValue,
    valueValue,
    onTypeChange,
    onValueChange,
  }: {
    label: string;
    typeValue: string;
    valueValue: string;
    onTypeChange: (v: string) => void;
    onValueChange: (v: string) => void;
  }) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">{label}方式</label>
          <select
            className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            value={typeValue}
            onChange={(e) => onTypeChange(e.target.value)}
          >
            <option value="">无提成</option>
            <option value="revenue_pct">按产值(%)</option>
            <option value="profit_pct">按毛利(%)</option>
            <option value="fixed">固定金额</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{label}数值</label>
          <input
            type="number"
            className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            value={valueValue}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={!typeValue}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isEditMode ? "编辑配件" : searchParams.get("copy_from") ? "复制添加配件" : "新增配件"}
        description={searchParams.get("copy_from") ? "已带入原配件信息，请修改不允许重复的内容后保存" : undefined}
      />

      <form onSubmit={handleSubmit} className="max-w-6xl relative space-y-6">
          {/* 基础信息 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 relative">
            <div className="absolute top-4 left-6">
              <span className="text-xs text-gray-400 font-mono tracking-wider select-none">{systemCode || ""}</span>
            </div>

        {/* Row 1: Part number + Barcode + Interchange code */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 mt-2">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              配件编码 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              maxLength={20}
              placeholder="输入编码（大写英文、数字、符号，不含中文）"
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-sm ${
                hasDuplicatePartNumber
                  ? "border-red-300 focus:ring-red-500 bg-red-50"
                  : "border-gray-300 focus:ring-blue-500"
              }`}
              value={partNumber}
              onChange={(e) => handlePartNumberChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  document.getElementById("part-name-input")?.focus();
                }
              }}
            />
            {pnSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
            {!pnSearching && pnResults !== null && pnResults.length > 0 && (
              <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600 font-medium mb-1">以下配件编码与输入匹配，请避免重复：</p>
                <div className="space-y-1">
                  {pnResults.map((r) => (
                    <div key={r.id} className="text-sm text-red-700">
                      {r.part_number} — {r.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!pnSearching && pnResults !== null && pnResults.length === 0 && partNumber.trim().length > 0 && (
              <div className="mt-1 text-xs text-green-600">该编码可用</div>
            )}
          </div>

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
        </div>

        {/* Row 2: Part name + Document name + Unit + Category */}
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-4 mb-4">
          <div className="relative sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              配件名称 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="part-name-input"
                type="text"
                placeholder="输入名称或关键词检索"
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-sm ${
                  selectedPartName
                    ? "border-green-300 focus:ring-green-500 bg-green-50"
                    : "border-gray-300 focus:ring-blue-500"
                }`}
                value={partNameQuery}
                onChange={(e) => {
                  const val = e.target.value;
                  setPartNameQuery(val);
                  setHighlightedNameIndex(-1);
                  if (selectedPartName && val !== selectedPartName.name) {
                    setSelectedPartName(null);
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
                }}
                onBlur={() => setTimeout(() => setPartNameResults(null), 200)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightedNameIndex((prev) => {
                      const next = prev + 1;
                      return partNameResults && next < partNameResults.length ? next : prev;
                    });
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightedNameIndex((prev) => (prev > 0 ? prev - 1 : prev));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (partNameResults && highlightedNameIndex >= 0 && highlightedNameIndex < partNameResults.length) {
                      selectPartName(partNameResults[highlightedNameIndex]);
                      setHighlightedNameIndex(-1);
                      document.getElementById("document-name-input")?.focus();
                    } else if (partNameResults && partNameResults.length > 0) {
                      selectPartName(partNameResults[0]);
                      setHighlightedNameIndex(-1);
                      document.getElementById("document-name-input")?.focus();
                    }
                  } else if (e.key === "Escape") {
                    setPartNameResults(null);
                    setHighlightedNameIndex(-1);
                  }
                }}
              />
              {selectedPartName && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
                  已选
                </span>
              )}
              {partNameSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
              {partNameResults && partNameResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {partNameResults.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        selectPartName(item);
                        setHighlightedNameIndex(-1);
                        document.getElementById("document-name-input")?.focus();
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 ${
                        highlightedNameIndex === index ? "bg-blue-50" : ""
                      }`}
                    >
                      <div className="font-medium text-gray-900">{item.name}</div>
                      <div className="text-xs text-gray-400">
                        {item.part_categories?.name || "-"} · {item.unit || "件"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!partNameSearching && partNameQuery.trim() && partNameResults !== null && partNameResults.length === 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  未找到匹配名称，请先前往{" "}
                  <a href="/part-names/new" target="_blank" className="text-blue-600 hover:underline">
                    名称库
                  </a>{" "}
                  新建
                </div>
              )}
            </div>
          </div>

          <div className="relative sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">单据名称</label>
            <div className="relative">
              <input
                id="document-name-input"
                type="text"
                placeholder="输入采购单上的配件名称，可直接输入或从历史调用"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={docNameQuery}
                onChange={(e) => setDocNameQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("brand-input")?.focus();
                  }
                }}
              />
              {docNameSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
              {docNameResults && docNameResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {docNameResults.map((name, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setDocNameQuery(name);
                        setDocNameResults(null);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

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
          {/* Brand search — always input */}
          <div className="col-span-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
          <div className="relative">
            <input
              id="brand-input"
              type="text"
              placeholder="搜索品牌（优先显示已关联该配件名称的品牌）"
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-sm ${
                selectedBrand ? "border-green-300 focus:ring-green-500 bg-green-50" : "border-gray-300 focus:ring-blue-500"
              }`}
              value={brandQuery}
              onChange={(e) => {
                const val = e.target.value;
                setBrandQuery(val);
                setHighlightedBrandIndex(-1);
                if (selectedBrand && val !== selectedBrand.name) {
                  setSelectedBrand(null);
                }
              }}
              onFocus={() => setBrandFocus(true)}
              onBlur={() => setTimeout(() => setBrandFocus(false), 200)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightedBrandIndex((prev) => {
                    const next = prev + 1;
                    return brandResults && next < brandResults.length ? next : prev;
                  });
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightedBrandIndex((prev) => (prev > 0 ? prev - 1 : prev));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (brandResults && highlightedBrandIndex >= 0 && highlightedBrandIndex < brandResults.length) {
                    selectBrand(brandResults[highlightedBrandIndex]);
                  } else if (brandResults && brandResults.length > 0) {
                    selectBrand(brandResults[0]);
                  }
                  setTimeout(() => document.getElementById("spec-input")?.focus(), 0);
                } else if (e.key === "Escape") {
                  setBrandResults(null);
                  setHighlightedBrandIndex(-1);
                } else if (e.key === "Tab") {
                  setBrandResults(null);
                  setHighlightedBrandIndex(-1);
                }
              }}
            />
            {selectedBrand && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
                已选
              </span>
            )}
            {brandSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
            {brandResults && brandResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {brandResults.map((b, index) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => selectBrand(b)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 flex items-center justify-between ${
                      highlightedBrandIndex === index ? "bg-blue-50" : ""
                    }`}
                  >
                    <span>{b.name}</span>
                    {b.linked && (
                      <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">已关联</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {!brandSearching && brandQuery.trim() && brandResults !== null && brandResults.length === 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={createBrandAndSelect}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  新建品牌「{brandQuery.trim()}」并选择
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Specifications search (multiple) */}
        <div className="col-span-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">规格（可添加多个）</label>
          <div className="relative">
            <input
              id="spec-input"
              type="text"
              placeholder="搜索规格（优先显示已关联该配件名称的规格）"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={specQuery}
              onChange={(e) => {
                setSpecQuery(e.target.value);
                setHighlightedSpecIndex(-1);
              }}
              onBlur={() => setTimeout(() => setSpecResults(null), 200)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightedSpecIndex((prev) => {
                    const next = prev + 1;
                    return specResults && next < specResults.length ? next : prev;
                  });
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightedSpecIndex((prev) => (prev > 0 ? prev - 1 : prev));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (specResults && highlightedSpecIndex >= 0 && highlightedSpecIndex < specResults.length) {
                    addSpec(specResults[highlightedSpecIndex]);
                  } else if (specResults && specResults.length > 0) {
                    addSpec(specResults[0]);
                  }
                } else if (e.key === "Escape") {
                  setSpecResults(null);
                  setHighlightedSpecIndex(-1);
                } else if (e.key === "Tab") {
                  setSpecResults(null);
                  setHighlightedSpecIndex(-1);
                  setTimeout(() => document.getElementById("purchase-price-input")?.focus(), 0);
                }
              }}
            />
            {specSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
            {specResults && specResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {specResults.map((s, index) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addSpec(s)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 flex items-center justify-between ${
                      highlightedSpecIndex === index ? "bg-blue-50" : ""
                    }`}
                  >
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            )}
            {!specSearching && specQuery.trim() && specResults !== null && specResults.length === 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={createSpecAndAdd}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  新建规格「{specQuery.trim()}」并添加
                </button>
              </div>
            )}
          </div>
          {selectedSpecs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedSpecs.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-200"
                >
                  {s.name}
                  <button
                    type="button"
                    onClick={() => removeSpec(s.id)}
                    className="text-blue-400 hover:text-blue-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        </div>

        {/* 价格信息 */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">价格信息</h3>

          {/* 采购价 + 参考进价 + 报价供应商 + 查看采购记录 */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">采购价</label>
              <input
                id="purchase-price-input"
                type="number"
                min={0}
                step={0.01}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.purchase_price}
                onChange={(e) => setForm((prev) => ({ ...prev, purchase_price: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("sales-price-input")?.focus();
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">参考进价</label>
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="历史平均进价"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.reference_purchase_price}
                onChange={(e) => setForm((prev) => ({ ...prev, reference_purchase_price: e.target.value }))}
              />
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">报价供应商</label>
              {selectedSupplier ? (
                <div className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50">
                  <span className="text-sm text-gray-900">{selectedSupplier.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSupplier(null);
                      setSupplierQuery("");
                    }}
                    className="text-gray-400 hover:text-gray-600 text-xs"
                  >
                    更换
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="搜索供应商"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={supplierQuery}
                    onChange={(e) => setSupplierQuery(e.target.value)}
                  />
                  {supplierSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
                  {supplierResults && supplierResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {supplierResults.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedSupplier(s);
                            setSupplierQuery("");
                            setSupplierResults(null);
                          }}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={() => alert("采购记录功能开发中")}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                查看采购记录
              </button>
            </div>
          </div>

          {/* 销售价、单位价、VIP价、批发价 */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">销售价</label>
              <input
                id="sales-price-input"
                type="number"
                min={0}
                step={0.01}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.unit_price}
                onChange={(e) => setForm((prev) => ({ ...prev, unit_price: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("standard-price-input")?.focus();
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">单位价</label>
              <input
                id="standard-price-input"
                type="number"
                min={0}
                step={0.01}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.standard_price}
                onChange={(e) => setForm((prev) => ({ ...prev, standard_price: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("vip-price-input")?.focus();
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">VIP价</label>
              <input
                id="vip-price-input"
                type="number"
                min={0}
                step={0.01}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.vip_price}
                onChange={(e) => setForm((prev) => ({ ...prev, vip_price: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("wholesale-price-input")?.focus();
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">批发价</label>
              <input
                id="wholesale-price-input"
                type="number"
                min={0}
                step={0.01}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.wholesale_price}
                onChange={(e) => setForm((prev) => ({ ...prev, wholesale_price: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

        {/* 分类属性与提成 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">分类属性与提成（选择配件名称后自动带入，可修改）</h3>
          <div className="flex gap-6 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.auto_link_vehicle_model}
                onChange={(e) => setForm((prev) => ({ ...prev, auto_link_vehicle_model: e.target.checked }))}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">自动关联车型</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_consumable}
                onChange={(e) => setForm((prev) => ({ ...prev, is_consumable: e.target.checked }))}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">耗材（出库不计入营业额）</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CommissionField
              label="销售提成"
              typeValue={form.sales_type}
              valueValue={form.sales_value}
              onTypeChange={(v) => setForm((prev) => ({ ...prev, sales_type: v as any, sales_value: v ? prev.sales_value : "" }))}
              onValueChange={(v) => setForm((prev) => ({ ...prev, sales_value: v }))}
            />
            <CommissionField
              label="诊断提成"
              typeValue={form.diagnosis_type}
              valueValue={form.diagnosis_value}
              onTypeChange={(v) => setForm((prev) => ({ ...prev, diagnosis_type: v as any, diagnosis_value: v ? prev.diagnosis_value : "" }))}
              onValueChange={(v) => setForm((prev) => ({ ...prev, diagnosis_value: v }))}
            />
            <CommissionField
              label="施工提成"
              typeValue={form.repair_type}
              valueValue={form.repair_value}
              onTypeChange={(v) => setForm((prev) => ({ ...prev, repair_type: v as any, repair_value: v ? prev.repair_value : "" }))}
              onValueChange={(v) => setForm((prev) => ({ ...prev, repair_value: v }))}
            />
            <CommissionField
              label="质检提成"
              typeValue={form.qc_type}
              valueValue={form.qc_value}
              onTypeChange={(v) => setForm((prev) => ({ ...prev, qc_type: v as any, qc_value: v ? prev.qc_value : "" }))}
              onValueChange={(v) => setForm((prev) => ({ ...prev, qc_value: v }))}
            />
            <CommissionField
              label="领料提成"
              typeValue={form.picking_type}
              valueValue={form.picking_value}
              onTypeChange={(v) => setForm((prev) => ({ ...prev, picking_type: v as any, picking_value: v ? prev.picking_value : "" }))}
              onValueChange={(v) => setForm((prev) => ({ ...prev, picking_value: v }))}
            />
          </div>
        </div>

        {/* 库存分布 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">库存分布</h3>
          <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">库存分布</label>
            <span className="text-xs text-gray-500">
              合计库存：<span className="font-medium text-gray-900">{totalQuantity}</span>
            </span>
          </div>
          <div className="space-y-2">
            {stockLocations.map((row) => {
              const wh = allWarehouses.find((w) => w.name === row.warehouseName);
              const whResults = whResultsMap[row.id] || allWarehouses.filter((w) => w.name.toLowerCase().includes(row.warehouseName.toLowerCase()));
              const locList = wh ? (warehouseLocationMap[wh.id] || []) : [];
              const locResults = locList.filter((l) => l.name.toLowerCase().includes(row.location.toLowerCase()));
              const showWhDropdown = row.warehouseName && whResults.length > 0 && (!wh || wh.name !== row.warehouseName);
              const showLocDropdown = wh && row.location && locResults.length > 0;
              const showNewLoc = wh && row.location.trim() && locResults.length === 0;
              return (
                <div key={row.id} className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-start">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="搜索仓库"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                      value={row.warehouseName}
                      onChange={(e) => {
                        updateStockLocation(row.id, "warehouseName", e.target.value);
                        setWhResultsMap((prev) => ({ ...prev, [row.id]: allWarehouses.filter((w) => w.name.toLowerCase().includes(e.target.value.toLowerCase())) }));
                      }}
                      onBlur={() => setTimeout(() => setWhResultsMap((prev) => { const next = { ...prev }; delete next[row.id]; return next; }), 200)}
                    />
                    {showWhDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                        {whResults.slice(0, 5).map((w) => (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => {
                              updateStockLocation(row.id, "warehouseName", w.name);
                              updateStockLocation(row.id, "location", "");
                              loadLocationsForWarehouse(w.name);
                              setWhResultsMap((prev) => { const next = { ...prev }; delete next[row.id]; return next; });
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                          >
                            {w.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="搜索仓位"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                      value={row.location}
                      onChange={(e) => updateStockLocation(row.id, "location", e.target.value)}
                      onFocus={() => { if (row.warehouseName) loadLocationsForWarehouse(row.warehouseName); }}
                      onBlur={() => setTimeout(() => setLocResultsMap((prev) => { const next = { ...prev }; delete next[row.id]; return next; }), 200)}
                    />
                    {showLocDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                        {locResults.slice(0, 5).map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => {
                              updateStockLocation(row.id, "location", l.name);
                              setLocResultsMap((prev) => { const next = { ...prev }; delete next[row.id]; return next; });
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                          >
                            {l.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {showNewLoc && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                        <button
                          type="button"
                          onClick={() => createNewLocation(row.warehouseName, row.location)}
                          className="w-full text-left px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
                        >
                          + 新建仓位 "{row.location}"
                        </button>
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    min={0}
                    placeholder="数量"
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                    value={row.quantity}
                    onChange={(e) => updateStockLocation(row.id, "quantity", e.target.value)}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="安全下限"
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                    value={row.min_stock}
                    onChange={(e) => updateStockLocation(row.id, "min_stock", e.target.value)}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="安全上限"
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                    value={row.max_stock}
                    onChange={(e) => updateStockLocation(row.id, "max_stock", e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    {stockLocations.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStockLocation(row.id)}
                        className="px-3 py-2 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addStockLocation}
            className="mt-2 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
          >
            + 添加仓位
          </button>
        </div>

        {/* 安全库存 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">安全库存（总数）</label>
          <input
            type="number"
            min={0}
            className="w-full sm:w-1/3 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={form.min_stock}
            onChange={(e) => setForm((prev) => ({ ...prev, min_stock: e.target.value }))}
          />
        </div>

        {/* 备注与图片 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </div>

        {/* 图片上传 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">配件图片</label>
          <ImageUploader
            onUpload={(paths) => setPartImages(paths)}
            existingImages={partImages}
            maxImages={5}
            bucket="work-order-media"
            folder="part-images"
          />
        </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">适用车型</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openVmModal}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                添加
              </button>
              {checkedVehicleModelIds.length > 0 && (
                <button
                  type="button"
                  onClick={batchRemoveVehicleModels}
                  className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
                >
                  批量删除 ({checkedVehicleModelIds.length})
                </button>
              )}
            </div>
          </div>
            {selectedVehicleModels.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5"
                        checked={checkedVehicleModelIds.length > 0 && checkedVehicleModelIds.length === selectedVehicleModels.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setCheckedVehicleModelIds(selectedVehicleModels.map((v) => v.id));
                          } else {
                            setCheckedVehicleModelIds([]);
                          }
                        }}
                      />
                      <span>全选</span>
                    </label>
                    <span>共 {selectedVehicleModels.length} 个车型</span>
                  </div>
                </div>
                {selectedVehicleModels.map((v) => (
                  <div key={v.id} className="bg-gray-50 rounded px-2 py-1.5 text-xs">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 mt-0.5 shrink-0"
                          checked={checkedVehicleModelIds.includes(v.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCheckedVehicleModelIds((prev) => [...prev, v.id]);
                            } else {
                              setCheckedVehicleModelIds((prev) => prev.filter((id) => id !== v.id));
                            }
                          }}
                        />
                        <div className="flex-1 min-w-0 text-gray-700">
                          <span className="text-gray-500">ID:{String(v.id).slice(0,8)}</span>
                          <span className="text-gray-400 mx-1">·</span>
                          {v.brand} {v.series} {v.model_name}
                          {v.year_start && (
                            <span className="text-gray-400 ml-0.5">{v.year_start}{v.year_end && v.year_end !== v.year_start ? `-${v.year_end}` : ''}款</span>
                          )}
                          {v.engine && (
                            <>
                              <span className="text-gray-400 mx-1">·</span>
                              <span className="text-gray-500">发动机:{v.engine}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeVehicleModel(v.id)}
                        className="text-purple-400 hover:text-purple-600 ml-1 shrink-0"
                      >
                        删除
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-1 pl-5">
                      <span className="text-gray-400">备注:</span>
                      <input
                        type="text"
                        placeholder="可选"
                        className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                        value={v.notes || ''}
                        onChange={(e) => updateVehicleModelNotes(v.id, e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedVehicleModels.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-4">暂未关联车型</div>
            )}
          </div>
        </div>

        {/* 特殊价格 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">特殊价格</h3>

            {/* 指定用户价格 */}
            <div className="mb-6">
              <h4 className="text-xs font-medium text-gray-500 mb-3">指定用户价格</h4>
              <div className="flex gap-2 items-end flex-wrap mb-3">
                <div className="relative flex-1 min-w-[140px]">
                  <label className="block text-xs text-gray-500 mb-1">单位（可选）</label>
                  <input
                    type="text"
                    placeholder="搜索单位..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={spCompanySelected ? spCompanySelected.name : spCompanyQuery}
                    onChange={(e) => { setSpCompanyQuery(e.target.value); setSpCompanySelected(null); }}
                  />
                  {spCompanySearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
                  {spCompanyResults.length > 0 && !spCompanySelected && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {spCompanyResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setSpCompanySelected({ id: c.id, name: c.name }); setSpCompanyQuery(""); setSpCompanyResults([]); }}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative flex-1 min-w-[140px]">
                  <label className="block text-xs text-gray-500 mb-1">客户（可选）</label>
                  <input
                    type="text"
                    placeholder="搜索客户..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={spCustomerSelected ? spCustomerSelected.name : spCustomerQuery}
                    onChange={(e) => { setSpCustomerQuery(e.target.value); setSpCustomerSelected(null); }}
                  />
                  {spCustomerSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
                  {spCustomerResults.length > 0 && !spCustomerSelected && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {spCustomerResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setSpCustomerSelected({ id: c.id, name: c.name + (c.phone ? ' (' + c.phone + ')' : '') }); setSpCustomerQuery(""); setSpCustomerResults([]); }}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                        >
                          {c.name} {c.phone ? `(${c.phone})` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative flex-1 min-w-[140px]">
                  <label className="block text-xs text-gray-500 mb-1">车辆（可选）</label>
                  <input
                    type="text"
                    placeholder="搜索车牌号..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={spVehicleSelected ? spVehicleSelected.name : spVehicleQuery}
                    onChange={(e) => { setSpVehicleQuery(e.target.value); setSpVehicleSelected(null); }}
                  />
                  {spVehicleSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
                  {spVehicleResults.length > 0 && !spVehicleSelected && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {spVehicleResults.map((v) => {
                        const vName = v.plate_number + (v.brand || v.model ? '·' + (v.brand || '') + ' ' + (v.model || '') : '');
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => { setSpVehicleSelected({ id: v.id, name: vName }); setSpVehicleQuery(""); setSpVehicleResults([]); }}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                          >
                            {vName}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="w-28">
                  <label className="block text-xs text-gray-500 mb-1">价格</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={spNewPrice}
                    onChange={(e) => setSpNewPrice(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addSpecialPrice(); }}
                  />
                </div>
                <button
                  type="button"
                  onClick={addSpecialPrice}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  添加
                </button>
              </div>

              {/* 统一列表 */}
              {specialPrices.length > 0 && (
                <div className="border border-gray-100 rounded-lg divide-y divide-gray-100">
                  {specialPrices.map((p) => {
                    const parts: string[] = [];
                    if (p.company_name) parts.push(`单位：${p.company_name}`);
                    if (p.customer_name) parts.push(`客户：${p.customer_name}`);
                    if (p.vehicle_name) parts.push(`车辆：${p.vehicle_name}`);
                    return (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm text-gray-700">{parts.join('  ')}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-900">¥{p.price}</span>
                          <button
                            type="button"
                            onClick={() => removeSpecialPrice(p.id)}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 车型定价 */}
            <h4 className="text-xs font-medium text-gray-500 mb-3">车型定价</h4>
            <div className="relative mb-3">
              <input
                type="text"
                placeholder="搜索车型"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={vmPriceSelected ? vmPriceSelected.name : vmPriceQuery}
                onChange={(e) => { setVmPriceQuery(e.target.value); setVmPriceSelected(null); }}
              />
              {vmPriceSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
              {vmPriceResults.length > 0 && !vmPriceSelected && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {vmPriceResults.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setVmPriceSelected({
                          id: v.id,
                          name: v.brand + ' ' + v.series + ' ' + v.model_name,
                          brand: v.brand,
                          series: v.series,
                          model_name: v.model_name,
                          year_start: v.year_start,
                          year_end: v.year_end,
                          engine: v.engine,
                        });
                        setVmPriceQuery("");
                        setVmPriceResults([]);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      <span className="font-medium">{v.brand} {v.series}</span>
                      {v.model_name && <span className="text-gray-500 ml-1">{v.model_name}</span>}
                      {v.year_start && (
                        <span className="text-gray-400 text-xs ml-1">({v.year_start}-{v.year_end || '今'})</span>
                      )}
                      {v.engine && <span className="text-gray-400 text-xs ml-1">· 发动机:{v.engine}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 mb-3 flex-wrap">
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="销售价 *"
                className="flex-1 min-w-[70px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={vmNewSalesPrice}
                onChange={(e) => setVmNewSalesPrice(e.target.value)}
              />
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="VIP价"
                className="flex-1 min-w-[70px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={vmNewVipPrice}
                onChange={(e) => setVmNewVipPrice(e.target.value)}
              />
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="单位价"
                className="flex-1 min-w-[70px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={vmNewStandardPrice}
                onChange={(e) => setVmNewStandardPrice(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addVehicleModelPrice(); }}
              />
            </div>
            <button
              type="button"
              onClick={addVehicleModelPrice}
              disabled={!vmPriceSelected || !vmNewSalesPrice}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              添加
            </button>
            {groupedVehiclePrices.length > 0 && (
              <div className="mt-3 space-y-2">
                {groupedVehiclePrices.map((group, idx) => (
                  <div key={idx} className="bg-gray-50 rounded-lg p-2.5 text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-3 text-gray-600">
                        <span>销售:<span className="font-medium text-gray-900 ml-0.5">{group.sales_price || '-'}</span></span>
                        <span>VIP:<span className="font-medium text-gray-900 ml-0.5">{group.vip_price || '-'}</span></span>
                        <span>单位:<span className="font-medium text-gray-900 ml-0.5">{group.standard_price || '-'}</span></span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => removeVehicleModelPriceGroup(group.sales_price, group.vip_price, group.standard_price)}
                          className="text-red-600 hover:text-red-700"
                        >
                          删除整组
                        </button>
                      </div>
                    </div>
                    {group.items.map((p) => (
                      <div key={p.vehicle_model_id} className="text-gray-700">
                        <span className="text-gray-500">ID:{String(p.vehicle_model_id).slice(0,8)}</span>
                        <span className="text-gray-400 mx-1">·</span>
                        {p.brand} {p.series} {p.model_name}
                        {p.year_start && (
                          <span className="text-gray-400 ml-0.5">{p.year_start}{p.year_end && p.year_end !== p.year_start ? `-${p.year_end}` : ''}款</span>
                        )}
                        {p.engine && (
                          <>
                            <span className="text-gray-400 mx-1">·</span>
                            <span className="text-gray-500">发动机:{p.engine}</span>
                          </>
                        )}
                      </div>
                    ))}
                    <div className="text-xs text-gray-500 mt-1">共 {group.items.length} 个车型</div>
                  </div>
                ))}
              </div>
            )}
          </div>

        {/* 选择适用车型弹窗 */}
        {vmModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col mx-4">
              <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-200">
                <h3 className="text-base font-semibold text-gray-900 shrink-0">选择适用车型</h3>
                <input
                  type="text"
                  placeholder="搜索品牌、车系或型号"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  value={vmModalQuery}
                  onChange={(e) => setVmModalQuery(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setVmModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0"
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-3">
                {vmModalLoading && <div className="text-sm text-gray-500 text-center py-4">加载中...</div>}
                {!vmModalLoading && vmModalList.length === 0 && (
                  <div className="text-sm text-gray-400 text-center py-4">未找到车型</div>
                )}
                {!vmModalLoading && vmModalList.length > 0 && (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left w-10">
                          <input
                            type="checkbox"
                            checked={vmModalList.length > 0 && vmModalList.every((v) => vmModalSelected.has(v.id))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setVmModalSelected(new Set(vmModalList.map((v) => v.id)));
                              } else {
                                setVmModalSelected(new Set());
                              }
                            }}
                          />
                        </th>
                        <th className="px-3 py-2 text-left">品牌</th>
                        <th className="px-3 py-2 text-left">车系</th>
                        <th className="px-3 py-2 text-left">车型</th>
                        <th className="px-3 py-2 text-left">年款</th>
                        <th className="px-3 py-2 text-left">发动机</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {vmModalList.map((v) => (
                        <tr key={v.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={vmModalSelected.has(v.id)}
                              onChange={() => toggleVmModalSelection(v.id)}
                            />
                          </td>
                          <td className="px-3 py-2">{v.brand}</td>
                          <td className="px-3 py-2">{v.series}</td>
                          <td className="px-3 py-2">{v.model_name}</td>
                          <td className="px-3 py-2 text-gray-500">
                            {v.year_start ? `${v.year_start}-${v.year_end || '今'}` : '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-500">{v.engine || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
                <span className="text-sm text-gray-500">已选 {vmModalSelected.size} 个车型</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setVmModalOpen(false)}
                    className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={confirmVmModal}
                    disabled={vmModalSelected.size === 0}
                    className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    确定
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* 右侧悬浮操作按钮 */}
        <div className="fixed right-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2">
          <button
            type="submit"
            disabled={loading || !!hasDuplicatePartNumber || !partNumber.trim() || !selectedPartName}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-lg"
          >
            {loading ? (
              <span className="block text-center">保存中...</span>
            ) : (
              <span className="flex flex-col items-center leading-tight">
                <span>保存</span>
                <span className="text-[10px] opacity-80">Ctrl+S</span>
              </span>
            )}
          </button>
          <button
            type="button"
            disabled={!isEditMode && !searchParams.get("copy_from")}
            onClick={() => {
              const copyId = isEditMode ? editId : searchParams.get("copy_from");
              if (copyId) router.push(`/parts/new?copy_from=${copyId}`);
            }}
            className="px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 shadow-lg"
          >
            <span className="flex flex-col items-center leading-tight">
              <span>复制新建</span>
              <span className="text-[10px] opacity-80">Ctrl+Shift+D</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-lg"
          >
            <span className="flex flex-col items-center leading-tight">
              <span>重新输入</span>
              <span className="text-[10px] opacity-80">Ctrl+Shift+R</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-lg"
          >
            <span className="flex flex-col items-center leading-tight">
              <span>取消</span>
              <span className="text-[10px] opacity-80">Esc</span>
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
