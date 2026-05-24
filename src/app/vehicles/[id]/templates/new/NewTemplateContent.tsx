"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface ServiceCategory {
  id: string;
  name: string;
}

interface ServiceName {
  id: string;
  name: string;
  category_id: string;
}

interface ServiceItem {
  id: string;
  name: string;
  default_price: number | null;
  standard_hours: string | null;
}

interface PartName {
  id: string;
  name: string;
}

interface PartBrand {
  name: string;
}

interface Part {
  id: string;
  part_brands: PartBrand | null;
  specification_text: string | null;
  unit_cost: number | null;
  unit_price: number | null;
}

interface Mechanic {
  id: string;
  full_name: string;
}

interface TemplatePart {
  part_name_id: string;
  part_id: string;
  quantity: string;
  name: string;
  brand: string;
  specification: string;
  unit_cost: string;
  unit_price: string;
}

interface TemplateItem {
  category_id: string;
  service_name_id: string;
  service_item_id: string;
  name: string;
  item_type: "labor" | "part" | "other";
  quantity: string;
  unit_price: string;
  mechanic_id: string;
  standard_hours: string;
  parts: TemplatePart[];
}

interface TemplateItemRow {
  service_item_id: string | null;
  name: string;
  item_type: "labor" | "part" | "other";
  quantity: number | null;
  unit_price: number | null;
  standard_hours: string | null;
  mechanic_id: string | null;
  vehicle_maintenance_template_parts: {
    part_name_id: string | null;
    part_id: string | null;
    quantity: number | null;
    name: string | null;
    brand: string | null;
    specification: string | null;
    unit_cost: number | null;
    unit_price: number | null;
  }[] | null;
}

interface Template {
  name: string;
  previous_cost: number | null;
  customer_notes: string | null;
}

