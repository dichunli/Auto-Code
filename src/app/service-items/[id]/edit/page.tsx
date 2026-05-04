"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import VehiclePriceModal from "@/components/VehiclePriceModal";
import VehiclePriceEditModal from "@/components/VehiclePriceEditModal";
import VehicleDeleteModal from "@/components/VehicleDeleteModal";
import VehiclePriceViewModal from "@/components/VehiclePriceViewModal";

interface LinkedPart {
  id: string;
  name: string;
  quantity: number | null;
}

interface VehiclePrice {
  id?: string;
  vehicle_model_id: number;
  vehicle_name: string;
  price: number;
  vip_price: number | null;
  customer_parts_price: number | null;
  company_price: number | null;
  品牌?: string;
  车系?: string;
  车型?: string;
  年款?: number | null;
  排量?: string | null;
  发动机型号: string | null;
  底盘型号: string | null;
  变速箱型号: string | null;
  group_key?: string;
}

interface ServiceNameResult {
  id: string;
  name: string;
  category_id: string;
  search_keywords: string | null;
  service_categories: any;
  sales_commission_type?: string | null;
  sales_commission_value?: number | null;
  diagnosis_commission_type?: string | null;
  diagnosis_commission_value?: number | null;
  repair_commission_type?: string | null;
  repair_commission_value?: number | null;
  qc_commission_type?: string | null;
  qc_commission_value?: number | null;
}

function getPriceKey(p: { price: number; vip_price: number | null; customer_parts_price: number | null; company_price: number | null }) {
  const fmt = (v: number | null) => v === null ? "null" : v.toFixed(2);
  return `${p.price.toFixed(2)}_${fmt(p.vip_price)}_${fmt(p.customer_parts_price)}_${fmt(p.company_price)}`;
}

function makeGroupKey(p: { price: number; vip_price: number | null; customer_parts_price: number | null; company_price: number | null; group_key?: string }) {
  return p.group_key || getPriceKey(p);
}

