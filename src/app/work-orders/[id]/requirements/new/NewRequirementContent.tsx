"use client";

import {useState, useEffect, useRef, useMemo} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import { VideoUploader } from "@/components/VideoUploader";
import { ReworkSelectModal } from "@/components/ReworkSelectModal";
import { PriceValue } from "@/components/PriceVisibilityContext";
import { calculateItemCommission, calculatePartCommission } from "@/lib/commission";
import { filterLogisticsBySupplierName, supplierNeedsLogistics } from "@/lib/logisticsFilter";

/* ==================== 类型定义 ==================== */

interface 服务分类 {
  id: string;
  name: string;
}

interface 配件名称 {
  id: string;
  name: string;
  unit: string;
}

interface 配件品牌 {
  name?: string | null;
}

interface 配件实例 {
  id: string;
  part_name_id: string;
  part_number: string;
  specification_text?: string | null;
  unit_cost?: number | null;
  unit_price?: number | null;
  brand_id?: string | null;
  part_brands?: 配件品牌 | null;
}

interface 维修项目分类信息 {
  name?: string | null;
}

interface 维修项目 {
  id: string;
  name: string;
  category_id?: string | null;
  service_name_id?: string | null;
  standard_hours?: number | null;
  default_price?: number | null;
  customer_parts_price?: number | null;
  description?: string | null;
  service_categories?: 维修项目分类信息 | null;
  sales_commission_type?: string | null;
  sales_commission_value?: number | null;
  diagnosis_commission_type?: string | null;
  diagnosis_commission_value?: number | null;
  repair_commission_type?: string | null;
  repair_commission_value?: number | null;
  qc_commission_type?: string | null;
  qc_commission_value?: number | null;
}

interface 维修项目车型定价 {
  service_item_id: string;
  vehicle_model_id: number;
  price?: number | null;
  customer_parts_price?: number | null;
}

interface 供应商 {
  id: string;
  name: string;
  region?: string | null;
}

interface 物流公司 {
  id: string;
  name: string;
  scopes?: string[] | null;
}

interface 员工 {
  id: string;
  full_name: string | null;
}

interface 配件行 {
  part_name_id: string;
  part_id: string;
  quantity: string;
  notes: string;
  part_number: string;
  name: string;
  alias_name: string;
  unit: string;
  brand: string;
  specification: string;
  unit_cost: string;
  unit_price: string;
  customer_opinion: string;
  is_purchased: boolean;
  is_arrived: boolean;
  supplier_name: string;
  logistics_agreement: string;
}

interface 项目行 {
  category_id: string;
  service_name_id: string;
  service_item_id: string;
  name: string;
  alias_name: string;
  item_type: string;
  quantity: string;
  unit_price: string;
  mechanic_id: string;
  submitter_id: string;
  inspector_id: string;
  standard_hours: string;
  customer_opinion: string;
  description: string;
  is_outsourced: boolean;
  is_customer_part: boolean;
  outsourced_supplier_id: string;
  business_type: string;
  rework_source_item_id: string;
  rework_reason: string;
  rework_loss_amount: string;
  parts: 配件行[];
}

interface 搜索下拉状态 {
  query: string;
  results: 维修项目[];
  activeIndex: number;
  show: boolean;
}

interface 新建项目弹窗数据 {
  open: boolean;
  itemIndex: number;
  name: string;
  category_id: string;
  service_name_id: string;
  standard_hours: string;
  description: string;
  default_price: string;
  vip_price: string;
  customer_parts_price: string;
  sales_type: string;
  sales_value: string;
  diagnosis_type: string;
  diagnosis_value: string;
  repair_type: string;
  repair_value: string;
  qc_type: string;
  qc_value: string;
}

interface 批量选择弹窗数据 {
  open: boolean;
  itemIndex: number;
  query: string;
  categoryFilter: string;
  defaultType: string;
  selectedIds: string[];
}

interface 配件匹配弹窗数据 {
  itemIndex: number;
  partIndex: number;
  matchedPart: 配件实例;
}

interface 返工来源项目 {
  id: string;
  work_order_id: string;
}

/* ==================== 组件 ==================== */

