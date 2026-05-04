"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import Link from "next/link";

export default function EditCustomerPage() {
  const router = useRouter();
  const params = useParams();
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
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [originalPhone, setOriginalPhone] = useState("");
  const [contacts, setContacts] = useState<ContactForm[]>([]);
  let contactIdCounter = 0;

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from("customers").select("*").eq("id", id).single();
      if (data) {
        setOriginalPhone(data.phone || "");
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
          (contactData || []).map((c: any) => ({ ...c, isExisting: true }))
        );
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

    // 手机号唯一性校验（变更时才检查）
    if (form.phone.trim() !== originalPhone.trim()) {
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
      phone: form.phone.trim(),
      gender: form.gender || null,
      address: form.address.trim() || null,
      company: form.company.trim() || null,
      id_card: form.id_card.trim() || null,
      notes: form.notes.trim() || null,
    }).eq("id", id);

    if (error) { alert("保存失败: " + error.message); setSaving(false); return; }

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

    router.push("/customers");
    router.refresh();
  }

  function addContact() {
    contactIdCounter++;
    setContacts((prev) => [
      ...prev,
      { id: `c-${Date.now()}-${contactIdCounter}`, name: "", phone: "", relationship: "", notes: "" },
    ]);
  }

  function removeContact(contactId: string) {
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
  }

  function updateContact(contactId: string, field: keyof ContactForm, value: string) {
    setContacts((prev) => prev.map((c) => (c.id === contactId ? { ...c, [field]: value } : c)));
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
            <label className="block text-sm font-medium text-gray-700 mb-1">联系电话 *</label>
            <input required type="tel" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
                      onChange={(e) => updateContact(c.id, "phone", e.target.value)}
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