export default function EditServiceItemPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);

  // 项目名称搜索
  const [nameQuery, setNameQuery] = useState("");
  const [nameResults, setNameResults] = useState<ServiceNameResult[]>([]);
  const [nameSearching, setNameSearching] = useState(false);
  const [selectedNameId, setSelectedNameId] = useState<string | null>(null);
  const [showDirectCreate, setShowDirectCreate] = useState(false);

  const [form, setForm] = useState({
    code: "",
    category_id: "",
    service_name_id: "",
    name: "",
    standard_hours: "",
    description: "",
    default_price: "",
    vip_price: "",
    customer_parts_price: "",
    company_price: "",
    sales_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    sales_value: "",
    diagnosis_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    diagnosis_value: "",
    repair_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    repair_value: "",
    qc_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    qc_value: "",
  });

  // 车型定价
  const [vehiclePrices, setVehiclePrices] = useState<VehiclePrice[]>([]);
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [vehicleEditModalOpen, setVehicleEditModalOpen] = useState(false);
  const [vehicleDeleteModalOpen, setVehicleDeleteModalOpen] = useState(false);
  const [deleteGroupKey, setDeleteGroupKey] = useState<string | null>(null);
  const [vehicleViewModalOpen, setVehicleViewModalOpen] = useState(false);
  const [viewVehicles, setViewVehicles] = useState<VehiclePrice[]>([]);
  const [pendingGroupPrices, setPendingGroupPrices] = useState<{ price: number; vip_price: number | null; customer_parts_price: number | null; company_price: number | null } | null>(null);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [appendMode, setAppendMode] = useState(false);

  const priceGroups = useMemo(() => {
    const map = new Map<string, { price: number; vip_price: number | null; customer_parts_price: number | null; company_price: number | null; vehicles: VehiclePrice[] }>();
    for (const p of vehiclePrices) {
      const key = makeGroupKey(p);
      if (!map.has(key)) {
        map.set(key, { price: p.price, vip_price: p.vip_price, customer_parts_price: p.customer_parts_price, company_price: p.company_price, vehicles: [] });
      }
      map.get(key)!.vehicles.push(p);
    }
    return Array.from(map.values());
  }, [vehiclePrices]);

  const modalExcludedIds = useMemo(() => {
    if (appendMode) {
      return [...new Set(vehiclePrices.map((p) => Number(p.vehicle_model_id)))];
    }
    if (editingGroupKey) {
      return [...new Set(vehiclePrices.filter((p) => makeGroupKey(p) !== editingGroupKey).map((p) => Number(p.vehicle_model_id)))];
    }
    return [...new Set(vehiclePrices.map((p) => Number(p.vehicle_model_id)))];
  }, [appendMode, editingGroupKey, vehiclePrices]);
  const modalPreSelectedIds = useMemo(() => {
    if (appendMode) return undefined;
    if (editingGroupKey) {
      return [...new Set(vehiclePrices.filter((p) => makeGroupKey(p) === editingGroupKey).map((p) => Number(p.vehicle_model_id)))];
    }
    return undefined;
  }, [appendMode, editingGroupKey, vehiclePrices]);

  function removePriceGroup(key: string) {
    setVehiclePrices((prev) => prev.filter((p) => makeGroupKey(p) !== key));
  }

  function handleDeleteVehicles(vehicleIdsToDelete: number[]) {
    setVehiclePrices((prev) => prev.filter((p) => !vehicleIdsToDelete.includes(p.vehicle_model_id)));
    setVehicleDeleteModalOpen(false);
    setDeleteGroupKey(null);
  }

  const [linkedParts, setLinkedParts] = useState<LinkedPart[]>([]);
  const [autoSavingVehicles, setAutoSavingVehicles] = useState(false);
  const initialVehicleLoadRef = useRef(true);

  useEffect(() => {
    if (initialVehicleLoadRef.current) {
      initialVehicleLoadRef.current = false;
      return;
    }
    if (!id) return;

    async function autoSave() {
      setAutoSavingVehicles(true);
      try {
        const { error: delError } = await supabase.from("service_item_prices").delete().eq("service_item_id", id);
        if (delError) {
          console.error("删除旧车型定价失败:", delError);
          alert("自动保存失败（删除旧数据）: " + delError.message);
          setAutoSavingVehicles(false);
          return;
        }
        if (vehiclePrices.length > 0) {
          const rows = vehiclePrices.map((p) => ({
            service_item_id: id,
            vehicle_model_id: p.vehicle_model_id,
            price: p.price,
            vip_price: p.vip_price,
            customer_parts_price: p.customer_parts_price,
            company_price: p.company_price,
          }));
          const { error: insError } = await supabase.from("service_item_prices").insert(rows);
          if (insError) {
            console.error("插入新车型定价失败:", insError);
            alert("自动保存失败（插入新数据）: " + insError.message);
          }
        }
      } catch (err: any) {
        console.error("自动保存车型定价失败:", err);
        alert("自动保存异常: " + (err?.message || String(err)));
      } finally {
        setAutoSavingVehicles(false);
      }
    }

    autoSave();
  }, [vehiclePrices, id]);

  // 指定用户价格
  interface SpecialPrice {
    company_id?: string;
    company_name?: string;
    customer_id?: string;
    customer_name?: string;
    vehicle_id?: string;
    vehicle_info?: string;
    price: number;
  }
  const [specialPrices, setSpecialPrices] = useState<SpecialPrice[]>([]);
  const [spCompanyQuery, setSpCompanyQuery] = useState("");
  const [spCompanyResults, setSpCompanyResults] = useState<any[]>([]);
  const [spCustomerQuery, setSpCustomerQuery] = useState("");
  const [spCustomerResults, setSpCustomerResults] = useState<any[]>([]);
  const [spVehicleQuery, setSpVehicleQuery] = useState("");
  const [spVehicleResults, setSpVehicleResults] = useState<any[]>([]);
  const [spNewPrice, setSpNewPrice] = useState("");
  const [spSelectedCompany, setSpSelectedCompany] = useState<{ id: string; name: string } | null>(null);
  const [spSelectedCustomer, setSpSelectedCustomer] = useState<{ id: string; name: string } | null>(null);
  const [spSelectedVehicle, setSpSelectedVehicle] = useState<{ id: string; info: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!spCompanyQuery.trim()) { setSpCompanyResults([]); return; }
      const { data } = await supabase.from("companies").select("id, name").ilike("name", `%${spCompanyQuery.trim()}%`).limit(10);
      setSpCompanyResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [spCompanyQuery, supabase]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!spCustomerQuery.trim()) { setSpCustomerResults([]); return; }
      const { data } = await supabase.from("customers").select("id, name, phone").ilike("name", `%${spCustomerQuery.trim()}%`).limit(10);
      setSpCustomerResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [spCustomerQuery, supabase]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!spVehicleQuery.trim()) { setSpVehicleResults([]); return; }
      const q = spVehicleQuery.trim();
      const { data } = await supabase.from("vehicles").select("id, plate_number, brand, model, customer_id, customers(name)").ilike("plate_number", `%${q}%`).limit(10);
      setSpVehicleResults((data as any) || []);
    }, 300);
    return () => clearTimeout(t);
  }, [spVehicleQuery, supabase]);

  function addSpecialPrice() {
    const priceVal = parseFloat(spNewPrice);
    if (!priceVal || priceVal <= 0) { alert("请输入有效的价格"); return; }
    const hasCompany = !!spSelectedCompany;
    const hasCustomer = !!spSelectedCustomer;
    const hasVehicle = !!spSelectedVehicle;
    if (!hasCompany && !hasCustomer && !hasVehicle) { alert("请至少指定单位、客户或车辆中的一项"); return; }
    if (hasVehicle && !hasCustomer) { alert("指定车辆时必须先指定客户"); return; }

    const entry: SpecialPrice = { price: priceVal };
    if (hasCompany) { entry.company_id = spSelectedCompany.id; entry.company_name = spSelectedCompany.name; }
    if (hasCustomer) { entry.customer_id = spSelectedCustomer.id; entry.customer_name = spSelectedCustomer.name; }
    if (hasVehicle) { entry.vehicle_id = spSelectedVehicle.id; entry.vehicle_info = spSelectedVehicle.info; }

    setSpecialPrices((prev) => [...prev, entry]);
    setSpNewPrice("");
    setSpSelectedCompany(null); setSpCompanyQuery(""); setSpCompanyResults([]);
    setSpSelectedCustomer(null); setSpCustomerQuery(""); setSpCustomerResults([]);
    setSpSelectedVehicle(null); setSpVehicleQuery(""); setSpVehicleResults([]);
  }

  function removeSpecialPrice(index: number) {
    setSpecialPrices((prev) => prev.filter((_, i) => i !== index));
  }

  useEffect(() => {
    supabase
      .from("service_categories")
      .select(
        "id, name, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value"
      )
      .order("name")
      .then(({ data }) => setCategories(data || []));
  }, [supabase]);

  useEffect(() => {
    async function load() {
      try {
        const { data: item } = await supabase.from("service_items").select("*").eq("id", id).single();
        if (!item) { alert("维修项目不存在"); router.push("/service-items"); return; }
        const { data: vehicleData } = await supabase
          .from("service_item_prices")
          .select("id, vehicle_model_id, price, vip_price, customer_parts_price, company_price, vehicle_models(品牌,车系,车型,年款,排量,发动机型号,底盘型号,变速箱型号)")
          .eq("service_item_id", id);
        setForm({
          code: item.code || "",
          category_id: item.category_id || "",
          service_name_id: item.service_name_id || "",
          name: item.name || "",
          standard_hours: item.standard_hours?.toString() || "",
          description: item.description || "",
          default_price: item.default_price?.toString() || "",
          vip_price: item.vip_price?.toString() || "",
          customer_parts_price: item.customer_parts_price?.toString() || "",
          company_price: item.company_price?.toString() || "",
          sales_type: item.sales_commission_type || "",
          sales_value: item.sales_commission_value?.toString() || "",
          diagnosis_type: item.diagnosis_commission_type || "",
          diagnosis_value: item.diagnosis_commission_value?.toString() || "",
          repair_type: item.repair_commission_type || "",
          repair_value: item.repair_commission_value?.toString() || "",
          qc_type: item.qc_commission_type || "",
          qc_value: item.qc_commission_value?.toString() || "",
        });
        if (item.service_name_id) {
          setSelectedNameId(item.service_name_id);
          const { data: partLinks } = await supabase
            .from("service_name_part_names")
            .select("part_name_id, quantity")
            .eq("service_name_id", item.service_name_id)
            .order("sort_order", { ascending: true });
          if (partLinks && partLinks.length > 0) {
            const partIds = partLinks.map((l: any) => l.part_name_id);
            const { data: partNamesData } = await supabase.from("part_names").select("id, name").in("id", partIds);
            const nameMap = new Map((partNamesData || []).map((p: any) => [p.id, p.name]));
            const parts = partLinks
              .map((l: any) => ({ id: l.part_name_id, name: nameMap.get(l.part_name_id), quantity: l.quantity ?? null }))
              .filter((x: any) => x.name) as LinkedPart[];
            setLinkedParts(parts);
          } else {
            setLinkedParts([]);
          }
        } else {
          setLinkedParts([]);
        }
        setVehiclePrices((vehicleData || []).map((v: any) => {
          const m = v.vehicle_models;
          const parts = [m?.品牌, m?.车系, m?.车型].filter(Boolean);
          if (m?.年款) parts.push(m.年款 + "款");
          if (m?.排量) parts.push(m.排量);
          return {
            id: v.id,
            vehicle_model_id: v.vehicle_model_id,
            vehicle_name: parts.join(" ") || "车型#" + v.vehicle_model_id,
            price: v.price,
            vip_price: v.vip_price ?? null,
            customer_parts_price: v.customer_parts_price ?? null,
            company_price: v.company_price ?? null,
            品牌: m?.品牌 || null,
            车系: m?.车系 || null,
            车型: m?.车型 || null,
            年款: m?.年款 ?? null,
            排量: m?.排量 ?? null,
            发动机型号: m?.发动机型号 || null,
            底盘型号: m?.底盘型号 || null,
            变速箱型号: m?.变速箱型号 || null,
          };
        }));

        // 加载指定用户价格
        const { data: specialData } = await supabase
          .from("service_item_special_prices")
          .select("company_id, customer_id, vehicle_id, price, companies(name), customers(name), vehicles(plate_number, brand, model)")
          .eq("service_item_id", id);
        setSpecialPrices((specialData || []).map((s: any) => ({
          company_id: s.company_id || undefined,
          company_name: s.companies?.name || undefined,
          customer_id: s.customer_id || undefined,
          customer_name: s.customers?.name || undefined,
          vehicle_id: s.vehicle_id || undefined,
          vehicle_info: s.vehicles ? `${s.vehicles.plate_number}${s.vehicles.brand ? ` · ${s.vehicles.brand}` : ""}${s.vehicles.model ? ` ${s.vehicles.model}` : ""}` : undefined,
          price: s.price,
        })));
      } catch (err: any) { console.error("加载失败:", err); alert("加载数据失败: " + (err.message || "未知错误")); }
      finally { setLoading(false); }
    }
    load();
  }, [id, supabase, router]);

  const searchServiceNames = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setNameResults([]);
        return;
      }
      setNameSearching(true);
      const trimmed = q.trim();

      // 1) 直接匹配 service_names
      const [{ data: directMatches }, { data: partMatches }] = await Promise.all([
        supabase
          .from("service_names")
          .select("id, name, category_id, search_keywords, service_categories(*)")
          .or(`name.ilike.%${trimmed}%,search_keywords.ilike.%${trimmed}%`)
          .limit(20),
        supabase
          .from("part_names")
          .select("id")
          .or(`name.ilike.%${trimmed}%,search_keywords.ilike.%${trimmed}%`)
          .limit(20),
      ]);

      // 2) 通过配件名称间接匹配
      let indirectMatches: ServiceNameResult[] = [];
      const partIds = partMatches?.map((p) => p.id) || [];
      if (partIds.length > 0) {
        const { data: linked } = await supabase
          .from("service_name_part_names")
          .select("service_name_id")
          .in("part_name_id", partIds);
        const linkedIds = [...new Set((linked || []).map((l: any) => l.service_name_id))];
        if (linkedIds.length > 0) {
          const { data } = await supabase
            .from("service_names")
            .select("id, name, category_id, search_keywords, service_categories(*)")
            .in("id", linkedIds)
            .limit(20);
          indirectMatches = (data || []) as ServiceNameResult[];
        }
      }

      // 合并去重并按名称长度排序
      const seen = new Set<string>();
      const merged: ServiceNameResult[] = [];
      for (const item of [...(directMatches || []), ...indirectMatches]) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item as ServiceNameResult);
        }
      }
      merged.sort((a, b) => a.name.length - b.name.length);
      setNameResults(merged);
      setShowDirectCreate(merged.length === 0);
      setNameSearching(false);
    },
    [supabase]
  );

  async function handleSearchName() {
    await searchServiceNames(nameQuery);
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchName();
    }
  }

  async function selectServiceName(item: ServiceNameResult) {
    setSelectedNameId(item.id);
    const cat = item.service_categories;
    setForm((prev) => ({
      ...prev,
      service_name_id: item.id,
      name: item.name,
      category_id: item.category_id || "",
      sales_type: item.sales_commission_type || cat?.sales_commission_type || "",
      sales_value: item.sales_commission_value?.toString() || cat?.sales_commission_value?.toString() || "",
      diagnosis_type: item.diagnosis_commission_type || cat?.diagnosis_commission_type || "",
      diagnosis_value: item.diagnosis_commission_value?.toString() || cat?.diagnosis_commission_value?.toString() || "",
      repair_type: item.repair_commission_type || cat?.repair_commission_type || "",
      repair_value: item.repair_commission_value?.toString() || cat?.repair_commission_value?.toString() || "",
      qc_type: item.qc_commission_type || cat?.qc_commission_type || "",
      qc_value: item.qc_commission_value?.toString() || cat?.qc_commission_value?.toString() || "",
    }));

    const { data: partLinks } = await supabase
      .from("service_name_part_names")
      .select("part_name_id, quantity")
      .eq("service_name_id", item.id)
      .order("sort_order", { ascending: true });

    if (partLinks && partLinks.length > 0) {
      const partIds = partLinks.map((l: any) => l.part_name_id);
      const { data: partNamesData } = await supabase.from("part_names").select("id, name").in("id", partIds);
      const nameMap = new Map((partNamesData || []).map((p: any) => [p.id, p.name]));
      const parts = partLinks
        .map((l: any) => ({ id: l.part_name_id, name: nameMap.get(l.part_name_id), quantity: l.quantity ?? null }))
        .filter((x: any) => x.name) as LinkedPart[];
      setLinkedParts(parts);
    } else {
      setLinkedParts([]);
    }

    setNameResults([]);
    setShowDirectCreate(false);
  }

  function handleDirectCreate() {
    setForm((prev) => ({ ...prev, name: nameQuery.trim() }));
    setSelectedNameId(null);
    setShowDirectCreate(false);
    setNameResults([]);
    setLinkedParts([]);
  }

  function handleCategoryChange(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) {
      setForm((prev) => ({
        ...prev,
        category_id: categoryId,
        sales_type: cat.sales_commission_type || "",
        sales_value: cat.sales_commission_value?.toString() || "",
        diagnosis_type: cat.diagnosis_commission_type || "",
        diagnosis_value: cat.diagnosis_commission_value?.toString() || "",
        repair_type: cat.repair_commission_type || "",
        repair_value: cat.repair_commission_value?.toString() || "",
        qc_type: cat.qc_commission_type || "",
        qc_value: cat.qc_commission_value?.toString() || "",
      }));
    } else {
      setForm((prev) => ({ ...prev, category_id: categoryId }));
    }
  }

  function formatVehicleName(m: any): string {
    if (!m) return "";
    const parts = [m.品牌, m.车系, m.车型].filter(Boolean);
    if (m.年款) parts.push(`${m.年款}款`);
    if (m.排量) parts.push(m.排量);
    return parts.join(" ");
  }

  async function handleModalConfirm(
    vehicleIds: number[],
    price: number,
    vipPrice: number | null,
    customerPartsPrice: number | null,
    companyPrice: number | null
  ) {
    try {
      const basePrice = price;
      const baseVip = vipPrice;
      const baseCp = customerPartsPrice;
      const baseCo = companyPrice;

      if (editingGroupKey) {
        if (vehicleIds.length === 0) {
          if (!appendMode) {
            setVehiclePrices((prev) => prev.filter((p) => makeGroupKey(p) !== editingGroupKey));
          }
        } else {
          const { data, error } = await supabase.from("vehicle_models").select("id,品牌,车系,车型,年款,排量,发动机型号,底盘型号,变速箱型号").in("id", vehicleIds);
          if (error) {
            alert("加载车型信息失败: " + error.message);
            return;
          }
          if (!data || data.length === 0) {
            alert("未找到所选车型信息");
            return;
          }
          const groupPrice = appendMode && pendingGroupPrices ? pendingGroupPrices : { price: basePrice, vip_price: baseVip, customer_parts_price: baseCp, company_price: baseCo };
          const targetGroupKey = vehiclePrices.find((p) => getPriceKey(p) === editingGroupKey)?.group_key || editingGroupKey;
          const newEntries = data.map((m: any) => ({
            vehicle_model_id: m.id,
            vehicle_name: formatVehicleName(m),
            price: groupPrice.price,
            vip_price: groupPrice.vip_price,
            customer_parts_price: groupPrice.customer_parts_price,
            company_price: groupPrice.company_price,
            品牌: m.品牌 || null,
            车系: m.车系 || null,
            车型: m.车型 || null,
            年款: m.年款 ?? null,
            排量: m.排量 ?? null,
            发动机型号: m.发动机型号 || null,
            底盘型号: m.底盘型号 || null,
            变速箱型号: m.变速箱型号 || null,
            group_key: targetGroupKey,
          }));
          setVehiclePrices((prev) => {
            if (appendMode) {
              return [...prev, ...newEntries];
            }
            const filtered = prev.filter((p) => makeGroupKey(p) !== editingGroupKey);
            return [...filtered, ...newEntries];
          });
        }
        setEditingGroupKey(null);
        setAppendMode(false);
      } else {
        if (vehicleIds.length === 0) return;
        const { data, error } = await supabase.from("vehicle_models").select("id,品牌,车系,车型,年款,排量,发动机型号,底盘型号,变速箱型号").in("id", vehicleIds);
        if (error) {
          alert("加载车型信息失败: " + error.message);
          return;
        }
        if (!data || data.length === 0) {
          alert("未找到所选车型信息");
          return;
        }
        const newGroupKey = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newEntries = data.map((m: any) => ({
          vehicle_model_id: m.id,
          vehicle_name: formatVehicleName(m),
          price: basePrice,
          vip_price: baseVip,
          customer_parts_price: baseCp,
          company_price: baseCo,
          品牌: m.品牌 || null,
          车系: m.车系 || null,
          车型: m.车型 || null,
          年款: m.年款 ?? null,
          排量: m.排量 ?? null,
          发动机型号: m.发动机型号 || null,
          底盘型号: m.底盘型号 || null,
          变速箱型号: m.变速箱型号 || null,
          group_key: newGroupKey,
        }));
        setVehiclePrices((prev) => [...prev, ...newEntries]);
      }
      setVehicleModalOpen(false);
      setPendingGroupPrices(null);
    } catch (err: any) {
      console.error("handleModalConfirm 异常:", err);
      alert("添加车型定价时出错: " + (err?.message || String(err)));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.category_id) {
      alert("请填写项目名称和所属分类");
      return;
    }
    setSaving(true);

    const { error } = await supabase
      .from("service_items")
      .update({
        category_id: form.category_id,
        service_name_id: form.service_name_id || null,
        name: form.name.trim(),
        standard_hours: form.standard_hours ? parseFloat(form.standard_hours) : null,
        description: form.description || null,
        default_price: form.default_price ? parseFloat(form.default_price) : null,
        vip_price: form.vip_price ? parseFloat(form.vip_price) : null,
        customer_parts_price: form.customer_parts_price ? parseFloat(form.customer_parts_price) : null,
        company_price: form.company_price ? parseFloat(form.company_price) : null,
        sales_commission_type: form.sales_type || null,
        sales_commission_value: form.sales_value ? parseFloat(form.sales_value) : null,
        diagnosis_commission_type: form.diagnosis_type || null,
        diagnosis_commission_value: form.diagnosis_value ? parseFloat(form.diagnosis_value) : null,
        repair_commission_type: form.repair_type || null,
        repair_commission_value: form.repair_value ? parseFloat(form.repair_value) : null,
        qc_commission_type: form.qc_type || null,
        qc_commission_value: form.qc_value ? parseFloat(form.qc_value) : null,
      })
      .eq("id", id);

    if (error) {
      alert("保存失败: " + error.message);
      setSaving(false);
      return;
    }

    const { error: delVpError } = await supabase.from("service_item_prices").delete().eq("service_item_id", id);
    if (delVpError) {
      alert("删除旧车型定价失败: " + delVpError.message);
      setSaving(false);
      return;
    }
    if (vehiclePrices.length > 0) {
      const { error: vpError } = await supabase.from("service_item_prices").insert(
        vehiclePrices.map((p) => ({
          service_item_id: id,
          vehicle_model_id: p.vehicle_model_id,
          price: p.price,
          vip_price: p.vip_price,
          customer_parts_price: p.customer_parts_price,
          company_price: p.company_price,
        }))
      );
      if (vpError) {
        alert("车型定价保存失败: " + vpError.message);
        setSaving(false);
        return;
      }
    }

    const { error: delSpError } = await supabase.from("service_item_special_prices").delete().eq("service_item_id", id);
    if (delSpError) {
      alert("删除旧指定用户价格失败: " + delSpError.message);
      setSaving(false);
      return;
    }
    if (specialPrices.length > 0) {
      const { error: spError } = await supabase.from("service_item_special_prices").insert(
        specialPrices.map((p) => ({
          service_item_id: id,
          company_id: p.company_id || null,
          customer_id: p.customer_id || null,
          vehicle_id: p.vehicle_id || null,
          price: p.price,
        }))
      );
      if (spError) {
        alert("指定用户价格保存失败: " + spError.message);
        setSaving(false);
        return;
      }
    }

    router.push("/service-items");
    router.refresh();
  }

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

  if (loading) {
    return (
      <div>
        <PageHeader title="编辑维修项目" />
        <div className="text-sm text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="编辑维修项目" />
      <form onSubmit={handleSubmit}>
        <div className="flex gap-6 items-start">
          {/* 左侧主表单 */}
          <div className="flex-1 min-w-0 max-w-3xl bg-white rounded-xl border border-gray-200 p-6 space-y-6">
            {/* 项目编码 */}
            {form.code && (
              <div className="text-xs text-gray-400">编码：{form.code}</div>
            )}

            {/* 项目名称搜索 */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">维修项目名称 *</label>
              {!form.service_name_id && (
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="输入名称搜索名称库（支持配件名称搜索）..."
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    onKeyDown={handleNameKeyDown}
                  />
                  <button
                    type="button"
                    onClick={handleSearchName}
                    disabled={nameSearching || !nameQuery.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {nameSearching ? "搜索中..." : "搜索"}
                  </button>
                </div>
              )}

              {nameResults.length > 0 && (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {nameResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectServiceName(item)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-900">{item.name}</div>
                        <div className="text-xs text-gray-400">
                          {item.service_categories?.name || "-"}
                          {item.search_keywords ? ` · ${item.search_keywords}` : ""}
                        </div>
                      </div>
                      <span className="text-xs text-blue-600">选择</span>
                    </button>
                  ))}
                </div>
              )}

              {showDirectCreate && nameQuery.trim() && (
                <div className="space-y-2">
                  <div className="text-sm text-gray-500">未找到包含「{nameQuery.trim()}」的项目名称。</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleDirectCreate}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      直接创建「{nameQuery.trim()}」
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push("/service-names/new")}
                      className="px-4 py-2 text-sm font-medium text-blue-600 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
                    >
                      去名称库新建
                    </button>
                  </div>
                </div>
              )}

              {form.service_name_id && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <span className="text-sm text-blue-800">已选择：{form.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, service_name_id: "", name: "" }));
                      setSelectedNameId(null);
                      setLinkedParts([]);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    重新选择
                  </button>
                </div>
              )}
            </div>

            {/* 基本信息 */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">所属分类 *</label>
                <select
                  required
                  disabled={!!form.service_name_id}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  value={form.category_id}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  <option value="">请选择分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {form.service_name_id && <p className="text-xs text-gray-400 mt-1">已关联名称库，分类不可修改</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">项目名称 *</label>
                  <input
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标准工时</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.standard_hours}
                    onChange={(e) => setForm({ ...form, standard_hours: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">项目说明</label>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="简短说明"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* 关联配件 */}
            {linkedParts.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">关联配件</h3>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {linkedParts.map((p, idx) => (
                    <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm text-gray-900">{idx + 1}. {p.name}</span>
                      <span className="text-xs text-gray-500">
                        数量：{p.quantity ?? <span className="text-gray-400">待定</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 价格 */}
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">项目价格</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">销售价（标准价）</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.default_price}
                    onChange={(e) => setForm({ ...form, default_price: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">VIP价</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.vip_price}
                    onChange={(e) => setForm({ ...form, vip_price: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">自带配件价</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="客户自带配件时的价格"
                    value={form.customer_parts_price}
                    onChange={(e) => setForm({ ...form, customer_parts_price: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">单位价</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="关联单位车辆时的价格"
                    value={form.company_price}
                    onChange={(e) => setForm({ ...form, company_price: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* 提成规则 */}
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">提成规则（选择分类/名称后自动带入，可修改）</h3>
              <div className="space-y-4">
                <CommissionField
                  label="销售提成"
                  typeValue={form.sales_type}
                  valueValue={form.sales_value}
                  onTypeChange={(v) => setForm({ ...form, sales_type: v as any, sales_value: v ? form.sales_value : "" })}
                  onValueChange={(v) => setForm({ ...form, sales_value: v })}
                />
                <CommissionField
                  label="诊断提成"
                  typeValue={form.diagnosis_type}
                  valueValue={form.diagnosis_value}
                  onTypeChange={(v) => setForm({ ...form, diagnosis_type: v as any, diagnosis_value: v ? form.diagnosis_value : "" })}
                  onValueChange={(v) => setForm({ ...form, diagnosis_value: v })}
                />
                <CommissionField
                  label="施工提成"
                  typeValue={form.repair_type}
                  valueValue={form.repair_value}
                  onTypeChange={(v) => setForm({ ...form, repair_type: v as any, repair_value: v ? form.repair_value : "" })}
                  onValueChange={(v) => setForm({ ...form, repair_value: v })}
                />
                <CommissionField
                  label="质检提成"
                  typeValue={form.qc_type}
                  valueValue={form.qc_value}
                  onTypeChange={(v) => setForm({ ...form, qc_type: v as any, qc_value: v ? form.qc_value : "" })}
                  onValueChange={(v) => setForm({ ...form, qc_value: v })}
                />
              </div>
            </div>

            {/* 指定用户价格 */}
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">指定用户价格</h3>
              <div className="space-y-3">
                <div className="flex gap-3 items-end flex-wrap">
                  <div className="flex-1 min-w-[140px] relative">
                    <label className="block text-xs text-gray-500 mb-1">单位（可选）</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="搜索单位..."
                      value={spSelectedCompany ? spSelectedCompany.name : spCompanyQuery}
                      onChange={(e) => { setSpCompanyQuery(e.target.value); setSpSelectedCompany(null); }}
                    />
                    {spCompanyResults.length > 0 && !spSelectedCompany && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {spCompanyResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setSpSelectedCompany({ id: c.id, name: c.name }); setSpCompanyResults([]); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-[140px] relative">
                    <label className="block text-xs text-gray-500 mb-1">客户（可选）</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="搜索客户..."
                      value={spSelectedCustomer ? spSelectedCustomer.name : spCustomerQuery}
                      onChange={(e) => { setSpCustomerQuery(e.target.value); setSpSelectedCustomer(null); }}
                    />
                    {spCustomerResults.length > 0 && !spSelectedCustomer && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {spCustomerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setSpSelectedCustomer({ id: c.id, name: c.name }); setSpCustomerResults([]); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                          >
                            {c.name} {c.phone ? `(${c.phone})` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-[140px] relative">
                    <label className="block text-xs text-gray-500 mb-1">车辆（可选）</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="搜索车牌号..."
                      value={spSelectedVehicle ? spSelectedVehicle.info : spVehicleQuery}
                      onChange={(e) => { setSpVehicleQuery(e.target.value); setSpSelectedVehicle(null); }}
                    />
                    {spVehicleResults.length > 0 && !spSelectedVehicle && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {spVehicleResults.map((v: any) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              const info = `${v.plate_number}${v.brand ? ` · ${v.brand}` : ""}${v.model ? ` ${v.model}` : ""}`;
                              setSpSelectedVehicle({ id: v.id, info });
                              setSpVehicleResults([]);
                              if (v.customers?.name && !spSelectedCustomer) {
                                setSpSelectedCustomer({ id: v.customer_id, name: v.customers.name });
                                setSpCustomerQuery(v.customers.name);
                              }
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                          >
                            <div className="text-gray-900">{v.plate_number} {v.brand}{v.model ? ` ${v.model}` : ""}</div>
                            <div className="text-xs text-gray-500">{v.customers?.name || ""}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="w-32">
                    <label className="block text-xs text-gray-500 mb-1">价格</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                      value={spNewPrice}
                      onChange={(e) => setSpNewPrice(e.target.value)}
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
              </div>
              {specialPrices.length > 0 && (
                <div className="mt-3 space-y-2">
                  {specialPrices.map((p, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-900">
                        {p.company_id && <span className="mr-3">单位：{p.company_name}</span>}
                        {p.customer_id && <span className="mr-3">客户：{p.customer_name}</span>}
                        {p.vehicle_id && <span>车辆：{p.vehicle_info}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-700">{p.price} 元</span>
                        <button
                          type="button"
                          onClick={() => removeSpecialPrice(idx)}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                onClick={() => router.push("/service-items")}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>

          {/* 右侧车型定价 */}
          <div className="w-[560px] shrink-0 bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">车型定价</h3>
                {autoSavingVehicles && <span className="text-xs text-blue-500">保存中...</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setAppendMode(false); setEditingGroupKey(null); setPendingGroupPrices(null); setVehicleModalOpen(true); }}
                  className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  添加
                </button>
                {vehiclePrices.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setEditingGroupKey(null); setPendingGroupPrices(null); setVehicleEditModalOpen(true); }}
                    className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900"
                  >
                    编辑
                  </button>
                )}
              </div>
            </div>

            {priceGroups.length > 0 ? (
              <div className="space-y-3 max-h-[70vh] overflow-y-auto">
                {priceGroups.map((g) => {
                  const key = makeGroupKey(g);
                  const visibleVehicles = g.vehicles.slice(0, 3);
                  const remaining = g.vehicles.length - 3;
                  return (
                    <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-gray-600">销售:<b className="text-gray-900">{g.price}</b></span>
                          <span className="text-gray-600">VIP:<b className="text-gray-900">{g.vip_price ?? "-"}</b></span>
                          <span className="text-gray-600">自带:<b className="text-gray-900">{g.customer_parts_price ?? "-"}</b></span>
                          <span className="text-gray-600">单位:<b className="text-gray-900">{g.company_price ?? "-"}</b></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setAppendMode(true);
                              setEditingGroupKey(key);
                              setPendingGroupPrices({
                                price: g.price,
                                vip_price: g.vip_price,
                                customer_parts_price: g.customer_parts_price,
                                company_price: g.company_price,
                              });
                              setVehicleModalOpen(true);
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            添加
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setViewVehicles(g.vehicles);
                              setVehicleViewModalOpen(true);
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            查看
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteGroupKey(key);
                              setVehicleDeleteModalOpen(true);
                            }}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            删除
                          </button>
                          <button
                            type="button"
                            onClick={() => removePriceGroup(key)}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            删除整组
                          </button>
                        </div>
                      </div>
                      <div className="px-3 py-2 space-y-1">
                        {visibleVehicles.map((v) => (
                          <div
                            key={v.vehicle_model_id}
                            className="text-xs text-gray-700 truncate"
                            title={`发动机：${v.发动机型号 ?? "-"} · 底盘：${v.底盘型号 ?? "-"} · 变速箱：${v.变速箱型号 ?? "-"}`}
                          >
                            <span className="text-gray-500">ID:{v.vehicle_model_id}</span> · {v.vehicle_name} · <span className="text-gray-500">发动机:{v.发动机型号 ?? "-"} · 底盘:{v.底盘型号 ?? "-"} · 变速箱:{v.变速箱型号 ?? "-"}</span>
                          </div>
                        ))}
                        {g.vehicles.length > 0 && (
                          <div className="text-xs text-gray-400">共 {g.vehicles.length} 个车型</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-gray-400 text-sm py-8">暂无车型定价</div>
            )}
          </div>
        </div>
      </form>

      <VehiclePriceModal
        open={vehicleModalOpen}
        onClose={() => { setVehicleModalOpen(false); setPendingGroupPrices(null); setEditingGroupKey(null); setAppendMode(false); }}
        onConfirm={handleModalConfirm}
        defaultPrices={pendingGroupPrices || undefined}
        excludedIds={modalExcludedIds}
        preSelectedIds={modalPreSelectedIds}
      />
      <VehiclePriceEditModal
        open={vehicleEditModalOpen}
        onClose={() => setVehicleEditModalOpen(false)}
        onConfirm={(prices) => { setVehiclePrices(prices); setVehicleEditModalOpen(false); }}
        prices={vehiclePrices}
        onAddVehicles={(prices) => { setPendingGroupPrices(prices); setVehicleEditModalOpen(false); setVehicleModalOpen(true); }}
      />
      <VehicleDeleteModal
        open={vehicleDeleteModalOpen}
        onClose={() => { setVehicleDeleteModalOpen(false); setDeleteGroupKey(null); }}
        onConfirm={handleDeleteVehicles}
        vehicles={deleteGroupKey ? vehiclePrices.filter((p) => makeGroupKey(p) === deleteGroupKey).map((p) => ({
          vehicle_model_id: p.vehicle_model_id,
          vehicle_name: p.vehicle_name,
          品牌: p.品牌,
          车系: p.车系,
          车型: p.车型,
          年款: p.年款,
          排量: p.排量,
          发动机型号: p.发动机型号,
          底盘型号: p.底盘型号,
          变速箱型号: p.变速箱型号,
        })) : []}
        prices={deleteGroupKey ? (() => {
          const sample = vehiclePrices.find((p) => makeGroupKey(p) === deleteGroupKey);
          return sample ? { price: sample.price, vip_price: sample.vip_price, customer_parts_price: sample.customer_parts_price, company_price: sample.company_price } : undefined;
        })() : undefined}
      />
      <VehiclePriceViewModal
        open={vehicleViewModalOpen}
        onClose={() => { setVehicleViewModalOpen(false); setViewVehicles([]); }}
        onDeleteVehicles={(ids) => {
          setVehiclePrices((prev) => prev.filter((p) => !ids.includes(p.vehicle_model_id)));
          setViewVehicles((prev) => prev.filter((p) => !ids.includes(p.vehicle_model_id)));
        }}
        vehicles={viewVehicles.map((p) => ({
          vehicle_model_id: p.vehicle_model_id,
          vehicle_name: p.vehicle_name,
          品牌: p.品牌,
          车系: p.车系,
          车型: p.车型,
          年款: p.年款,
          排量: p.排量,
          发动机型号: p.发动机型号,
          底盘型号: p.底盘型号,
          变速箱型号: p.变速箱型号,
        }))}
      />
    </div>
  );
}
