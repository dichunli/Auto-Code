"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import Link from "next/link";

export default function EditCustomerPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  interface ContactForm {
    id: string;
    name: string;
    phone: string;
    relationship: string;
    notes: string;
    isExisting?: boolean;
    searchResult?: { name: string; phone: string; relationship: string; notes: string } | null;
  }

  const [form, setForm] = useState({
    name: "",
    phone: "",
    gender: "",
    address: "",
    company: "",
    id_card: "",
    notes: "",
  });

  const [customerPhotos, setCustomerPhotos] = useState<string[]>([]);
  interface 车辆 {
    id: string;
    plate_number: string;
    brand: string | null;
    model: string | null;
    vin: string | null;
    color: string | null;
    year: number | null;
    mileage: number | null;
  }

  const [vehicles, setVehicles] = useState<车辆[]>([]);
  const [originalPhone, setOriginalPhone] = useState("");
  const [hasPhone, setHasPhone] = useState(true);
  const [contacts, setContacts] = useState<ContactForm[]>([]);
  const [customerPhones, setCustomerPhones] = useState<{ id: string; phone: string; label: string }[]>([]);
  const [starLevel, setStarLevel] = useState<number>(0);
  const [allTags, setAllTags] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const contactIdCounterRef = useRef(0);
  const phoneIdCounterRef = useRef(0);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from("customers").select("*").eq("id", id).single();
      if (data) {
        setOriginalPhone(data.phone || "");
        setHasPhone(!!data.phone);
        setForm({
          name: data.name || "",
          phone: data.phone || "",
          gender: data.gender || "",
          address: data.address || "",
          company: data.company || "",
          id_card: data.id_card || "",
          notes: data.notes || "",
        });
        const { data: contactData } = await supabase
          .from("customer_contacts")
          .select("id, name, phone, relationship, notes")
          .eq("customer_id", id)
          .order("created_at", { ascending: true });
        setContacts(
          (contactData || []).map((c: ContactForm) => ({ ...c, isExisting: true }))
        );
        const { data: phoneData } = await supabase
          .from("customer_phones")
          .select("id, phone, label")
          .eq("customer_id", id)
          .order("created_at", { ascending: true });
        setCustomerPhones(
          (phoneData || []).map((p: { id: string; phone: string | null; label: string | null }) => ({ id: p.id, phone: p.phone || "", label: p.label || "" }))
        );
        setStarLevel(data.star_level || 0);
        const { data: tagData } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true }).limit(100);
        setAllTags((tagData || []).map((t: { id: string; name: string; color: string | null }) => ({ id: t.id, name: t.name, color: t.color })));
        const { data: customerTagData } = await supabase.from("customer_tags").select("tag_id").eq("customer_id", id);
        setSelectedTagIds((customerTagData || []).map((t: { tag_id: string }) => t.tag_id));
      }
      const { data: photoData } = await supabase
        .from("customer_photos")
        .select("category, url")
        .eq("customer_id", id);
      if (photoData) {
        setCustomerPhotos(photoData.map((p) => p.url));
      }
      const { data: vehicleData } = await supabase
        .from("vehicles")
        .select("id, plate_number, brand, model, vin, color, year, mileage")
        .eq("customer_id", id)
        .order("created_at", { ascending: false });
      setVehicles(vehicleData || []);
      setLoading(false);
    }
    load();
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("请填写客户姓名");
      return;
    }
    if (hasPhone && !form.phone.trim()) {
      alert("请填写手机号");
      return;
    }

    // 手机号唯一性校验（变更时才检查）
    if (hasPhone && form.phone.trim() && form.phone.trim() !== originalPhone.trim()) {
      const supabaseCheck = createClient();
      const { data: existingPhone } = await supabaseCheck
        .from("customers")
        .select("id")
        .eq("phone", form.phone.trim())
        .neq("id", id)
        .maybeSingle();
      if (existingPhone) {
        alert("该手机号已被其他客户使用，请更换");
        setSaving(false);
        return;
      }
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("customers").update({
      name: form.name.trim(),
      phone: hasPhone ? form.phone.trim() : null,
      gender: form.gender || null,
      address: form.address.trim() || null,
      company: form.company.trim() || null,
      id_card: form.id_card.trim() || null,
      notes: form.notes.trim() || null,
      star_level: starLevel || null,
    }).eq("id", id);

    if (error) { alert("保存失败: " + error.message); setSaving(false); return; }

    // 保存备用手机号：删除旧记录，插入新记录
    const { error: delPhoneError } = await supabase.from("customer_phones").delete().eq("customer_id", id);
    if (delPhoneError) { alert("删除旧手机号失败: " + delPhoneError.message); setSaving(false); return; }
    const validPhones = customerPhones.filter((p) => p.phone.trim());
    if (validPhones.length > 0) {
      const { error: insPhoneError } = await supabase.from("customer_phones").insert(
        validPhones.map((p) => ({
          customer_id: id,
          phone: p.phone.trim(),
          label: p.label.trim() || null,
        }))
      );
      if (insPhoneError) { alert("备用手机号保存失败: " + insPhoneError.message); setSaving(false); return; }
    }

    // 保存联系人：删除旧记录，插入新记录
    const { error: delContactError } = await supabase.from("customer_contacts").delete().eq("customer_id", id);
    if (delContactError) { alert("删除旧联系人失败: " + delContactError.message); setSaving(false); return; }
    const validContacts = contacts.filter((c) => c.name.trim() && c.phone.trim());
    if (validContacts.length > 0) {
      const { error: insContactError } = await supabase.from("customer_contacts").insert(
        validContacts.map((c) => ({
          customer_id: id,
          name: c.name.trim(),
          phone: c.phone.trim(),
          relationship: c.relationship.trim() || null,
          notes: c.notes.trim() || null,
        }))
      );
      if (insContactError) { alert("联系人保存失败: " + insContactError.message); setSaving(false); return; }
    }

    await supabase.from("customer_photos").delete().eq("customer_id", id);
    const photoInserts: { customer_id: string; category: string; url: string }[] = [];
    customerPhotos.forEach((url) =>
      photoInserts.push({ customer_id: id, category: "photo", url })
    );
    if (photoInserts.length > 0) {
      await supabase.from("customer_photos").insert(photoInserts);
    }

    // 保存客户标签：删除旧记录，插入新记录
    const { error: delTagError } = await supabase.from("customer_tags").delete().eq("customer_id", id);
    if (delTagError) { alert("删除旧标签失败: " + delTagError.message); setSaving(false); return; }
    if (selectedTagIds.length > 0) {
      const { error: insTagError } = await supabase.from("customer_tags").insert(
        selectedTagIds.map((tagId) => ({ customer_id: id, tag_id: tagId }))
      );
      if (insTagError) { alert("标签保存失败: " + insTagError.message); setSaving(false); return; }
    }

    const returnTo = searchParams.get("returnTo");
    if (returnTo) {
      router.push(returnTo);
    } else {
      router.push("/customers");
    }
    router.refresh();
  }

  function addPhone() {
    phoneIdCounterRef.current++;
    setCustomerPhones((prev) => [
      ...prev,
      { id: `p-${Date.now()}-${phoneIdCounterRef.current}`, phone: "", label: "" },
    ]);
  }

  function removePhone(phoneId: string) {
    setCustomerPhones((prev) => prev.filter((p) => p.id !== phoneId));
  }

  function updatePhone(phoneId: string, field: "phone" | "label", value: string) {
    setCustomerPhones((prev) => prev.map((p) => (p.id === phoneId ? { ...p, [field]: value } : p)));
  }

  function addContact() {
    contactIdCounterRef.current++;
    setContacts((prev) => [
      ...prev,
      { id: `c-${Date.now()}-${contactIdCounterRef.current}`, name: "", phone: "", relationship: "", notes: "" },
    ]);
  }

  function removeContact(contactId: string) {
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
  }

  function updateContact(contactId: string, field: keyof ContactForm, value: string) {
    setContacts((prev) => prev.map((c) => (c.id === contactId ? { ...c, [field]: value, searchResult: field === "phone" ? undefined : c.searchResult } : c)));
  }

  async function searchContactByPhone(contactId: string, phone: string) {
    if (!phone.trim()) return;
    const client = createClient();
    const { data } = await client
      .from("customers")
      .select("name, phone")
      .eq("phone", phone.trim())
      .limit(1)
      .maybeSingle();
    if (data) {
      setContacts((prev) => prev.map((c) => (c.id === contactId ? { ...c, searchResult: { name: data.name, phone: data.phone, relationship: "", notes: "" } } : c)));
    }
  }

  function fillContactFromSearch(contactId: string) {
    setContacts((prev) =>
      prev.map((c) =>
        c.id === contactId && c.searchResult
          ? { ...c, name: c.searchResult.name, relationship: c.searchResult.relationship || "", notes: c.searchResult.notes || "", searchResult: undefined }
          : c
      )
    );
  }

  if (loading) return <div className="py-8 text-sm text-gray-500">加载中...</div>;

  return (
    <div>
      <PageHeader title="编辑客户" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">客户姓名 *</label>
            <input required type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <input
                type="checkbox"
                id="hasPhone"
                checked={hasPhone}
                onChange={(e) => {
                  setHasPhone(e.target.checked);
                  if (!e.target.checked) setForm({ ...form, phone: "" });
                }}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <label htmlFor="hasPhone" className="text-sm text-gray-700">有手机号</label>
            </div>
            {hasPhone && (
              <input type="tel" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            )}
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">备用手机号</label>
              <button type="button" onClick={addPhone} className="px-3 py-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100">+ 添加手机号</button>
            </div>
            {customerPhones.length === 0 && <p className="text-sm text-gray-400">暂无备用手机号</p>}
            <div className="space-y-2">
              {customerPhones.map((p) => (
                <div key={p.id} className="flex gap-2 items-center">
                  <input type="tel" placeholder="手机号" className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={p.phone} onChange={(e) => updatePhone(p.id, "phone", e.target.value)} />
                  <input type="text" placeholder="标签，如：工作、家庭" className="w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={p.label} onChange={(e) => updatePhone(p.id, "label", e.target.value)} />
                  <button type="button" onClick={() => removePhone(p.id)} className="px-2 py-2 text-xs text-red-600 hover:text-red-700">删除</button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">性别</label>
            <div className="flex gap-4 mt-2">
              <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="gender"
                  value="男"
                  checked={form.gender === "男"}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  className="text-blue-600 focus:ring-blue-500"
                />
                男
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="gender"
                  value="女"
                  checked={form.gender === "女"}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  className="text-blue-600 focus:ring-blue-500"
                />
                女
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">所属单位</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">身份证号</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.id_card} onChange={(e) => setForm({ ...form, id_card: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">客户星级</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setStarLevel(star === starLevel ? 0 : star)}
                  className={`text-2xl leading-none transition-colors ${star <= starLevel ? "text-yellow-400" : "text-gray-300 hover:text-yellow-300"}`}
                >
                  ★
                </button>
              ))}
              {starLevel > 0 && (
                <span className="ml-2 text-sm text-gray-500">{starLevel} 星</span>
              )}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">客户标签</label>
            {allTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => {
                        setSelectedTagIds((prev) =>
                          selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                        );
                      }}
                      className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                        selected
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400">暂无可用标签</p>
            )}
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">客户照片</label>
          <ImageUploader
            bucket="customer-media"
            folder="customer-media"
            maxImages={20}
            existingImages={customerPhotos}
            onUpload={setCustomerPhotos}
          />
        </div>
        {/* 联系人 */}
        <div className="mt-6 border-t border-gray-100 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">联系人</h2>
            <button
              type="button"
              onClick={addContact}
              className="px-3 py-1.5 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
            >
              + 添加联系人
            </button>
          </div>
          {contacts.length === 0 && <p className="text-sm text-gray-400">暂无联系人，点击上方按钮添加</p>}
          <div className="space-y-4">
            {contacts.map((c, idx) => (
              <div key={c.id} className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-700">联系人 #{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeContact(c.id)}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    删除
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">姓名 *</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={c.name}
                      onChange={(e) => updateContact(c.id, "name", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">电话 *</label>
                    <input
                      type="tel"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={c.phone}
                      onChange={(e) => {
                          const value = e.target.value;
                          updateContact(c.id, "phone", value);
                          if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                          searchTimeoutRef.current = setTimeout(() => {
                            searchContactByPhone(c.id, value);
                          }, 300);
                        }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">与客户关系</label>
                    <input
                      type="text"
                      placeholder="如：配偶、朋友"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={c.relationship}
                      onChange={(e) => updateContact(c.id, "relationship", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">备注</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={c.notes}
                      onChange={(e) => updateContact(c.id, "notes", e.target.value)}
                    />
                  </div>
                </div>
                {c.searchResult && (
                  <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs flex items-center justify-between">
                    <span className="text-blue-800">
                      系统中已存在客户：{c.searchResult.name}，是否关联为联系人？
                    </span>
                    <button
                      type="button"
                      onClick={() => fillContactFromSearch(c.id)}
                      className="text-blue-700 font-medium hover:text-blue-900"
                    >
                      关联
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button type="button" onClick={() => router.push("/customers")} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
        </div>
      </form>

      {/* 关联车辆 */}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">关联车辆</h2>
          <Link
            href={`/vehicles/new?customer_id=${id}`}
            className="px-3 py-1.5 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
          >
            + 新增车辆
          </Link>
        </div>
        {vehicles.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">车牌号</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">品牌</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">型号</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">VIN</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">颜色</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">年份</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">里程</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vehicles.map((v) => (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{v.plate_number}</td>
                    <td className="px-4 py-3 text-gray-600">{v.brand || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{v.model || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{v.vin || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{v.color || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{v.year ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{v.mileage != null ? v.mileage.toLocaleString() : "-"}</td>
                    <td className="px-4 py-3">
                      <Link href={`/vehicles/${v.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">暂无关联车辆</p>
        )}
      </div>
    </div>
  );
}
