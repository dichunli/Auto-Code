"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function EditCompanyPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    contact: "",
    phone: "",
    address: "",
    credit_limit: "",
    payment_terms: "月结",
    notes: "",
    invoice_title: "",
    tax_no: "",
    bank_name: "",
    bank_account: "",
    invoice_address: "",
    invoice_phone: "",
  });

  const [contacts, setContacts] = useState<{ id: string; name: string; phone: string; title: string }[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from("companies").select("*").eq("id", id).single();
      if (data) {
        setForm({
          name: data.name || "",
          contact: data.contact || "",
          phone: data.phone || "",
          address: data.address || "",
          credit_limit: data.credit_limit?.toString() || "",
          payment_terms: data.payment_terms || "月结",
          notes: data.notes || "",
          invoice_title: data.invoice_title || "",
          tax_no: data.tax_no || "",
          bank_name: data.bank_name || "",
          bank_account: data.bank_account || "",
          invoice_address: data.invoice_address || "",
          invoice_phone: data.invoice_phone || "",
        });
      }
      const { data: contactData } = await supabase
        .from("company_contacts")
        .select("id, name, phone, title")
        .eq("company_id", id)
        .order("created_at", { ascending: true });
      if (contactData) {
        setContacts(contactData.map((c: any) => ({ id: c.id, name: c.name || "", phone: c.phone || "", title: c.title || "" })));
      }
      const { data: vehicleData } = await supabase
        .from("vehicles")
        .select("id, plate_number, brand, model, customers(name)")
        .eq("company_id", id)
        .order("created_at", { ascending: false });
      setVehicles(vehicleData || []);
      setLoading(false);
    }
    load();
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { alert("请填写单位名称"); return; }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("companies").update({
      name: form.name.trim(),
      contact: form.contact.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : 0,
      payment_terms: form.payment_terms.trim() || "月结",
      notes: form.notes.trim() || null,
      invoice_title: form.invoice_title.trim() || null,
      tax_no: form.tax_no.trim() || null,
      bank_name: form.bank_name.trim() || null,
      bank_account: form.bank_account.trim() || null,
      invoice_address: form.invoice_address.trim() || null,
      invoice_phone: form.invoice_phone.trim() || null,
    }).eq("id", id);

    if (error) { alert("保存失败: " + error.message); setSaving(false); return; }

    // 同步联系人：先删除旧的，再插入新的
    await supabase.from("company_contacts").delete().eq("company_id", id);
    const validContacts = contacts.filter((c) => c.name.trim());
    if (validContacts.length > 0) {
      const contactInserts = validContacts.map((c) => ({
        company_id: id,
        name: c.name.trim(),
        phone: c.phone.trim() || null,
        title: c.title.trim() || null,
      }));
      await supabase.from("company_contacts").insert(contactInserts);
    }

    router.push("/companies");
    router.refresh();
  }

  if (loading) return <div className="py-8 text-sm text-gray-500">加载中...</div>;

  return (
    <div>
      <PageHeader title="编辑单位" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">单位名称 *</label>
            <input required type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">联系人</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">联系电话</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">信用额度</label>
            <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">结算方式</label>
            <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}>
              <option value="月结">月结</option>
              <option value="季结">季结</option>
              <option value="现结">现结</option>
              <option value="赊销">赊销</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        {/* 联系人 */}
        <div className="border-t border-gray-100 mt-6 pt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">联系人</h2>
            <button
              type="button"
              onClick={() =>
                setContacts((prev) => [
                  ...prev,
                  { id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: "", phone: "", title: "" },
                ])
              }
              className="px-3 py-1.5 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
            >
              + 添加联系人
            </button>
          </div>
          {contacts.length === 0 && (
            <p className="text-sm text-gray-400">点击"添加联系人"按钮录入联系人</p>
          )}
          <div className="space-y-3">
            {contacts.map((c, idx) => (
              <div key={c.id} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end bg-gray-50 rounded-lg p-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">姓名</label>
                  <input
                    type="text"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={c.name}
                    onChange={(e) =>
                      setContacts((prev) =>
                        prev.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x))
                      )
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">职务</label>
                  <input
                    type="text"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={c.title}
                    onChange={(e) =>
                      setContacts((prev) =>
                        prev.map((x) => (x.id === c.id ? { ...x, title: e.target.value } : x))
                      )
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">电话</label>
                  <input
                    type="text"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={c.phone}
                    onChange={(e) =>
                      setContacts((prev) =>
                        prev.map((x) => (x.id === c.id ? { ...x, phone: e.target.value } : x))
                      )
                    }
                  />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => setContacts((prev) => prev.filter((x) => x.id !== c.id))}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 开票信息 */}
        <div className="border-t border-gray-100 mt-6 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">开票信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">发票抬头</label>
              <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.invoice_title} onChange={(e) => setForm({ ...form, invoice_title: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">税号</label>
              <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.tax_no} onChange={(e) => setForm({ ...form, tax_no: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">开户行</label>
              <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">银行账号</label>
              <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">开票电话</label>
              <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.invoice_phone} onChange={(e) => setForm({ ...form, invoice_phone: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">开票地址</label>
              <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.invoice_address} onChange={(e) => setForm({ ...form, invoice_address: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button type="button" onClick={() => router.push("/companies")} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
        </div>
      </form>

      {/* 关联车辆 */}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <h2 className="text-base font-semibold text-gray-900 mb-4">关联车辆</h2>
        {vehicles.length === 0 ? (
          <p className="text-sm text-gray-400">暂无关联车辆</p>
        ) : (
          <div className="space-y-2">
            {vehicles.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <span className="text-sm font-medium text-gray-900">{v.plate_number}</span>
                  <span className="text-sm text-gray-500 ml-2">{v.brand} {v.model}</span>
                  {v.customers?.name && (
                    <span className="text-xs text-gray-400 ml-2">车主：{v.customers.name}</span>
                  )}
                </div>
                <a href={`/vehicles/${v.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">查看</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
