"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import { ReworkSelectModal } from "@/components/ReworkSelectModal";

export default function NewRequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [serviceNames, setServiceNames] = useState<any[]>([]);
  const [serviceItems, setServiceItems] = useState<any[]>([]);
  const [partNames, setPartNames] = useState<any[]>([]);
  const [partsByName, setPartsByName] = useState<Record<string, any[]>>({});
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [logisticsCompanies, setLogisticsCompanies] = useState<any[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [vehicleModelId, setVehicleModelId] = useState("");
  const [partMatchModal, setPartMatchModal] = useState<any>(null);
  const [reworkModalIndex, setReworkModalIndex] = useState<number | null>(null);

  const [requirement, setRequirement] = useState({ description: "", diagnosis: "", remarks: "" });
  const [requirementImages, setRequirementImages] = useState<string[]>([]);
  const [items, setItems] = useState([
    { category_id: "", service_name_id: "", service_item_id: "", name: "", alias_name: "", item_type: "labor", quantity: "1", unit_price: "", mechanic_id: "", standard_hours: "", customer_opinion: "pending", description: "", is_outsourced: false, outsourced_supplier_id: "", business_type: "normal", rework_source_item_id: "", rework_reason: "", rework_loss_amount: "", parts: [] as any[] },
  ]);

  const emptyPart = () => ({
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
    supabase.from("service_categories").select("*").order("name").then(({ data }) => setCategories(data || []));
    supabase.from("part_names").select("*").order("name").then(({ data }) => setPartNames(data || []));
    supabase.from("suppliers").select("*").order("name").then(({ data }) => setSuppliers(data || []));
    supabase.from("logistics_companies").select("*").order("name").then(({ data }) => setLogisticsCompanies(data || []));
  }, [params, supabase]);

  // 查询当前工单的车辆车型，用于配件智能匹配
  useEffect(() => {
    if (!orderId) return;
    supabase
      .from("work_orders")
      .select("vehicle_id")
      .eq("id", orderId)
      .single()
      .then(({ data: wo }) => {
        if (wo?.vehicle_id) {
          setVehicleId(wo.vehicle_id);
          supabase
            .from("vehicles")
            .select("vehicle_model_id")
            .eq("id", wo.vehicle_id)
            .single()
            .then(({ data: v }) => {
              if (v?.vehicle_model_id) setVehicleModelId(v.vehicle_model_id);
            });
        }
      });
  }, [orderId, supabase]);

  function addItem() {
    setItems([...items, { category_id: "", service_name_id: "", service_item_id: "", name: "", alias_name: "", item_type: "labor", quantity: "1", unit_price: "", mechanic_id: "", standard_hours: "", customer_opinion: "pending", description: "", is_outsourced: false, outsourced_supplier_id: "", business_type: "normal", rework_source_item_id: "", rework_reason: "", rework_loss_amount: "", parts: [] }]);
  }

  function addPart(itemIndex: number) {
    const next = [...items];
    next[itemIndex].parts.push(emptyPart());
    setItems(next);
  }

  function updateItem(index: number, field: string, value: any) {
    const next = [...items];
    (next[index] as any)[field] = value;

    if (field === "category_id") {
      next[index].service_name_id = "";
      next[index].service_item_id = "";
      next[index].name = "";
      next[index].unit_price = "";
    }

    if (field === "service_name_id") {
      const name = serviceNames.find((n) => n.id === value);
      if (name) next[index].name = name.name;
    }

    if (field === "service_item_id") {
      const item = serviceItems.find((s) => s.id === value);
      if (item) {
        next[index].name = item.name;
        next[index].unit_price = item.default_price?.toString() || "";
        next[index].standard_hours = item.standard_hours;
      }
    }

    setItems(next);
  }

  function updatePart(itemIndex: number, partIndex: number, field: string, value: any) {
    const next = [...items];
    next[itemIndex].parts[partIndex][field] = value;

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
        supabase.from("parts").select("*, part_brands(name)").eq("part_name_id", value).order("created_at").then(({ data }) => {
          setPartsByName((prev) => ({ ...prev, [value]: data || [] }));
        });
      }
    }

    if (field === "part_id" && value) {
      const part = (partsByName[next[itemIndex].parts[partIndex].part_name_id] || []).find((p: any) => p.id === value);
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
      const next = [...items];
      next[itemIndex].parts[partIndex].part_name_id = matched.part_names?.id || "";
      next[itemIndex].parts[partIndex].part_id = matched.id;
      next[itemIndex].parts[partIndex].name = matched.part_names?.name || "";
      next[itemIndex].parts[partIndex].unit = matched.part_names?.unit || "";
      next[itemIndex].parts[partIndex].brand = matched.part_brands?.name || "";
      next[itemIndex].parts[partIndex].specification = matched.specification_text || "";
      next[itemIndex].parts[partIndex].unit_cost = matched.unit_cost?.toString() || "";
      next[itemIndex].parts[partIndex].unit_price = matched.unit_price?.toString() || "";
      next[itemIndex].parts[partIndex].part_number = partNumber.trim();
      setItems(next);
      // 加载该配件名称下的具体配件列表
      if (matched.part_names?.id) {
        supabase.from("parts").select("*, part_brands(name)").eq("part_name_id", matched.part_names.id).order("created_at").then(({ data }) => {
          setPartsByName((prev) => ({ ...prev, [matched.part_names.id]: data || [] }));
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
    const partIds = modelLinks?.map((m) => m.part_id) || [];
    if (partIds.length === 0) return;

    // 3. 匹配相同名称、品牌的配件
    const { data: matchedParts } = await supabase
      .from("parts")
      .select("*, part_brands(name)")
      .eq("part_name_id", part.part_name_id)
      .eq("brand_id", brandData.id)
      .in("id", partIds);

    if (matchedParts && matchedParts.length > 0) {
      setPartMatchModal({
        itemIndex,
        partIndex,
        matchedPart: matchedParts[0],
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
    const cycle = { pending: "agree", agree: "reject", reject: "pending" };
    next[itemIndex].parts[partIndex].customer_opinion = (cycle as any)[current] || "pending";
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

  function loadNamesForItem(index: number, categoryId: string) {
    if (!categoryId) return;
    supabase.from("service_names").select("id, name").eq("category_id", categoryId).order("name").then(({ data }) => {
      setServiceNames((prev) => {
        const next = [...prev];
        next[index] = data || [];
        return next;
      });
    });
  }

  function loadItemsForName(nameId: string) {
    if (!nameId) return;
    supabase.from("service_items").select("*").eq("service_name_id", nameId).order("name").then(({ data }) => {
      setServiceItems(data || []);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    setLoading(true);

    try {
      const { data: req, error: reqError } = await supabase
        .from("work_order_requirements")
        .insert({ work_order_id: orderId, description: requirement.description, diagnosis: requirement.diagnosis, remarks: requirement.remarks || null })
        .select("id")
        .single();

      if (reqError || !req) throw reqError || new Error("创建需求失败");

      // 保存需求图片
      if (requirementImages.length > 0) {
        const mediaRecords = requirementImages.map((path) => ({
          requirement_id: req.id,
          media_type: "image" as const,
          storage_path: path,
        }));
        await supabase.from("work_order_requirement_media").insert(mediaRecords);
      }

      for (const item of items) {
        if (!item.name) continue;
        const { data: createdItem, error: itemError } = await supabase.from("work_order_items").insert({
          work_order_id: orderId,
          requirement_id: req.id,
          service_item_id: item.service_item_id || null,
          name: item.name,
          alias_name: item.alias_name || null,
          item_type: item.item_type,
          description: item.description || null,
          quantity: parseFloat(item.quantity) || 1,
          unit_price: parseFloat(item.unit_price) || 0,
          mechanic_id: item.mechanic_id || null,
          customer_opinion: item.customer_opinion || "pending",
          is_outsourced: item.is_outsourced || false,
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
            work_order_item_id: createdItem.id,
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
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="添加诊断与维修项目" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl">
        <div className="space-y-6">
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
            <ImageUploader onUpload={setRequirementImages} />
          </div>

          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">维修项目</h2>
              <button type="button" onClick={addItem} className="text-sm text-blue-600 hover:text-blue-700">+ 添加项目</button>
            </div>
            <div className="space-y-4">
              {items.map((item, i) => (
                <div key={i} className="p-4 bg-gray-50 rounded-lg space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">项目分类</label>
                      <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.category_id} onChange={(e) => { updateItem(i, "category_id", e.target.value); loadNamesForItem(i, e.target.value); }}>
                        <option value="">请选择</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">名称库</label>
                      <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.service_name_id} onChange={(e) => { updateItem(i, "service_name_id", e.target.value); loadItemsForName(e.target.value); }}>
                        <option value="">请选择</option>
                        {serviceNames.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">标准项目</label>
                      <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.service_item_id} onChange={(e) => updateItem(i, "service_item_id", e.target.value)}>
                        <option value="">自定义</option>
                        {serviceItems.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.default_price}元)</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">项目名称 *</label>
                      <input required className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.name} onChange={(e) => updateItem(i, "name", e.target.value)} />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-xs text-gray-500 mb-1">别名</label>
                      <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        placeholder="显示用"
                        value={item.alias_name}
                        onChange={(e) => updateItem(i, "alias_name", e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">类型</label>
                      <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.item_type} onChange={(e) => updateItem(i, "item_type", e.target.value)}>
                        <option value="labor">工时</option>
                        <option value="part">配件</option>
                        <option value="other">其他</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">单价</label>
                      <input type="number" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.unit_price} onChange={(e) => updateItem(i, "unit_price", e.target.value)} />
                    </div>
                    <div>
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
                  </div>

                  {/* 项目备注 / 业务类型 / 外包 */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
                  >
                    <div className="sm:col-span-4"
                    >
                      <label className="block text-xs text-gray-500 mb-1"
                      >备注</label>
                      <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        placeholder="项目备注说明"
                        value={item.description}
                        onChange={(e) => updateItem(i, "description", e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2"
                    >
                      <label className="block text-xs text-gray-500 mb-1"
                      >业务类型</label>
                      <select className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={item.business_type}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'rework') {
                            setReworkModalIndex(i);
                          } else {
                            // 切换出返工时清空返工字段
                            const next = [...items];
                            next[i].rework_source_item_id = "";
                            next[i].rework_reason = "";
                            next[i].rework_loss_amount = "";
                            setItems(next);
                          }
                          updateItem(i, "business_type", val);
                        }}
                      >
                        <option value="normal">正常工单</option>
                        <option value="insurance">保险业务</option>
                        <option value="gift">赠送项目</option>
                        <option value="rework">返工项目</option>
                      </select>
                    </div>
                    <div className="sm:col-span-6 flex items-end gap-2"
                    >
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer mb-2"
                      >
                        <input type="checkbox" className="rounded"
                          checked={item.is_outsourced}
                          onChange={(e) => updateItem(i, "is_outsourced", e.target.checked)}
                        />
                        外包
                      </label>
                      {item.is_outsourced && (
                        <select className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
                          value={item.outsourced_supplier_id}
                          onChange={(e) => updateItem(i, "outsourced_supplier_id", e.target.value)}
                        >
                          <option value=""
                          >选择外包供应商</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}
                            >{s.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

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
                                {(partsByName[part.part_name_id] || []).map((p: any) => (
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
                            {/* 物流公司下拉 */}
                            <div className="sm:col-span-3">
                              <label className="block text-xs text-gray-500 mb-1">物流公司</label>
                              <select
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                value={part.logistics_agreement}
                                onChange={(e) => updatePart(i, pi, "logistics_agreement", e.target.value)}
                              >
                                <option value="">请选择</option>
                                {logisticsCompanies.map((lc) => (
                                  <option key={lc.id} value={lc.name}>{lc.name}</option>
                                ))}
                              </select>
                            </div>
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
            next[reworkModalIndex].rework_source_item_id = sourceItem.id;
            if (unlockOrder) {
              // 解锁原工单：将其状态从 settled 改回 completed
              supabase
                .from("work_orders")
                .update({ status: "completed" })
                .eq("id", sourceItem.work_order_id)
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
              <div><span className="text-gray-400">成本价：</span>{partMatchModal.matchedPart.unit_cost || "-"}</div>
              <div><span className="text-gray-400">销售价：</span>{partMatchModal.matchedPart.unit_price || "-"}</div>
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
    </div>
  );
}