export default function NewRequirementContent({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [existingRequirementId, setExistingRequirementId] = useState<string | null>(null);
  const [categories, setCategories] = useState<服务分类[]>([]);
  const [partNames, setPartNames] = useState<配件名称[]>([]);
  const [partsByName, setPartsByName] = useState<Record<string, 配件实例[]>>({});
  const [suppliers, setSuppliers] = useState<供应商[]>([]);
  const [logisticsCompanies, setLogisticsCompanies] = useState<物流公司[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [vehicleModelId, setVehicleModelId] = useState<number | null>(null);
  const [partMatchModal, setPartMatchModal] = useState<配件匹配弹窗数据 | null>(null);
  const [reworkModalIndex, setReworkModalIndex] = useState<number | null>(null);
  const [allServiceItems, setAllServiceItems] = useState<维修项目[]>([]);
  const [serviceItemPrices, setServiceItemPrices] = useState<维修项目车型定价[]>([]);
  const [currentUser, setCurrentUser] = useState<员工 | null>(null);
  const [requirementSubmitters, setRequirementSubmitters] = useState({
    submitted_by: null as string | null,
    diagnosis_submitter_id: null as string | null,
    remarks_submitter_id: null as string | null,
  });
  const [searchDropdowns, setSearchDropdowns] = useState<Record<number, 搜索下拉状态>>({});
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [dropdownPositions, setDropdownPositions] = useState<Record<number, { top: number; left: number }>>({});
  const [newItemModal, setNewItemModal] = useState<新建项目弹窗数据 | null>(null);

  // 批量选择项目弹窗
  const [bulkPickerModal, setBulkPickerModal] = useState<批量选择弹窗数据 | null>(null);

  const [requirement, setRequirement] = useState({ description: "", diagnosis: "", remarks: "" });
  const [requirementImages, setRequirementImages] = useState<string[]>([]);
  const [requirementVideos, setRequirementVideos] = useState<string[]>([]);
  const [items, setItems] = useState<项目行[]>([
    { category_id: "", service_name_id: "", service_item_id: "", name: "", alias_name: "", item_type: "labor", quantity: "1", unit_price: "", mechanic_id: "", submitter_id: "", inspector_id: "", standard_hours: "", customer_opinion: "pending", description: "", is_outsourced: false, is_customer_part: false, outsourced_supplier_id: "", business_type: "normal", rework_source_item_id: "", rework_reason: "", rework_loss_amount: "", parts: [] },
  ]);

  const emptyPart = (): 配件行 => ({
    part_name_id: "",
    part_id: "",
    quantity: "1",
    notes: "",
    part_number: "",
    name: "",
    alias_name: "",
    unit: "",
    brand: "",
    specification: "",
    unit_cost: "",
    unit_price: "",
    customer_opinion: "pending",
    is_purchased: false,
    is_arrived: false,
    supplier_name: "",
    logistics_agreement: "",
  });

  useEffect(() => {
    params.then((p) => setOrderId(p.id));
    supabase.from("service_categories").select("*").order("name").limit(100).then(({ data }) => setCategories((data as 服务分类[]) || []));
    supabase.from("part_names").select("*").order("name").limit(100).then(({ data }) => setPartNames((data as 配件名称[]) || []));
    supabase.from("suppliers").select("*").order("name").limit(100).then(({ data }) => setSuppliers((data as 供应商[]) || []));
    supabase.from("logistics_companies").select("*").order("name").limit(100).then(({ data }) => setLogisticsCompanies((data as 物流公司[]) || []));
    // 加载所有标准项目（含分类信息）
    supabase.from("service_items").select("*, service_categories(name)").order("name").limit(100).then(({ data }) => setAllServiceItems((data as 维修项目[]) || []));
    // 加载员工列表
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").limit(100).then(({ data }) => setProfiles((data as 员工[]) || []));
    // 获取当前用户信息
    supabase.auth.getUser().then(async ({ data: authData }) => {
      if (authData?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", authData.user.id)
          .single();
        setCurrentUser(profile as 员工 | null);
      }
    });
  }, [params, supabase]);

  // 读取 URL 参数中的 requirement_id，如果存在则加载已有需求信息
  useEffect(() => {
    const reqId = searchParams.get("requirement_id");
    if (reqId) {
      setExistingRequirementId(reqId);
      supabase
        .from("work_order_requirements")
        .select("description, diagnosis, remarks, submitted_by, diagnosis_submitter_id, remarks_submitter_id")
        .eq("id", reqId)
        .single()
        .then(({ data }) => {
          if (data) {
            setRequirement({
              description: (data as { description?: string }).description || "",
              diagnosis: (data as { diagnosis?: string }).diagnosis || "",
              remarks: (data as { remarks?: string }).remarks || "",
            });
            setRequirementSubmitters({
              submitted_by: (data as { submitted_by?: string | null }).submitted_by || null,
              diagnosis_submitter_id: (data as { diagnosis_submitter_id?: string | null }).diagnosis_submitter_id || null,
              remarks_submitter_id: (data as { remarks_submitter_id?: string | null }).remarks_submitter_id || null,
            });
          }
        });
      /* 加载已有媒体文件 */
      supabase
        .from("work_order_requirement_media")
        .select("media_type, storage_path")
        .eq("requirement_id", reqId)
        .then(({ data: mediaData }) => {
          if (!mediaData) return;
          const images: string[] = [];
          const videos: string[] = [];
          for (const m of mediaData as { media_type: string; storage_path: string }[]) {
            if (m.media_type === "image") images.push(m.storage_path);
            else if (m.media_type === "video") videos.push(m.storage_path);
          }
          setRequirementImages(images);
          setRequirementVideos(videos);
        });
    }
  }, [searchParams, supabase]);

  // 查询当前工单的车辆车型，用于配件智能匹配和车型定价加载
  useEffect(() => {
    if (!orderId) return;
    supabase
      .from("work_orders")
      .select("vehicle_id")
      .eq("id", orderId)
      .single()
      .then(({ data: wo }) => {
        if ((wo as { vehicle_id?: string } | null)?.vehicle_id) {
          const vid = (wo as { vehicle_id: string }).vehicle_id;
          setVehicleId(vid);
          supabase
            .from("vehicles")
            .select("vehicle_model_id")
            .eq("id", vid)
            .single()
            .then(({ data: v }) => {
              const vmd = (v as { vehicle_model_id?: number } | null)?.vehicle_model_id;
              if (vmd) {
                setVehicleModelId(vmd);
                /* 按当前车型加载维修项目定价，避免全表数据遗漏 */
                supabase
                  .from("service_item_prices")
                  .select("*")
                  .eq("vehicle_model_id", vmd)
                  .then(({ data }) => setServiceItemPrices((data as 维修项目车型定价[]) || []));
              }
            });
        }
      });
  }, [orderId, supabase]);

  function addItem() {
    setItems([...items, { category_id: "", service_name_id: "", service_item_id: "", name: "", alias_name: "", item_type: "labor", quantity: "1", unit_price: "", mechanic_id: "", submitter_id: currentUser?.id || "", inspector_id: "", standard_hours: "", customer_opinion: "pending", description: "", is_outsourced: false, is_customer_part: false, outsourced_supplier_id: "", business_type: "normal", rework_source_item_id: "", rework_reason: "", rework_loss_amount: "", parts: [] }]);
  }

  function addPart(itemIndex: number) {
    const next = [...items];
    next[itemIndex].parts.push(emptyPart());
    setItems(next);
  }

  function updateItem(index: number, field: keyof 项目行, value: string | boolean) {
    const next = [...items];
     
    (next[index] as Record<string, unknown>)[field] = value;

    if (field === "category_id") {
      next[index].service_name_id = "";
      next[index].service_item_id = "";
      next[index].name = "";
      next[index].unit_price = "";
    }

    if (field === "service_item_id") {
      const item = allServiceItems.find((s) => s.id === value);
      if (item) {
        next[index].name = item.name;
        // 优先使用车型定价，无则回退到销售价
        const vPrice = getVehiclePrice(item.id, vehicleModelId);
        next[index].unit_price = vPrice?.toString() ?? item.default_price?.toString() ?? "";
        next[index].standard_hours = item.standard_hours?.toString() || "";
      }
    }

    // 自带配件勾选/取消时自动调整价格
    if (field === "is_customer_part") {
      const serviceItem = allServiceItems.find((s) => s.id === next[index].service_item_id);
      if (value === true) {
        // 勾选：按四级策略定价
        const cpPrice = getCustomerPartPrice(next[index].service_item_id, vehicleModelId);
        if (cpPrice != null) {
          next[index].unit_price = cpPrice.toString();
        }
      } else {
        // 取消：恢复为项目默认销售价
        if (serviceItem?.default_price != null) {
          next[index].unit_price = serviceItem.default_price.toString();
        }
      }
    }

    setItems(next);
  }

  function updatePart(itemIndex: number, partIndex: number, field: keyof 配件行, value: string | boolean) {
    const next = [...items];
     
    (next[itemIndex].parts[partIndex] as Record<string, unknown>)[field] = value;

    if (field === "part_name_id") {
      next[itemIndex].parts[partIndex].part_id = "";
      // 自动填充名称和单位
      const pn = partNames.find((n) => n.id === value);
      if (pn) {
        next[itemIndex].parts[partIndex].name = pn.name;
        next[itemIndex].parts[partIndex].unit = pn.unit;
      }
      // 加载该配件名称下的具体配件
      if (value) {
        supabase.from("parts").select("*, part_brands(name)").eq("part_name_id", value as string).order("created_at").then(({ data }) => {
          setPartsByName((prev) => ({ ...prev, [value as string]: (data as 配件实例[]) || [] }));
        });
      }
    }

    if (field === "part_id" && value) {
      const part = (partsByName[next[itemIndex].parts[partIndex].part_name_id] || []).find((p) => p.id === value);
      if (part) {
        next[itemIndex].parts[partIndex].brand = part.part_brands?.name || "";
        next[itemIndex].parts[partIndex].specification = part.specification_text || "";
        next[itemIndex].parts[partIndex].unit_cost = part.unit_cost?.toString() || "";
        next[itemIndex].parts[partIndex].unit_price = part.unit_price?.toString() || "";
      }
    }

    setItems(next);
  }

  // 维修项目客户意见循环切换
  function cycleItemCustomerOpinion(index: number) {
    const next = [...items];
    const current = next[index].customer_opinion;
    const cycle: Record<string, string> = { pending: "agree", agree: "reject", reject: "pending" };
    next[index].customer_opinion = cycle[current] || "pending";
    setItems(next);
  }

  // 通过配件编码查询并自动填充分支
  async function searchPartByNumber(itemIndex: number, partIndex: number, partNumber: string) {
    if (!partNumber.trim()) return;
    const { data: matched } = await supabase
      .from("parts")
      .select("*, part_names(id, name, unit), part_brands(name)")
      .eq("part_number", partNumber.trim())
      .single();

    if (matched) {
      const m = matched as {
        id: string;
        part_names?: { id?: string; name?: string; unit?: string } | null;
        part_brands?: { name?: string } | null;
        specification_text?: string | null;
        unit_cost?: number | null;
        unit_price?: number | null;
      };
      const next = [...items];
      next[itemIndex].parts[partIndex].part_name_id = m.part_names?.id || "";
      next[itemIndex].parts[partIndex].part_id = m.id;
      next[itemIndex].parts[partIndex].name = m.part_names?.name || "";
      next[itemIndex].parts[partIndex].unit = m.part_names?.unit || "";
      next[itemIndex].parts[partIndex].brand = m.part_brands?.name || "";
      next[itemIndex].parts[partIndex].specification = m.specification_text || "";
      next[itemIndex].parts[partIndex].unit_cost = m.unit_cost?.toString() || "";
      next[itemIndex].parts[partIndex].unit_price = m.unit_price?.toString() || "";
      next[itemIndex].parts[partIndex].part_number = partNumber.trim();
      setItems(next);
      // 加载该配件名称下的具体配件列表
      if (m.part_names?.id) {
        supabase.from("parts").select("*, part_brands(name)").eq("part_name_id", m.part_names.id).order("created_at").then(({ data }) => {
          setPartsByName((prev) => ({ ...prev, [m.part_names!.id]: (data as 配件实例[]) || [] }));
        });
      }
    }
  }

  // 配件智能匹配：名称+品牌+车型 相同则提示
  async function checkPartMatch(itemIndex: number, partIndex: number) {
    const part = items[itemIndex]?.parts[partIndex];
    if (!part?.part_name_id || !part?.brand || !vehicleModelId) return;

    // 1. 根据品牌名称查找 brand_id
    const { data: brandData } = await supabase
      .from("part_brands")
      .select("id")
      .eq("name", part.brand)
      .single();
    if (!brandData) return;

    // 2. 查找该车下关联的配件
    const { data: modelLinks } = await supabase
      .from("part_vehicle_models")
      .select("part_id")
      .eq("vehicle_model_id", vehicleModelId);
    const partIds = modelLinks?.map((m) => (m as { part_id: string }).part_id) || [];
    if (partIds.length === 0) return;

    // 3. 匹配相同名称、品牌的配件
    const { data: matchedParts } = await supabase
      .from("parts")
      .select("*, part_brands(name)")
      .eq("part_name_id", part.part_name_id)
      .eq("brand_id", (brandData as { id: string }).id)
      .in("id", partIds);

    if (matchedParts && matchedParts.length > 0) {
      setPartMatchModal({
        itemIndex,
        partIndex,
        matchedPart: matchedParts[0] as 配件实例,
      });
    }
  }

  function applyMatchedPart() {
    if (!partMatchModal) return;
    const { itemIndex, partIndex, matchedPart } = partMatchModal;
    const next = [...items];
    next[itemIndex].parts[partIndex].part_id = matchedPart.id;
    next[itemIndex].parts[partIndex].part_number = matchedPart.part_number || "";
    next[itemIndex].parts[partIndex].specification = matchedPart.specification_text || "";
    next[itemIndex].parts[partIndex].unit_cost = matchedPart.unit_cost?.toString() || "";
    next[itemIndex].parts[partIndex].unit_price = matchedPart.unit_price?.toString() || "";
    setItems(next);
    setPartMatchModal(null);
  }

  // 客户意见循环切换
  function cycleCustomerOpinion(itemIndex: number, partIndex: number) {
    const next = [...items];
    const current = next[itemIndex].parts[partIndex].customer_opinion;
    const cycle: Record<string, string> = { pending: "agree", agree: "reject", reject: "pending" };
    next[itemIndex].parts[partIndex].customer_opinion = cycle[current] || "pending";
    // 如果客户意见变为非同意，自动取消采购和到货
    if (next[itemIndex].parts[partIndex].customer_opinion !== "agree") {
      next[itemIndex].parts[partIndex].is_purchased = false;
      next[itemIndex].parts[partIndex].is_arrived = false;
    }
    setItems(next);
  }

  // 采购状态切换（仅在客户同意时）
  function togglePurchased(itemIndex: number, partIndex: number) {
    const next = [...items];
    if (!next[itemIndex].parts[partIndex].is_purchased) {
      // 要打开采购，必须客户已同意
      if (next[itemIndex].parts[partIndex].customer_opinion !== "agree") {
        alert("请先确认客户同意后再标记已采购");
        return;
      }
    }
    next[itemIndex].parts[partIndex].is_purchased = !next[itemIndex].parts[partIndex].is_purchased;
    // 如果取消采购，自动取消到货
    if (!next[itemIndex].parts[partIndex].is_purchased) {
      next[itemIndex].parts[partIndex].is_arrived = false;
    }
    setItems(next);
  }

  // 到货状态切换（仅在已采购时）
  function toggleArrived(itemIndex: number, partIndex: number) {
    const next = [...items];
    if (!next[itemIndex].parts[partIndex].is_arrived) {
      // 要打开到货，必须已采购
      if (!next[itemIndex].parts[partIndex].is_purchased) {
        alert("请先标记已采购后再标记已到货");
        return;
      }
    }
    next[itemIndex].parts[partIndex].is_arrived = !next[itemIndex].parts[partIndex].is_arrived;
    setItems(next);
  }

  function removePart(itemIndex: number, partIndex: number) {
    const next = [...items];
    next[itemIndex].parts.splice(partIndex, 1);
    setItems(next);
  }

  // 搜索项目库
  function filterServiceItems(query: string) {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    return allServiceItems
      .filter((item) => item.name?.toLowerCase().includes(lower))
      .slice(0, 10);
  }

  function handleSearchInput(index: number, value: string) {
    // 同步输入到项目名称，即使用户没有选择下拉项也能保存
    const next = [...items];
    next[index].name = value;
    setItems(next);

    const results = filterServiceItems(value);
    // 只要有输入就显示下拉（包含新建按钮）
    const show = value.trim().length > 0;
    setSearchDropdowns((prev) => ({
      ...prev,
      [index]: {
        query: value,
        results,
        activeIndex: 0,
        show,
      },
    }));
  }

  function handleSearchKeyDown(index: number, e: React.KeyboardEvent) {
    const state = searchDropdowns[index];
    if (!state || !state.show) return;

    // 总选项数 = 搜索结果数 + 1个新建按钮
    const totalOptions = state.results.length + 1;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSearchDropdowns((prev) => ({
          ...prev,
          [index]: {
            ...state,
            activeIndex: (state.activeIndex + 1) % totalOptions,
          },
        }));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSearchDropdowns((prev) => ({
          ...prev,
          [index]: {
            ...state,
            activeIndex: state.activeIndex <= 0 ? totalOptions - 1 : state.activeIndex - 1,
          },
        }));
        break;
      case "Enter":
        e.preventDefault();
        if (state.activeIndex >= 0 && state.activeIndex < state.results.length) {
          selectServiceItem(index, state.results[state.activeIndex]);
        } else if (state.activeIndex === state.results.length) {
          // 选中"新建项目"
          setNewItemModal({
            open: true,
            itemIndex: index,
            name: state.query,
            category_id: "",
            service_name_id: "",
            standard_hours: "",
            description: "",
            default_price: "",
            vip_price: "",
            customer_parts_price: "",
            sales_type: "",
            sales_value: "",
            diagnosis_type: "",
            diagnosis_value: "",
            repair_type: "",
            repair_value: "",
            qc_type: "",
            qc_value: "",
          });
          setSearchDropdowns((prev) => ({ ...prev, [index]: { ...prev[index], show: false } }));
        }
        break;
      case "Escape":
        setSearchDropdowns((prev) => ({
          ...prev,
          [index]: { ...state, show: false },
        }));
        break;
    }
  }

  // 车型定价：优先取 service_item_prices 中匹配车型的 price，无则回退到项目销售价
  function getVehiclePrice(serviceItemId: string, vModelId: number | null): number | null {
    if (!serviceItemId || !vModelId) return null;
    const serviceItem = allServiceItems.find((s) => s.id === serviceItemId);
    const vehiclePrice = serviceItemPrices.find(
      (p) => p.service_item_id === serviceItemId && p.vehicle_model_id === vModelId
    )?.price;
    if (vehiclePrice != null) return vehiclePrice;
    if (serviceItem?.default_price != null) return serviceItem.default_price;
    return null;
  }

  // 自带配件四级价格策略
  function getCustomerPartPrice(serviceItemId: string, vModelId: number | null): number | null {
    if (!serviceItemId || !vModelId) return null;
    const serviceItem = allServiceItems.find((s) => s.id === serviceItemId);

    // 1. 维修项目中设置工单车型的自带配件价格
    const vehicleCp = serviceItemPrices.find(
      (p) => p.service_item_id === serviceItemId && p.vehicle_model_id === vModelId
    )?.customer_parts_price;
    if (vehicleCp != null) return vehicleCp;

    // 2. 工单车型定价
    const vehiclePrice = serviceItemPrices.find(
      (p) => p.service_item_id === serviceItemId && p.vehicle_model_id === vModelId
    )?.price;
    if (vehiclePrice != null) return vehiclePrice;

    // 3. 维修项目的自带配件价格
    if (serviceItem?.customer_parts_price != null) return serviceItem.customer_parts_price;

    // 4. 项目销售价
    if (serviceItem?.default_price != null) return serviceItem.default_price;

    return null;
  }

  function selectServiceItem(index: number, serviceItem: 维修项目) {
    const next = [...items];
    next[index].service_item_id = serviceItem.id;
    next[index].category_id = serviceItem.category_id || "";
    next[index].name = serviceItem.name || "";
    next[index].standard_hours = serviceItem.standard_hours?.toString() || "";

    // 自带配件时按四级策略定价，否则优先使用车型定价
    if (next[index].is_customer_part) {
      const cpPrice = getCustomerPartPrice(serviceItem.id, vehicleModelId);
      next[index].unit_price = cpPrice?.toString() ?? "";
    } else {
      const vPrice = getVehiclePrice(serviceItem.id, vehicleModelId);
      next[index].unit_price = vPrice?.toString() ?? serviceItem.default_price?.toString() ?? "";
    }

    setItems(next);

    setSearchDropdowns((prev) => ({
      ...prev,
      [index]: { query: serviceItem.name || "", results: [], activeIndex: -1, show: false },
    }));
  }

  // 打开批量选择项目弹窗
  function openBulkPicker(itemIndex: number) {
    setBulkPickerModal({
      open: true,
      itemIndex,
      query: "",
      categoryFilter: "",
      defaultType: "labor",
      selectedIds: [],
    });
  }

  // 切换勾选某个服务项目
  function toggleBulkSelection(serviceItemId: string) {
    setBulkPickerModal((prev) => {
      if (!prev) return prev;
      const exists = prev.selectedIds.includes(serviceItemId);
      return {
        ...prev,
        selectedIds: exists
          ? prev.selectedIds.filter((id) => id !== serviceItemId)
          : [...prev.selectedIds, serviceItemId],
      };
    });
  }

  // 批量添加选中项目
  function batchAddSelectedItems() {
    if (!bulkPickerModal) return;
    const { itemIndex, selectedIds, defaultType } = bulkPickerModal;
    if (selectedIds.length === 0) {
      alert("请至少勾选一个项目");
      return;
    }

    // 排除已存在于当前表单中的同名项目
    const existingNames = new Set(items.map((it) => it.name).filter(Boolean));
    const picked = selectedIds
      .map((id) => allServiceItems.find((s) => s.id === id))
      .filter(Boolean) as 维修项目[];

    const filtered = picked.filter((si) => !existingNames.has(si.name) || (items[itemIndex]?.name === "" && items[itemIndex]?.service_item_id === ""));
    const duplicates = picked.filter((si) => existingNames.has(si.name) && !(items[itemIndex]?.name === "" && items[itemIndex]?.service_item_id === ""));

    if (filtered.length === 0) {
      alert("勾选的项目都已存在于当前表单，无需重复添加");
      return;
    }

    const buildRow = (si: 维修项目): 项目行 => {
      const isCustomerPart = false; // 批量添加默认非自带配件
      // 优先使用车型定价
      const vPrice = getVehiclePrice(si.id, vehicleModelId);
      const unitPrice = vPrice?.toString() ?? si.default_price?.toString() ?? "";
      return {
        category_id: si.category_id || "",
        service_item_id: si.id,
        name: si.name || "",
        alias_name: "",
        item_type: defaultType,
        quantity: "1",
        unit_price: unitPrice,
        mechanic_id: "",
        submitter_id: currentUser?.id || "",
        inspector_id: "",
        standard_hours: si.standard_hours?.toString() || "",
        customer_opinion: "pending",
        description: si.description || "",
        is_outsourced: false,
        is_customer_part: isCustomerPart,
        outsourced_supplier_id: "",
        business_type: "normal",
        rework_source_item_id: "",
        rework_reason: "",
        rework_loss_amount: "",
        parts: [],
      };
    };

    const next = [...items];
    const target = next[itemIndex];
    let cursor = 0;
    // 若当前行未选项目，则把第一项填充进去
    if (target && !target.service_item_id && !target.name) {
      next[itemIndex] = buildRow(filtered[0]);
      cursor = 1;
    }
    for (let i = cursor; i < filtered.length; i++) {
      next.push(buildRow(filtered[i]));
    }
    setItems(next);
    setBulkPickerModal(null);

    if (duplicates.length > 0) {
      setTimeout(() => {
        alert(`已跳过 ${duplicates.length} 个重复项目：${duplicates.map((d) => d.name).join("、")}`);
      }, 50);
    }
  }

  // 新建标准项目
  async function createNewServiceItem() {
    if (!newItemModal) return;
    const m = newItemModal;
    if (!m.name.trim()) {
      alert("请输入项目名称");
      return;
    }
    const { data, error } = await supabase
      .from("service_items")
      .insert({
        name: m.name.trim(),
        category_id: m.category_id || null,
        description: m.description || null,
        default_price: parseFloat(m.default_price) || 0,
        vip_price: m.vip_price ? parseFloat(m.vip_price) : null,
        customer_parts_price: m.customer_parts_price ? parseFloat(m.customer_parts_price) : null,
        standard_hours: m.standard_hours ? parseFloat(m.standard_hours) : null,
        sales_commission_type: m.sales_type || null,
        sales_commission_value: m.sales_value ? parseFloat(m.sales_value) : null,
        diagnosis_commission_type: m.diagnosis_type || null,
        diagnosis_commission_value: m.diagnosis_value ? parseFloat(m.diagnosis_value) : null,
        repair_commission_type: m.repair_type || null,
        repair_commission_value: m.repair_value ? parseFloat(m.repair_value) : null,
        qc_commission_type: m.qc_type || null,
        qc_commission_value: m.qc_value ? parseFloat(m.qc_value) : null,
      })
      .select("*, service_categories(name)")
      .single();

    if (error || !data) {
      alert("新建项目失败: " + (error?.message || "未知错误"));
      return;
    }

    // 刷新列表并自动选中
    setAllServiceItems((prev) => [...prev, data as 维修项目]);
    selectServiceItem(m.itemIndex, data as 维修项目);
    setNewItemModal(null);
  }

  // 计算维修项目预估提成
  function getItemCommissionPreview(index: number) {
    const item = items[index];
    if (!item.name) return null;
    const revenue = (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0);
    const serviceItem = allServiceItems.find((s) => s.id === item.service_item_id);
    const category = categories.find((c) => c.id === item.category_id);
    return calculateItemCommission(item, serviceItem, null, category, revenue, 0);
  }

  // 计算配件预估提成
  function getPartCommissionPreview(itemIndex: number, partIndex: number) {
    const part = items[itemIndex]?.parts[partIndex];
    if (!part?.part_name_id) return null;
    const qty = parseFloat(part.quantity) || 1;
    const revenue = qty * (parseFloat(part.unit_price) || 0);
    const cost = qty * (parseFloat(part.unit_cost) || 0);
    const partInstance = (partsByName[part.part_name_id] || []).find((p) => p.id === part.part_id);
    const partName = partNames.find((pn) => pn.id === part.part_name_id);
    return calculatePartCommission(partInstance, partName, revenue, cost);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    setLoading(true);

    try {
      let reqId: string;

      if (existingRequirementId) {
        // 为已有需求添加项目，不创建新需求
        reqId = existingRequirementId;
      } else {
        // 创建新需求
        const description = requirement.description.trim();
        const diagnosis = requirement.diagnosis.trim();
        const remarks = requirement.remarks.trim();
        if (!description) {
          alert("客户需求不能为空");
          setLoading(false);
          return;
        }
        const { data: req, error: reqError } = await supabase
          .from("work_order_requirements")
          .insert({
            work_order_id: orderId,
            description,
            diagnosis: diagnosis || null,
            remarks: remarks || null,
            submitted_by: currentUser?.id || null,
            diagnosis_submitter_id: diagnosis ? currentUser?.id || null : null,
            remarks_submitter_id: remarks ? currentUser?.id || null : null,
          })
          .select("id")
          .single();

        if (reqError || !req) throw reqError || new Error("创建需求失败");
        reqId = (req as { id: string }).id;

        // 保存需求图片
        if (requirementImages.length > 0) {
          const mediaRecords = requirementImages.map((path) => ({
            requirement_id: reqId,
            media_type: "image" as const,
            storage_path: path,
          }));
          await supabase.from("work_order_requirement_media").insert(mediaRecords);
        }

        // 保存需求视频
        if (requirementVideos.length > 0) {
          const videoRecords = requirementVideos.map((path) => ({
            requirement_id: reqId,
            media_type: "video" as const,
            storage_path: path,
          }));
          await supabase.from("work_order_requirement_media").insert(videoRecords);
        }
      }

      // 查询当前工单已有项目名称，防止重复
      const { data: existingItems } = await supabase
        .from("work_order_items")
        .select("name")
        .eq("work_order_id", orderId);
      const existingNames = new Set((existingItems as { name: string }[] | null)?.map((i) => i.name) || []);

      // 检查本次添加的项目之间是否有重复
      const newNames = new Set<string>();
      for (const item of items) {
        if (!item.name) continue;
        if (newNames.has(item.name)) {
          alert(`项目名称 "${item.name}" 在当前表单中重复，请检查`);
          setLoading(false);
          return;
        }
        newNames.add(item.name);
      }

      for (const item of items) {
        if (!item.name) continue;
        if (existingNames.has(item.name)) {
          alert(`项目名称 "${item.name}" 已在工单中存在，不能重复添加`);
          setLoading(false);
          return;
        }
        const { data: createdItem, error: itemError } = await supabase.from("work_order_items").insert({
          work_order_id: orderId,
          requirement_id: reqId,
          service_item_id: item.service_item_id || null,
          name: item.name,
          alias_name: item.alias_name || null,
          item_type: item.item_type,
          description: item.description || null,
          quantity: parseFloat(item.quantity) || 1,
          unit_price: parseFloat(item.unit_price) || 0,
          mechanic_id: item.mechanic_id || null,
          submitter_id: item.submitter_id || currentUser?.id || null,
          inspector_id: item.inspector_id || null,
          customer_opinion: item.customer_opinion || "pending",
          is_outsourced: item.is_outsourced || false,
          is_customer_part: item.is_customer_part || false,
          outsourced_supplier_id: item.outsourced_supplier_id || null,
          business_type: item.business_type || "normal",
          rework_source_item_id: item.rework_source_item_id || null,
          rework_reason: item.rework_reason || null,
          rework_loss_amount: item.rework_loss_amount ? parseFloat(item.rework_loss_amount) : null,
        }).select("id").single();

        if (itemError || !createdItem) throw itemError || new Error("创建项目失败");

        // 创建项目配件
        for (const part of item.parts) {
          if (!part.part_name_id) continue;
          const { error: partError } = await supabase.from("work_order_item_parts").insert({
            work_order_item_id: (createdItem as { id: string }).id,
            part_name_id: part.part_name_id,
            part_id: part.part_id || null,
            quantity: parseInt(part.quantity) || 1,
            notes: part.notes || null,
            part_number: part.part_number || null,
            name: part.name || null,
            alias_name: part.alias_name || null,
            unit: part.unit || null,
            brand: part.brand || null,
            specification: part.specification || null,
            unit_cost: parseFloat(part.unit_cost) || null,
            unit_price: parseFloat(part.unit_price) || null,
            customer_opinion: part.customer_opinion || "pending",
            is_purchased: part.is_purchased || false,
            is_arrived: part.is_arrived || false,
            supplier_name: part.supplier_name || null,
            logistics_agreement: part.logistics_agreement || null,
          });
          if (partError) throw partError;
        }
      }

      router.push(`/work-orders/${orderId}`);
      router.refresh();
    } catch (err: unknown) {
      let msg = "未知错误";
      if (err instanceof Error) {
        msg = err.message;
      } else if (err && typeof err === "object" && "message" in err) {
        msg = String((err as Record<string, unknown>).message);
      } else if (err && typeof err === "object" && "error" in err) {
        msg = String((err as Record<string, unknown>).error);
      } else {
        msg = String(err);
      }
      console.error("保存需求异常:", err);
      alert("保存失败: " + msg);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title={existingRequirementId ? "为需求添加维修项目" : "添加诊断与维修项目"} />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="space-y-6">
          {existingRequirementId ? (
            // 为已有需求添加项目：只读显示需求信息
            <div className="bg-gray-50 rounded-lg p-4 flex flex-wrap gap-x-6 gap-y-2 text-sm items-center">
              <span><span className="text-gray-500">客户需求:</span> <span className="font-medium text-gray-900">{requirement.description || "-"}</span></span>
              {requirement.diagnosis && <span><span className="text-gray-500">诊断:</span> {requirement.diagnosis}</span>}
              {requirement.remarks && <span><span className="text-gray-500">备注:</span> {requirement.remarks}</span>}
              {requirementSubmitters.submitted_by && <span className="text-gray-400 text-xs">提交人: {currentUser?.id === requirementSubmitters.submitted_by ? currentUser?.full_name : "他人"}</span>}
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-base font-semibold text-gray-900 mb-3">客户需求</h2>
                <input required placeholder="如：发动机异响" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={requirement.description} onChange={(e) => setRequirement({ ...requirement, description: e.target.value })} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 mb-3">诊断结果</h2>
                <textarea rows={2} placeholder="如：皮带轮轴承损坏" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={requirement.diagnosis} onChange={(e) => setRequirement({ ...requirement, diagnosis: e.target.value })} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 mb-3">备注（技师说明）</h2>
                <textarea rows={2} placeholder="补充说明..." className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={requirement.remarks} onChange={(e) => setRequirement({ ...requirement, remarks: e.target.value })} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 mb-3">需求图片</h2>
                <ImageUploader onUpload={setRequirementImages} existingImages={requirementImages} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 mb-3">需求视频（自动加水印）</h2>
                <VideoUploader onUpload={setRequirementVideos} existingVideos={requirementVideos} watermark />
              </div>
            </>
          )}

          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">维修项目</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => openBulkPicker(items.length - 1)}
                  className="text-sm px-3 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50"
                >
                  📋 批量选择
                </button>
                <button type="button" onClick={addItem} className="text-sm text-blue-600 hover:text-blue-700">+ 添加项目</button>
              </div>
            </div>
            <div className="space-y-4">
              {items.map((item, i) => (
                <div key={i} className="p-4 bg-gray-50 rounded-lg space-y-3">
                  {/* 项目信息单行 */}
                  <div className="flex gap-2 items-end overflow-x-auto pb-1">
                    <div className="w-36 relative z-20">
                      <label className="block text-xs text-gray-500 mb-1">项目名称 *</label>
                      <input
                        ref={(el) => { inputRefs.current[i] = el; }}
                        type="text"
                        required
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        placeholder="搜索项目库..."
                        value={searchDropdowns[i]?.query || item.name || ""}
                        onChange={(e) => handleSearchInput(i, e.target.value)}
                        onKeyDown={(e) => handleSearchKeyDown(i, e)}
                        onFocus={() => {
                          const state = searchDropdowns[i];
                          if (state?.query?.trim().length > 0) {
                            setSearchDropdowns((prev) => ({ ...prev, [i]: { ...prev[i], show: true } }));
                          }
                          const rect = inputRefs.current[i]?.getBoundingClientRect();
                          if (rect) {
                            setDropdownPositions((prev) => ({ ...prev, [i]: { top: rect.bottom + 4, left: rect.left } }));
                          }
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setSearchDropdowns((prev) => {
                              const state = prev[i];
                              if (!state) return prev;
                              return { ...prev, [i]: { ...state, show: false } };
                            });
                          }, 150);
                        }}
                      />
                      {searchDropdowns[i]?.show && searchDropdowns[i]?.query?.trim().length > 0 && dropdownPositions[i] && (
                        <div className="fixed z-50 w-96 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto" style={{ top: dropdownPositions[i].top, left: dropdownPositions[i].left }}>
                          {searchDropdowns[i].results.map((si, idx) => (
                            <div
                              key={si.id}
                              className={`px-3 py-2 text-sm cursor-pointer ${
                                idx === searchDropdowns[i].activeIndex ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50"
                              }`}
                              onClick={() => selectServiceItem(i, si)}
                              onMouseEnter={() => setSearchDropdowns((prev) => ({
                                ...prev,
                                [i]: { ...prev[i], activeIndex: idx },
                              }))}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">{si.name}</span>
                                <span className="text-xs text-blue-600 shrink-0">{si.default_price != null ? `${si.default_price}元` : "-"}</span>
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                                <span>分类: {si.service_categories?.name || "-"}</span>
                                <span>类型: 工时</span>
                              </div>
                              {si.description && (
                                <div className="text-xs text-gray-400 mt-0.5 truncate">备注: {si.description}</div>
                              )}
                            </div>
                          ))}
                          <div
                            className={`px-3 py-2 text-sm cursor-pointer border-t border-dashed border-gray-200 ${
                              searchDropdowns[i].activeIndex === searchDropdowns[i].results.length
                                ? "bg-blue-50 text-blue-700"
                                : "hover:bg-gray-50 text-gray-500"
                            }`}
                            onClick={() => {
                              setNewItemModal({
                                open: true,
                                itemIndex: i,
                                name: searchDropdowns[i].query,
                                category_id: "",
                                service_name_id: "",
                                standard_hours: "",
                                description: "",
                                default_price: "",
                                vip_price: "",
                                customer_parts_price: "",
                                sales_type: "",
                                sales_value: "",
                                diagnosis_type: "",
                                diagnosis_value: "",
                                repair_type: "",
                                repair_value: "",
                                qc_type: "",
                                qc_value: "",
                              });
                              setSearchDropdowns((prev) => ({ ...prev, [i]: { ...prev[i], show: false } }));
                            }}
                            onMouseEnter={() => setSearchDropdowns((prev) => ({
                              ...prev,
                              [i]: { ...prev[i], activeIndex: prev[i].results.length },
                            }))}
                          >
                            <div className="font-medium">+ 新建项目</div>
                            <div className="text-xs text-gray-400">未找到匹配项目？点击创建</div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="w-20">
                      <label className="block text-xs text-gray-500 mb-1">别名</label>
                      <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        placeholder="显示用"
                        value={item.alias_name}
                        onChange={(e) => updateItem(i, "alias_name", e.target.value)} />
                    </div>
                    <div className="w-20">
                      <label className="block text-xs text-gray-500 mb-1">类型</label>
                      <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.item_type} onChange={(e) => updateItem(i, "item_type", e.target.value)}>
                        <option value="labor">工时</option>
                        <option value="part">配件</option>
                        <option value="other">其他</option>
                      </select>
                    </div>
                    <div className="w-20">
                      <label className="block text-xs text-gray-500 mb-1">单价</label>
                      <input type="number" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.unit_price} onChange={(e) => updateItem(i, "unit_price", e.target.value)} />
                    </div>
                    <div className="w-20">
                      <label className="block text-xs text-gray-500 mb-1">客户意见</label>
                      <button
                        type="button"
                        onClick={() => cycleItemCustomerOpinion(i)}
                        className={`w-full px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                          item.customer_opinion === 'agree'
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : item.customer_opinion === 'reject'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-gray-50 text-gray-500 border-gray-200'
                        }`}
                      >
                        {item.customer_opinion === 'agree' ? '✓ 同意' : item.customer_opinion === 'reject' ? '✗ 拒绝' : '待确认'}
                      </button>
                    </div>
                    <div className="w-24">
                      <label className="block text-xs text-gray-500 mb-1">业务类型</label>
                      <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.business_type}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'rework') {
                            setReworkModalIndex(i);
                          } else {
                            const next = [...items];
                            next[i].rework_source_item_id = "";
                            next[i].rework_reason = "";
                            next[i].rework_loss_amount = "";
                            setItems(next);
                          }
                          updateItem(i, "business_type", val);
                        }}
                      >
                        <option value="normal">正常</option>
                        <option value="insurance">保险</option>
                        <option value="gift">赠送</option>
                        <option value="rework">返工</option>
                      </select>
                    </div>
                    <div className="w-28">
                      <label className="block text-xs text-gray-500 mb-1">备注</label>
                      <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        placeholder="备注"
                        value={item.description}
                        onChange={(e) => updateItem(i, "description", e.target.value)}
                      />
                    </div>
                  </div>

                  {/* 预估提成 */}
                  {(() => {
                    const comm = getItemCommissionPreview(i);
                    if (!comm || (comm.diagnosis === 0 && comm.repair === 0 && comm.sales === 0 && comm.qc === 0)) return null;
                    return (
                      <div className="flex flex-wrap gap-3 text-xs">
                        <span className="text-gray-400">预估提成:</span>
                        {comm.diagnosis > 0 && <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded">诊断 {comm.diagnosis.toFixed(2)}元</span>}
                        {comm.repair > 0 && <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded">维修 {comm.repair.toFixed(2)}元</span>}
                        {comm.sales > 0 && <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded">销售 {comm.sales.toFixed(2)}元</span>}
                        {comm.qc > 0 && <span className="text-purple-600 bg-purple-50 px-2 py-0.5 rounded">质检 {comm.qc.toFixed(2)}元</span>}
                      </div>
                    );
                  })()}

                  {/* 返工信息 */}
                  {item.business_type === 'rework' && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end bg-orange-50 p-3 rounded-lg">
                      <div className="sm:col-span-4">
                        <label className="block text-xs text-gray-500 mb-1">返工原因</label>
                        <select
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                          value={item.rework_reason}
                          onChange={(e) => updateItem(i, "rework_reason", e.target.value)}
                        >
                          <option value="">请选择</option>
                          <option value="part_quality">配件质量</option>
                          <option value="workmanship">施工原因</option>
                        </select>
                      </div>
                      {item.rework_reason === 'workmanship' && (
                        <div className="sm:col-span-3">
                          <label className="block text-xs text-gray-500 mb-1">损失金额 (元)</label>
                          <input
                            type="number"
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            placeholder="0.00"
                            value={item.rework_loss_amount}
                            onChange={(e) => updateItem(i, "rework_loss_amount", e.target.value)}
                          />
                        </div>
                      )}
                      {item.rework_source_item_id && (
                        <div className="sm:col-span-5 text-xs text-gray-500 flex items-center">
                          已关联原始项目
                          <button
                            type="button"
                            onClick={() => setReworkModalIndex(i)}
                            className="ml-2 text-blue-600 hover:text-blue-700 underline"
                          >
                            重新选择
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 配件列表 */}
                  <div className="border-t border-gray-200 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-medium text-gray-700">所需配件</h3>
                      <button type="button" onClick={() => addPart(i)} className="text-xs text-blue-600 hover:text-blue-700">+ 添加配件</button>
                    </div>
                    <div className="space-y-3">
                      {item.parts.map((part, pi) => (
                        <div key={pi} className="bg-white p-3 rounded border border-gray-200 space-y-3">
                          {/* 第一行：配件编码 + 名称库 + 具体配件 + 数量 + 备注 + 删除 */}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                            <div className="sm:col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">配件编码 / 条码</label>
                              <div className="flex gap-1">
                                <input
                                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs"
                                  placeholder="输入编码或扫码"
                                  value={part.part_number}
                                  onChange={(e) => updatePart(i, pi, "part_number", e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchPartByNumber(i, pi, part.part_number); } }}
                                />
                                <button
                                  type="button"
                                  onClick={() => searchPartByNumber(i, pi, part.part_number)}
                                  className="px-2 py-1.5 text-xs bg-gray-100 text-gray-600 border border-gray-300 rounded hover:bg-gray-200"
                                  title="查询"
                                >
                                  查
                                </button>
                              </div>
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">配件名称 *</label>
                              <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                value={part.part_name_id} onChange={(e) => updatePart(i, pi, "part_name_id", e.target.value)}>
                                <option value="">请选择</option>
                                {partNames.map((pn) => <option key={pn.id} value={pn.id}>{pn.name}</option>)}
                              </select>
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">具体配件（可选）</label>
                              <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                value={part.part_id} onChange={(e) => updatePart(i, pi, "part_id", e.target.value)}>
                                <option value="">空分支 / 待指定</option>
                                {(partsByName[part.part_name_id] || []).map((p) => (
                                  <option key={p.id} value={p.id}>{p.part_brands?.name || "无品牌"} {p.specification_text || ""}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-1">
                              <label className="block text-xs text-gray-500 mb-1">数量</label>
                              <input type="number" min="1" className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                value={part.quantity} onChange={(e) => updatePart(i, pi, "quantity", e.target.value)} />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">备注</label>
                              <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                placeholder="补充说明" value={part.notes} onChange={(e) => updatePart(i, pi, "notes", e.target.value)} />
                            </div>
                            <div className="sm:col-span-1">
                              <button type="button" onClick={() => removePart(i, pi)} className="w-full px-2 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">删除</button>
                            </div>
                          </div>

                          {/* 第二行：空分支时手动填写的基础信息 */}
                          <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">配件编号</label>
                              <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                placeholder="编号" value={part.part_number} onChange={(e) => updatePart(i, pi, "part_number", e.target.value)} />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">名称</label>
                              <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                placeholder="名称" value={part.name} onChange={(e) => updatePart(i, pi, "name", e.target.value)} />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">别名</label>
                              <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                placeholder="显示用" value={part.alias_name} onChange={(e) => updatePart(i, pi, "alias_name", e.target.value)} />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">单位</label>
                              <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                placeholder="单位" value={part.unit} onChange={(e) => updatePart(i, pi, "unit", e.target.value)} />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">品牌</label>
                              <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                placeholder="品牌" value={part.brand}
                                onChange={(e) => updatePart(i, pi, "brand", e.target.value)}
                                onBlur={() => checkPartMatch(i, pi)} />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">规格</label>
                              <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                placeholder="规格" value={part.specification} onChange={(e) => updatePart(i, pi, "specification", e.target.value)} />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">采购价 / 销售价</label>
                              <div className="flex gap-1">
                                <input type="number" className="w-1/2 px-2 py-1.5 border border-gray-300 rounded text-xs"
                                  placeholder="成本" value={part.unit_cost} onChange={(e) => updatePart(i, pi, "unit_cost", e.target.value)} />
                                <input type="number" className="w-1/2 px-2 py-1.5 border border-gray-300 rounded text-xs"
                                  placeholder="售价" value={part.unit_price} onChange={(e) => updatePart(i, pi, "unit_price", e.target.value)} />
                              </div>
                            </div>
                          </div>

                          {/* 第三行：流转状态 */}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-gray-50 p-2 rounded">
                            {/* 客户意见：单击循环切换 */}
                            <div className="sm:col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">客户意见</label>
                              <button
                                type="button"
                                onClick={() => cycleCustomerOpinion(i, pi)}
                                className={`w-full px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                                  part.customer_opinion === 'agree'
                                    ? 'bg-green-50 text-green-700 border-green-200'
                                    : part.customer_opinion === 'reject'
                                    ? 'bg-red-50 text-red-700 border-red-200'
                                    : 'bg-gray-50 text-gray-500 border-gray-200'
                                }`}
                              >
                                {part.customer_opinion === 'agree' ? '✓ 客户同意' : part.customer_opinion === 'reject' ? '✗ 客户拒绝' : '待确认'}
                              </button>
                            </div>
                            {/* 供应商下拉 */}
                            <div className="sm:col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">供应商</label>
                              <select
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                value={part.supplier_name}
                                onChange={(e) => updatePart(i, pi, "supplier_name", e.target.value)}
                              >
                                <option value="">请选择</option>
                                {suppliers.map((s) => (
                                  <option key={s.id} value={s.name}>{s.name}</option>
                                ))}
                              </select>
                            </div>
                            {/* 物流公司下拉（本地供应商不显示） */}
                            {(() => {
                              const currentSupplier = suppliers.find((s) => s.name === part.supplier_name);
                              const region = currentSupplier?.region as ("local" | "harbin" | "outside" | undefined);
                              if (currentSupplier && !supplierNeedsLogistics(region)) {
                                return (
                                  <div className="sm:col-span-3">
                                    <label className="block text-xs text-gray-500 mb-1">物流公司</label>
                                    <div className="px-2 py-1.5 text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded">本地供应商，无需物流</div>
                                  </div>
                                );
                              }
                              const filtered = filterLogisticsBySupplierName(logisticsCompanies, part.supplier_name, suppliers);
                              return (
                                <div className="sm:col-span-3">
                                  <label className="block text-xs text-gray-500 mb-1">
                                    物流公司
                                    {region === "harbin" && <span className="ml-1 text-blue-500">（哈市物流）</span>}
                                    {region === "outside" && <span className="ml-1 text-orange-500">（外阜快递）</span>}
                                  </label>
                                  <select
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                    value={part.logistics_agreement}
                                    onChange={(e) => updatePart(i, pi, "logistics_agreement", e.target.value)}
                                  >
                                    <option value="">请选择</option>
                                    {filtered.map((lc) => (
                                      <option key={lc.id} value={lc.name}>{lc.name}</option>
                                    ))}
                                  </select>
                                </div>
                              );
                            })()}
                            {/* 采购/到货状态按钮 */}
                            <div className="sm:col-span-5 flex gap-2 items-center pt-4">
                              <button
                                type="button"
                                onClick={() => togglePurchased(i, pi)}
                                className={`px-3 py-1.5 rounded text-xs border transition-colors ${
                                  part.is_purchased
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : 'bg-white text-gray-400 border-gray-200'
                                }`}
                              >
                                {part.is_purchased ? '已采购' : '未采购'}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleArrived(i, pi)}
                                className={`px-3 py-1.5 rounded text-xs border transition-colors ${
                                  part.is_arrived
                                    ? 'bg-green-50 text-green-700 border-green-200'
                                    : 'bg-white text-gray-400 border-gray-200'
                                }`}
                              >
                                {part.is_arrived ? '已到货' : '未到货'}
                              </button>
                            </div>
                          </div>
                          {/* 配件预估提成 */}
                          {(() => {
                            const comm = getPartCommissionPreview(i, pi);
                            if (!comm || (comm.sales === 0 && comm.repair === 0 && comm.picking === 0 && comm.diagnosis === 0 && comm.qc === 0)) return null;
                            return (
                              <div className="flex flex-wrap gap-2 text-xs pt-1">
                                <span className="text-gray-400">预估提成:</span>
                                {comm.sales > 0 && <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded">销售 {comm.sales.toFixed(2)}元</span>}
                                {comm.repair > 0 && <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded">维修 {comm.repair.toFixed(2)}元</span>}
                                {comm.picking > 0 && <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded">领料 {comm.picking.toFixed(2)}元</span>}
                                {comm.diagnosis > 0 && <span className="text-purple-600 bg-purple-50 px-2 py-0.5 rounded">诊断 {comm.diagnosis.toFixed(2)}元</span>}
                                {comm.qc > 0 && <span className="text-pink-600 bg-pink-50 px-2 py-0.5 rounded">质检 {comm.qc.toFixed(2)}元</span>}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">保存</button>
        </div>
      </form>

      {/* 返工来源选择弹窗 */}
      {reworkModalIndex !== null && vehicleId && (
        <ReworkSelectModal
          vehicleId={vehicleId}
          onSelect={(sourceItem, unlockOrder) => {
            const next = [...items];
            next[reworkModalIndex].rework_source_item_id = (sourceItem as 返工来源项目).id;
            if (unlockOrder) {
              // 解锁原工单：将其状态从 settled 改回 pending_settlement
              supabase
                .from("work_orders")
                .update({ status: "pending_settlement" })
                .eq("id", (sourceItem as 返工来源项目).work_order_id)
                .then(() => {
                  // 静默更新即可
                });
            }
            setItems(next);
            setReworkModalIndex(null);
          }}
          onClose={() => setReworkModalIndex(null)}
        />
      )}

      {/* 配件智能匹配提示弹窗 */}
      {partMatchModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">检测到匹配配件</h3>
            <p className="text-sm text-gray-500 mb-4">
              系统中存在相同名称、品牌且匹配当前车型的配件，是否自动填入该配件信息？
            </p>
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
              <div><span className="text-gray-400">配件编号：</span>{partMatchModal.matchedPart.part_number || "-"}</div>
              <div><span className="text-gray-400">品牌：</span>{partMatchModal.matchedPart.part_brands?.name || "-"}</div>
              <div><span className="text-gray-400">规格：</span>{partMatchModal.matchedPart.specification_text || "-"}</div>
              <div><span className="text-gray-400">成本价：</span><PriceValue value={partMatchModal.matchedPart.unit_cost} /></div>
              <div><span className="text-gray-400">销售价：</span><PriceValue value={partMatchModal.matchedPart.unit_price} /></div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setPartMatchModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                忽略
              </button>
              <button
                type="button"
                onClick={applyMatchedPart}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                确认填入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建标准项目弹窗 */}
      {newItemModal?.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-4">新建维修项目</h3>
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">所属分类</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={newItemModal.category_id}
                    onChange={(e) => setNewItemModal({ ...newItemModal, category_id: e.target.value })}
                  >
                    <option value="">请选择</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">项目名称 *</label>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="项目名称"
                    value={newItemModal.name}
                    onChange={(e) => setNewItemModal({ ...newItemModal, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">标准工时</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="小时"
                    value={newItemModal.standard_hours}
                    onChange={(e) => setNewItemModal({ ...newItemModal, standard_hours: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">项目说明</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="简短说明"
                  value={newItemModal.description}
                  onChange={(e) => setNewItemModal({ ...newItemModal, description: e.target.value })}
                />
              </div>
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">项目价格</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">销售价</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="0.00"
                      value={newItemModal.default_price}
                      onChange={(e) => setNewItemModal({ ...newItemModal, default_price: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">VIP价</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="0.00"
                      value={newItemModal.vip_price}
                      onChange={(e) => setNewItemModal({ ...newItemModal, vip_price: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">自带配件价</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="0.00"
                      value={newItemModal.customer_parts_price}
                      onChange={(e) => setNewItemModal({ ...newItemModal, customer_parts_price: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">提成规则</h4>
                <div className="grid grid-cols-2 gap-4">
                  {[{
                    label: "销售提成", typeKey: "sales_type" as const, valKey: "sales_value" as const,
                  }, {
                    label: "诊断提成", typeKey: "diagnosis_type" as const, valKey: "diagnosis_value" as const,
                  }, {
                    label: "施工提成", typeKey: "repair_type" as const, valKey: "repair_value" as const,
                  }, {
                    label: "质检提成", typeKey: "qc_type" as const, valKey: "qc_value" as const,
                  }].map((c) => (
                    <div key={c.typeKey} className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{c.label}方式</label>
                        <select
                          className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
                          value={newItemModal[c.typeKey]}
                          onChange={(e) => setNewItemModal({ ...newItemModal, [c.typeKey]: e.target.value })}
                        >
                          <option value="">无提成</option>
                          <option value="revenue_pct">按产值(%)</option>
                          <option value="profit_pct">按毛利(%)</option>
                          <option value="fixed">固定金额</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{c.label}数值</label>
                        <input
                          type="number"
                          className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
                          value={newItemModal[c.valKey]}
                          onChange={(e) => setNewItemModal({ ...newItemModal, [c.valKey]: e.target.value })}
                          disabled={!newItemModal[c.typeKey]}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                onClick={() => setNewItemModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={createNewServiceItem}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量选择项目弹窗 */}
      {bulkPickerModal?.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl mx-4 flex flex-col" style={{ maxHeight: "85vh" }}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">批量选择维修项目</h2>
              <button
                type="button"
                onClick={() => setBulkPickerModal(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="搜索项目名称、备注..."
                value={bulkPickerModal.query}
                onChange={(e) => setBulkPickerModal({ ...bulkPickerModal, query: e.target.value })}
                className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <select
                value={bulkPickerModal.categoryFilter}
                onChange={(e) => setBulkPickerModal({ ...bulkPickerModal, categoryFilter: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="">全部分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                value={bulkPickerModal.defaultType}
                onChange={(e) => setBulkPickerModal({ ...bulkPickerModal, defaultType: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                title="新增行的默认类型"
              >
                <option value="labor">默认类型: 工时</option>
                <option value="part">默认类型: 配件</option>
                <option value="other">默认类型: 其他</option>
              </select>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2">
              {(() => {
                const q = bulkPickerModal.query.trim().toLowerCase();
                const filteredList = allServiceItems.filter((si) => {
                  if (bulkPickerModal.categoryFilter) {
                    if (si.category_id !== bulkPickerModal.categoryFilter) return false;
                  }
                  if (q) {
                    const hay = [
                      si.name,
                      si.service_categories?.name,
                      si.description,
                    ].filter(Boolean).join(" ").toLowerCase();
                    if (!hay.includes(q)) return false;
                  }
                  return true;
                });
                const listToShow = filteredList.slice(0, 200);

                if (listToShow.length === 0) {
                  return (
                    <div className="text-center text-gray-400 text-sm py-12">未找到匹配的项目</div>
                  );
                }

                return (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left w-10">选</th>
                        <th className="px-3 py-2 text-left">项目名称</th>
                        <th className="px-3 py-2 text-left w-24">分类</th>
                        <th className="px-3 py-2 text-left w-28">别名</th>
                        <th className="px-3 py-2 text-left w-16">类型</th>
                        <th className="px-3 py-2 text-right w-20">单价</th>
                        <th className="px-3 py-2 text-left">备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listToShow.map((si) => {
                        const checked = bulkPickerModal.selectedIds.includes(si.id);
                        return (
                          <tr
                            key={si.id}
                            className={`border-b border-gray-100 cursor-pointer ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}
                            onClick={() => toggleBulkSelection(si.id)}
                          >
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleBulkSelection(si.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded"
                              />
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-900">{si.name}</td>
                            <td className="px-3 py-2 text-gray-600">{si.service_categories?.name || "-"}</td>
                            <td className="px-3 py-2 text-gray-600">-</td>
                            <td className="px-3 py-2 text-gray-600">工时</td>
                            <td className="px-3 py-2 text-right text-blue-600">
                              {si.default_price != null ? `${si.default_price}` : "-"}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-xs" title={si.description || ""}>
                              {si.description || "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
              {(() => {
                const q = bulkPickerModal.query.trim().toLowerCase();
                const filteredList = allServiceItems.filter((si) => {
                  if (bulkPickerModal.categoryFilter) {
                    if (si.category_id !== bulkPickerModal.categoryFilter) return false;
                  }
                  if (q) {
                    const hay = [si.name, si.service_categories?.name, si.description].filter(Boolean).join(" ").toLowerCase();
                    if (!hay.includes(q)) return false;
                  }
                  return true;
                });
                if (filteredList.length > 200) {
                  return (
                    <div className="text-center text-xs text-gray-400 py-2">
                      共 {filteredList.length} 项，仅显示前 200 项，请输入关键词缩小范围
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="text-sm text-gray-600">
                已选 <span className="font-semibold text-blue-600">{bulkPickerModal.selectedIds.length}</span> 项
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setBulkPickerModal({ ...bulkPickerModal, selectedIds: [] })}
                  className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                  disabled={bulkPickerModal.selectedIds.length === 0}
                >
                  清空选择
                </button>
                <button
                  type="button"
                  onClick={() => setBulkPickerModal(null)}
                  className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={batchAddSelectedItems}
                  disabled={bulkPickerModal.selectedIds.length === 0}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  批量添加 ({bulkPickerModal.selectedIds.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