export default function NewTemplateContent({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const copyFromId = searchParams.get("copy");
  const supabase = createClient();
  const [vehicleId, setVehicleId] = useState("");
  const [loading, setLoading] = useState(false);

  const [, setCategories] = useState<ServiceCategory[]>([]);
  const [, setServiceNames] = useState<ServiceName[]>([]);
  const [serviceItems] = useState<ServiceItem[]>([]);
  const [partNames, setPartNames] = useState<PartName[]>([]);
  const [partsByName, setPartsByName] = useState<Record<string, Part[]>>({});
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);

  const [name, setName] = useState("");
  const [previousCost, setPreviousCost] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [items, setItems] = useState<TemplateItem[]>([
    { category_id: "", service_name_id: "", service_item_id: "", name: "", item_type: "labor", quantity: "1", unit_price: "", mechanic_id: "", standard_hours: "", parts: [] },
  ]);

  useEffect(() => {
    params.then((p) => setVehicleId(p.id));
    supabase.from("service_categories").select("*").order("name").limit(100).then(({ data }) => setCategories((data as ServiceCategory[]) || []));
    supabase.from("part_names").select("*").order("name").limit(100).then(({ data }) => setPartNames((data as PartName[]) || []));
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").limit(100).then(({ data }) => setMechanics((data as Mechanic[]) || []));
  }, [params, supabase]);

  // 复制现有模板
  useEffect(() => {
    if (!copyFromId) return;
    (async () => {
      const { data: template } = await supabase
        .from("vehicle_maintenance_templates")
        .select("*")
        .eq("id", copyFromId)
        .single();
      if (template) {
        const t = template as Template;
        setName(t.name + " (副本)");
        setPreviousCost(t.previous_cost?.toString() || "");
        setCustomerNotes(t.customer_notes || "");
      }

      const { data: templateItems } = await supabase
        .from("vehicle_maintenance_template_items")
        .select("*, vehicle_maintenance_template_parts(*)")
        .eq("template_id", copyFromId)
        .order("created_at", { ascending: true });

      if (templateItems && templateItems.length > 0) {
        setItems(
          (templateItems as TemplateItemRow[]).map((it) => ({
            category_id: "",
            service_name_id: "",
            service_item_id: it.service_item_id || "",
            name: it.name,
            item_type: it.item_type,
            quantity: it.quantity?.toString() || "1",
            unit_price: it.unit_price?.toString() || "",
            mechanic_id: it.mechanic_id || "",
            standard_hours: it.standard_hours?.toString() || "",
            parts: (it.vehicle_maintenance_template_parts || []).map((p) => ({
              part_name_id: p.part_name_id || "",
              part_id: p.part_id || "",
              quantity: p.quantity?.toString() || "1",
              name: p.name || "",
              brand: p.brand || "",
              specification: p.specification || "",
              unit_cost: p.unit_cost?.toString() || "",
              unit_price: p.unit_price?.toString() || "",
            })),
          }))
        );
      }
    })();
  }, [copyFromId, supabase]);

  const emptyPart = (): TemplatePart => ({
    part_name_id: "",
    part_id: "",
    quantity: "1",
    name: "",
    brand: "",
    specification: "",
    unit_cost: "",
    unit_price: "",
  });

  function addItem() {
    setItems([...items, { category_id: "", service_name_id: "", service_item_id: "", name: "", item_type: "labor", quantity: "1", unit_price: "", mechanic_id: "", standard_hours: "", parts: [] }]);
  }

  function addPart(itemIndex: number) {
    const next = [...items];
    next[itemIndex].parts.push(emptyPart());
    setItems(next);
  }

  function updateItem(index: number, field: keyof TemplateItem, value: string) {
    const next = [...items];
    next[index][field] = value as never;

    if (field === "category_id") {
      next[index].service_name_id = "";
      next[index].service_item_id = "";
      if (value) {
        supabase.from("service_names").select("id, name").eq("category_id", value).order("name").then(({ data }) => {
          setServiceNames((data as ServiceName[]) || []);
        });
      }
    }

    if (field === "service_item_id") {
      const item = serviceItems.find((s) => s.id === value);
      if (item) {
        next[index].name = item.name;
        next[index].unit_price = item.default_price?.toString() || "";
        next[index].standard_hours = item.standard_hours || "";
      }
    }

    setItems(next);
  }

  function updatePart(itemIndex: number, partIndex: number, field: keyof TemplatePart, value: string) {
    const next = [...items];
    next[itemIndex].parts[partIndex][field] = value as never;

    if (field === "part_name_id") {
      next[itemIndex].parts[partIndex].part_id = "";
      const pn = partNames.find((n) => n.id === value);
      if (pn) {
        next[itemIndex].parts[partIndex].name = pn.name;
      }
      if (value) {
        supabase.from("parts").select("*, part_brands(name)").eq("part_name_id", value).order("created_at").then(({ data }) => {
          setPartsByName((prev) => ({ ...prev, [value]: (data as Part[]) || [] }));
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

  function removePart(itemIndex: number, partIndex: number) {
    const next = [...items];
    next[itemIndex].parts.splice(partIndex, 1);
    setItems(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicleId || !name.trim()) {
      alert("请输入模板名称");
      return;
    }
    setLoading(true);

    try {
      const { data: template, error: tErr } = await supabase
        .from("vehicle_maintenance_templates")
        .insert({
          vehicle_id: vehicleId,
          name: name.trim(),
          previous_cost: previousCost ? parseFloat(previousCost) : null,
          customer_notes: customerNotes || null,
        })
        .select("id")
        .single();

      if (tErr || !template) throw tErr || new Error("创建模板失败");

      for (const item of items) {
        if (!item.name) continue;
        const { data: createdItem, error: itemErr } = await supabase
          .from("vehicle_maintenance_template_items")
          .insert({
            template_id: template.id,
            service_item_id: item.service_item_id || null,
            name: item.name,
            item_type: item.item_type,
            quantity: parseFloat(item.quantity) || 1,
            unit_price: parseFloat(item.unit_price) || 0,
            standard_hours: item.standard_hours ? parseFloat(item.standard_hours) : null,
            mechanic_id: item.mechanic_id || null,
          })
          .select("id")
          .single();

        if (itemErr || !createdItem) throw itemErr || new Error("创建模板项目失败");

        for (const part of item.parts) {
          if (!part.part_name_id && !part.name) continue;
          const { error: partErr } = await supabase
            .from("vehicle_maintenance_template_parts")
            .insert({
              template_item_id: createdItem.id,
              part_name_id: part.part_name_id || null,
              part_id: part.part_id || null,
              quantity: parseInt(part.quantity) || 1,
              name: part.name || null,
              brand: part.brand || null,
              specification: part.specification || null,
              unit_cost: parseFloat(part.unit_cost) || null,
              unit_price: parseFloat(part.unit_price) || null,
            });
          if (partErr) throw partErr;
        }
      }

      router.push(`/vehicles/${vehicleId}/templates`);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert("保存失败: " + message);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="新建保养模板" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">模板名称 *</label>
            <input
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="如：5万公里大保养"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">往期收费金额 (元)</label>
            <input
              type="number"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="0.00"
              value={previousCost}
              onChange={(e) => setPreviousCost(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">客户嘱咐</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="如：请检查轮胎"
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">维修项目</h2>
            <button type="button" onClick={addItem} className="text-sm text-blue-600 hover:text-blue-700">+ 添加项目</button>
          </div>
          <div className="space-y-4">
            {items.map((item, i) => (
              <div key={i} className="p-4 bg-gray-50 rounded-lg space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">项目名称 *</label>
                    <input
                      required
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      value={item.name}
                      onChange={(e) => updateItem(i, "name", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">类型</label>
                    <select
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      value={item.item_type}
                      onChange={(e) => updateItem(i, "item_type", e.target.value)}
                    >
                      <option value="labor">工时</option>
                      <option value="part">配件</option>
                      <option value="other">其他</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">数量</label>
                    <input
                      type="number"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      value={item.quantity}
                      onChange={(e) => updateItem(i, "quantity", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">单价</label>
                    <input
                      type="number"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      value={item.unit_price}
                      onChange={(e) => updateItem(i, "unit_price", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">技师</label>
                    <select
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      value={item.mechanic_id}
                      onChange={(e) => updateItem(i, "mechanic_id", e.target.value)}
                    >
                      <option value="">未指定</option>
                      {mechanics.map((m) => (
                        <option key={m.id} value={m.id}>{m.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-700">所需配件</span>
                    <button type="button" onClick={() => addPart(i)} className="text-xs text-blue-600 hover:text-blue-700">+ 添加配件</button>
                  </div>
                  <div className="space-y-2">
                    {item.parts.map((part, pi) => (
                      <div key={pi} className="bg-white p-2 rounded border border-gray-200 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] text-gray-400 mb-0.5">配件名称</label>
                          <select
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                            value={part.part_name_id}
                            onChange={(e) => updatePart(i, pi, "part_name_id", e.target.value)}
                          >
                            <option value="">请选择</option>
                            {partNames.map((pn) => (
                              <option key={pn.id} value={pn.id}>{pn.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] text-gray-400 mb-0.5">具体配件</label>
                          <select
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                            value={part.part_id}
                            onChange={(e) => updatePart(i, pi, "part_id", e.target.value)}
                          >
                            <option value="">空分支</option>
                            {(partsByName[part.part_name_id] || []).map((p) => (
                              <option key={p.id} value={p.id}>{p.part_brands?.name || "无品牌"} {p.specification_text || ""}</option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-1">
                          <label className="block text-[10px] text-gray-400 mb-0.5">数量</label>
                          <input type="number" min="1" className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                            value={part.quantity} onChange={(e) => updatePart(i, pi, "quantity", e.target.value)} />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-gray-400 mb-0.5">品牌 / 规格</label>
                          <div className="flex gap-1">
                            <input className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" placeholder="品牌"
                              value={part.brand} onChange={(e) => updatePart(i, pi, "brand", e.target.value)} />
                            <input className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" placeholder="规格"
                              value={part.specification} onChange={(e) => updatePart(i, pi, "specification", e.target.value)} />
                          </div>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-gray-400 mb-0.5">成本 / 售价</label>
                          <div className="flex gap-1">
                            <input type="number" className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" placeholder="成本"
                              value={part.unit_cost} onChange={(e) => updatePart(i, pi, "unit_cost", e.target.value)} />
                            <input type="number" className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" placeholder="售价"
                              value={part.unit_price} onChange={(e) => updatePart(i, pi, "unit_price", e.target.value)} />
                          </div>
                        </div>
                        <div className="sm:col-span-1">
                          <button type="button" onClick={() => removePart(i, pi)} className="w-full px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">删除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-4 border-t border-gray-100">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? "保存中..." : "保存模板"}
          </button>
        </div>
      </form>
    </div>
  );
}
