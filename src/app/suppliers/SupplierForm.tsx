"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { QRCodeSVG } from "qrcode.react";

interface Contact {
  id?: string;
  name: string;
  phone: string;
  title: string;
  is_primary: boolean;
  notes: string;
}

interface Props {
  editMode?: boolean;
  supplierId?: string;
}

export default function SupplierForm({ editMode, supplierId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(editMode ? true : false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    contact: "",
    phone: "",
    address: "",
    notes: "",
    wechat_id: "",
    wrong_shipment_count: "0",
    quality_return_count: "0",
    recommendation_level: "0",
  });

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [wechatGroupQr, setWechatGroupQr] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 关联选择
  const [linkedCategories, setLinkedCategories] = useState<{ id: string; name: string }[]>([]);
  const [linkedPartNames, setLinkedPartNames] = useState<{ id: string; name: string }[]>([]);
  const [linkedBrands, setLinkedBrands] = useState<{ id: string; name: string }[]>([]);

  const [catQuery, setCatQuery] = useState("");
  const [catResults, setCatResults] = useState<any[]>([]);
  const [pnQuery, setPnQuery] = useState("");
  const [pnResults, setPnResults] = useState<any[]>([]);
  const [brandQuery, setBrandQuery] = useState("");
  const [brandResults, setBrandResults] = useState<any[]>([]);

  // 车辆关联
  const [linkedVehicles, setLinkedVehicles] = useState<{ id: number; name: string }[]>([]);
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [vehicleResults, setVehicleResults] = useState<any[]>([]);

  // 加载编辑数据
  useEffect(() => {
    if (!editMode || !supplierId) return;
    async function load() {
      const { data } = await supabase.from("suppliers").select("*").eq("id", supplierId).single();
      if (data) {
        setForm({
          name: data.name || "",
          contact: data.contact || "",
          phone: data.phone || "",
          address: data.address || "",
          notes: data.notes || "",
          wechat_id: data.wechat_id || "",
          wrong_shipment_count: String(data.wrong_shipment_count || 0),
          quality_return_count: String(data.quality_return_count || 0),
          recommendation_level: String(data.recommendation_level || 0),
        });
        setWechatGroupQr(data.wechat_group_qr || "");
      }

      const { data: contactData } = await supabase
        .from("supplier_contacts")
        .select("id, name, phone, title, is_primary, notes")
        .eq("supplier_id", supplierId)
        .order("created_at", { ascending: true });
      if (contactData) {
        setContacts(
          contactData.map((c: any) => ({
            id: c.id,
            name: c.name || "",
            phone: c.phone || "",
            title: c.title || "",
            is_primary: c.is_primary || false,
            notes: c.notes || "",
          }))
        );
      }

      // 加载关联数据（表可能不存在时忽略错误）
      const [catRes, pnRes, brandRes] = await Promise.allSettled([
        supabase.from("supplier_part_categories").select("part_category_id, part_categories(name)").eq("supplier_id", supplierId),
        supabase.from("supplier_part_names").select("part_name_id, part_names(name)").eq("supplier_id", supplierId),
        supabase.from("supplier_part_brands").select("part_brand_id, part_brands(name)").eq("supplier_id", supplierId),
      ]);

      setLinkedCategories(catRes.status === "fulfilled" ? (catRes.value.data || []).map((c: any) => ({ id: c.part_category_id, name: c.part_categories?.name || "" })) : []);
      setLinkedPartNames(pnRes.status === "fulfilled" ? (pnRes.value.data || []).map((p: any) => ({ id: p.part_name_id, name: p.part_names?.name || "" })) : []);
      setLinkedBrands(brandRes.status === "fulfilled" ? (brandRes.value.data || []).map((b: any) => ({ id: b.part_brand_id, name: b.part_brands?.name || "" })) : []);

      // 加载关联车型
      try {
        const { data: vData } = await supabase
          .from("supplier_vehicle_models")
          .select("vehicle_model_id, vehicle_models(品牌,车系,车型,年款,排量)")
          .eq("supplier_id", supplierId);
        setLinkedVehicles((vData || []).map((v: any) => {
          const vm = v.vehicle_models;
          const parts = [vm?.品牌, vm?.车系, vm?.车型].filter(Boolean);
          if (vm?.年款) parts.push(`${vm.年款}款`);
          if (vm?.排量) parts.push(vm.排量);
          return { id: v.vehicle_model_id, name: parts.join(" ") || `车型ID:${v.vehicle_model_id}` };
        }));
      } catch {
        setLinkedVehicles([]);
      }

      setLoading(false);
    }
    load();
  }, [editMode, supplierId, supabase]);

  // 搜索分类
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!catQuery.trim()) { setCatResults([]); return; }
      const { data } = await supabase.from("part_categories").select("id, name").ilike("name", `%${catQuery.trim()}%`).limit(10);
      setCatResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [catQuery, supabase]);

  // 搜索配件名称（支持名称和搜索关键词）
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!pnQuery.trim()) { setPnResults([]); return; }
      const q = pnQuery.trim();
      const { data } = await supabase
        .from("part_names")
        .select("id, name")
        .or(`name.ilike.%${q}%,search_keywords.ilike.%${q}%`)
        .limit(10);
      setPnResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [pnQuery, supabase]);

  // 搜索品牌
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!brandQuery.trim()) { setBrandResults([]); return; }
      const { data } = await supabase.from("part_brands").select("id, name").ilike("name", `%${brandQuery.trim()}%`).limit(10);
      setBrandResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [brandQuery, supabase]);

  // 搜索车型
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!vehicleQuery.trim()) { setVehicleResults([]); return; }
      const q = vehicleQuery.trim();
      const { data } = await supabase
        .from("vehicle_models")
        .select("id,厂商,品牌,车系")
        .or(`厂商.ilike.%${q}%,品牌.ilike.%${q}%,车系.ilike.%${q}%`)
        .limit(15);
      setVehicleResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [vehicleQuery, supabase]);

  function addContact() {
    setContacts((prev) => [...prev, { name: "", phone: "", title: "", is_primary: false, notes: "" }]);
  }

  function removeContact(idx: number) {
    setContacts((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateContact(idx: number, field: keyof Contact, value: any) {
    setContacts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "is_primary" && value === true) {
        next.forEach((c, i) => { if (i !== idx) c.is_primary = false; });
      }
      return next;
    });
  }

  function addCategory(c: { id: string; name: string }) {
    if (linkedCategories.some((x) => x.id === c.id)) return;
    setLinkedCategories((prev) => [...prev, c]);
    setCatQuery("");
    setCatResults([]);
  }

  function removeCategory(id: string) {
    setLinkedCategories((prev) => prev.filter((x) => x.id !== id));
  }

  function addPartName(p: { id: string; name: string }) {
    if (linkedPartNames.some((x) => x.id === p.id)) return;
    setLinkedPartNames((prev) => [...prev, p]);
    setPnQuery("");
    setPnResults([]);
  }

  function removePartName(id: string) {
    setLinkedPartNames((prev) => prev.filter((x) => x.id !== id));
  }

  function addBrand(b: { id: string; name: string }) {
    if (linkedBrands.some((x) => x.id === b.id)) return;
    setLinkedBrands((prev) => [...prev, b]);
    setBrandQuery("");
    setBrandResults([]);
  }

  function removeBrand(id: string) {
    setLinkedBrands((prev) => prev.filter((x) => x.id !== id));
  }

  function formatVehicleName(vm: any): string {
    const parts = [vm.厂商, vm.品牌, vm.车系].filter(Boolean);
    return parts.join(" ") || `车型ID:${vm.id}`;
  }

  function addVehicle(vm: any) {
    const id = Number(vm.id);
    if (linkedVehicles.some((x) => x.id === id)) return;
    setLinkedVehicles((prev) => [...prev, { id, name: formatVehicleName(vm) }]);
    setVehicleQuery("");
    setVehicleResults([]);
  }

  function removeVehicle(id: number) {
    setLinkedVehicles((prev) => prev.filter((x) => x.id !== id));
  }

  async function uploadWechatGroupQr(file: File) {
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `supplier_group_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("supplier-media").upload(fileName, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("supplier-media").getPublicUrl(fileName);
      setWechatGroupQr(urlData?.publicUrl || fileName);
    } catch (err: any) {
      alert("上传失败: " + err.message);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { alert("请输入供应商名称"); return; }
    setSaving(true);

    // 基础字段（ suppliers 表一定存在）
    const basePayload: any = {
      name: form.name.trim(),
      contact: form.contact.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    };

    // 扩展字段（迁移后才有，不存在的字段会单独尝试）
    const extPayload: any = {
      wechat_id: form.wechat_id.trim() || null,
      wechat_group_qr: wechatGroupQr || null,
      wrong_shipment_count: parseInt(form.wrong_shipment_count) || 0,
      quality_return_count: parseInt(form.quality_return_count) || 0,
      recommendation_level: parseInt(form.recommendation_level) || 0,
    };

    let sid = supplierId;

    if (editMode && sid) {
      // 先尝试完整更新
      const { error } = await supabase.from("suppliers").update({ ...basePayload, ...extPayload }).eq("id", sid);
      if (error) {
        // 如果因为字段不存在报错，只更新基础字段
        if (error.message?.includes("column") || error.code === "42703") {
          const { error: baseError } = await supabase.from("suppliers").update(basePayload).eq("id", sid);
          if (baseError) { alert("保存失败: " + baseError.message); setSaving(false); return; }
        } else {
          alert("保存失败: " + error.message); setSaving(false); return;
        }
      }
    } else {
      const { data: inserted, error } = await supabase.from("suppliers").insert({ ...basePayload, ...extPayload }).select("id").single();
      if (error) {
        if (error.message?.includes("column") || error.code === "42703") {
          const { data: inserted2, error: baseError } = await supabase.from("suppliers").insert(basePayload).select("id").single();
          if (baseError || !inserted2) { alert("保存失败: " + (baseError?.message || "未知错误")); setSaving(false); return; }
          sid = inserted2.id;
        } else {
          alert("保存失败: " + error.message); setSaving(false); return;
        }
      } else {
        sid = inserted?.id;
      }
    }

    if (!sid) { setSaving(false); return; }

    // 以下关联表操作忽略错误（表可能不存在）
    // 同步联系人
    try {
      await supabase.from("supplier_contacts").delete().eq("supplier_id", sid);
      const validContacts = contacts.filter((c) => c.name.trim());
      if (validContacts.length > 0) {
        await supabase.from("supplier_contacts").insert(
          validContacts.map((c) => ({
            supplier_id: sid,
            name: c.name.trim(),
            phone: c.phone.trim() || null,
            title: c.title.trim() || null,
            is_primary: c.is_primary,
            notes: c.notes.trim() || null,
          }))
        );
      }
    } catch { /* 忽略 */ }

    // 同步关联分类
    try {
      await supabase.from("supplier_part_categories").delete().eq("supplier_id", sid);
      if (linkedCategories.length > 0) {
        await supabase.from("supplier_part_categories").insert(
          linkedCategories.map((c) => ({ supplier_id: sid, part_category_id: c.id }))
        );
      }
    } catch { /* 忽略 */ }

    // 同步关联配件名称
    try {
      await supabase.from("supplier_part_names").delete().eq("supplier_id", sid);
      if (linkedPartNames.length > 0) {
        await supabase.from("supplier_part_names").insert(
          linkedPartNames.map((p) => ({ supplier_id: sid, part_name_id: p.id }))
        );
      }
    } catch { /* 忽略 */ }

    // 同步关联品牌
    try {
      await supabase.from("supplier_part_brands").delete().eq("supplier_id", sid);
      if (linkedBrands.length > 0) {
        await supabase.from("supplier_part_brands").insert(
          linkedBrands.map((b) => ({ supplier_id: sid, part_brand_id: b.id }))
        );
      }
    } catch { /* 忽略 */ }

    // 同步关联车型
    try {
      await supabase.from("supplier_vehicle_models").delete().eq("supplier_id", sid);
      if (linkedVehicles.length > 0) {
        await supabase.from("supplier_vehicle_models").insert(
          linkedVehicles.map((v) => ({ supplier_id: sid, vehicle_model_id: v.id }))
        );
      }
    } catch { /* 忽略 */ }

    router.push("/suppliers");
    router.refresh();
  }

  if (loading) {
    return (
      <div>
        <PageHeader title={editMode ? "编辑供应商" : "新增供应商"} />
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={editMode ? "编辑供应商" : "新增供应商"} />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl space-y-6">
        {/* 基本信息 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">供应商名称 *</label>
            <input required className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">联系人</label>
            <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">联系电话</label>
            <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
            <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">发错件次数</label>
            <input type="number" min={0} className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.wrong_shipment_count} onChange={(e) => setForm({ ...form, wrong_shipment_count: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">质量返货次数</label>
            <input type="number" min={0} className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.quality_return_count} onChange={(e) => setForm({ ...form, quality_return_count: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">推荐等级</label>
            <select className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.recommendation_level} onChange={(e) => setForm({ ...form, recommendation_level: e.target.value })}>
              <option value="0">不推荐</option>
              <option value="1">⭐ 1星</option>
              <option value="2">⭐⭐ 2星</option>
              <option value="3">⭐⭐⭐ 3星</option>
              <option value="4">⭐⭐⭐⭐ 4星</option>
              <option value="5">⭐⭐⭐⭐⭐ 5星</option>
            </select>
          </div>
        </div>

        {/* 多联系人 */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">联系人</h3>
            <button type="button" onClick={addContact} className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700">添加联系人</button>
          </div>
          {contacts.length === 0 && <p className="text-sm text-gray-400">暂无联系人</p>}
          <div className="space-y-3">
            {contacts.map((c, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-[120px]">
                  <label className="block text-xs text-gray-500 mb-1">姓名 *</label>
                  <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={c.name} onChange={(e) => updateContact(idx, "name", e.target.value)} />
                </div>
                <div className="w-32">
                  <label className="block text-xs text-gray-500 mb-1">电话</label>
                  <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={c.phone} onChange={(e) => updateContact(idx, "phone", e.target.value)} />
                </div>
                <div className="w-28">
                  <label className="block text-xs text-gray-500 mb-1">职务</label>
                  <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={c.title} onChange={(e) => updateContact(idx, "title", e.target.value)} />
                </div>
                <div className="flex items-center gap-1 pb-1.5">
                  <input type="checkbox" id={`primary_${idx}`} checked={c.is_primary} onChange={(e) => updateContact(idx, "is_primary", e.target.checked)} className="w-4 h-4" />
                  <label htmlFor={`primary_${idx}`} className="text-xs text-gray-600">主要</label>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="block text-xs text-gray-500 mb-1">备注</label>
                  <input className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" value={c.notes} onChange={(e) => updateContact(idx, "notes", e.target.value)} />
                </div>
                <button type="button" onClick={() => removeContact(idx)} className="pb-1.5 text-xs text-red-600 hover:text-red-700">删除</button>
              </div>
            ))}
          </div>
        </div>

        {/* 关联配件分类 */}
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">关联配件分类</h3>
          <div className="relative mb-2">
            <input type="text" placeholder="搜索分类..." className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm" value={catQuery} onChange={(e) => setCatQuery(e.target.value)} />
            {catResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {catResults.map((c) => (
                  <button key={c.id} type="button" onClick={() => addCategory(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0">{c.name}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {linkedCategories.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs">
                {c.name}
                <button type="button" onClick={() => removeCategory(c.id)} className="text-blue-400 hover:text-blue-600">×</button>
              </span>
            ))}
          </div>
        </div>

        {/* 关联配件名称 */}
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">关联配件名称</h3>
          <div className="relative mb-2">
            <input type="text" placeholder="搜索配件名称..." className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm" value={pnQuery} onChange={(e) => setPnQuery(e.target.value)} />
            {pnResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {pnResults.map((p) => (
                  <button key={p.id} type="button" onClick={() => addPartName(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0">{p.name}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {linkedPartNames.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-50 text-green-700 text-xs">
                {p.name}
                <button type="button" onClick={() => removePartName(p.id)} className="text-green-400 hover:text-green-600">×</button>
              </span>
            ))}
          </div>
        </div>

        {/* 关联配件品牌 */}
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">关联配件品牌</h3>
          <div className="relative mb-2">
            <input type="text" placeholder="搜索品牌..." className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm" value={brandQuery} onChange={(e) => setBrandQuery(e.target.value)} />
            {brandResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {brandResults.map((b) => (
                  <button key={b.id} type="button" onClick={() => addBrand(b)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0">{b.name}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {linkedBrands.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 text-amber-700 text-xs">
                {b.name}
                <button type="button" onClick={() => removeBrand(b.id)} className="text-amber-400 hover:text-amber-600">×</button>
              </span>
            ))}
          </div>
        </div>

        {/* 关联车型 */}
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">关联车型</h3>
          <div className="relative mb-2">
            <input type="text" placeholder="搜索厂商、品牌、车系..." className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm" value={vehicleQuery} onChange={(e) => setVehicleQuery(e.target.value)} />
            {vehicleResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-96 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {vehicleResults.map((vm) => (
                  <button key={vm.id} type="button" onClick={() => addVehicle(vm)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0">{formatVehicleName(vm)}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {linkedVehicles.map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-50 text-purple-700 text-xs">
                {v.name}
                <button type="button" onClick={() => removeVehicle(v.id)} className="text-purple-400 hover:text-purple-600">×</button>
              </span>
            ))}
          </div>
        </div>

        {/* 微信二维码 */}
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">微信二维码</h3>
          <div className="flex items-start gap-6">
            <div className="flex-1 max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-1">微信号 / 微信绑定手机号</label>
              <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" value={form.wechat_id} onChange={(e) => setForm({ ...form, wechat_id: e.target.value })} placeholder="输入微信号生成二维码" />
              {form.wechat_id.trim() && (
                <div className="mt-3 p-3 border border-gray-200 rounded-lg inline-block">
                  <QRCodeSVG value={form.wechat_id.trim()} size={128} />
                  <p className="text-xs text-gray-400 mt-1 text-center">扫描添加微信</p>
                </div>
              )}
            </div>
            <div className="flex-1 max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-1">微信群二维码</label>
              {wechatGroupQr ? (
                <div className="relative inline-block">
                  <img src={wechatGroupQr} alt="微信群二维码" className="w-32 h-32 object-cover rounded border border-gray-200" />
                  <button type="button" onClick={() => setWechatGroupQr("")} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center">×</button>
                </div>
              ) : (
                <label className="block w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:text-blue-500 transition-colors">
                  <span className="text-xs text-gray-400">上传微信群二维码</span>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadWechatGroupQr(f); }} />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* 备注 */}
        <div className="border-t border-gray-100 pt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
        </div>
      </form>
    </div>
  );
}
