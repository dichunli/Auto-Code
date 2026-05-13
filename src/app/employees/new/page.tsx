"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";

const GENDERS = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
];

export default function NewEmployeePage() {
  const router = useRouter();
  const supabase = createClient();

  const [groups, setGroups] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [levels, setLevels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [accountPhone, setAccountPhone] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [groupId, setGroupId] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [levelId, setLevelId] = useState("");
  const [gender, setGender] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [idCard, setIdCard] = useState("");
  const [idCardFrontUrl, setIdCardFrontUrl] = useState<string>("");
  const [idCardBackUrl, setIdCardBackUrl] = useState<string>("");

  const [contacts, setContacts] = useState<
    { name: string; phone: string; relationship: string; is_primary: boolean }[]
  >([{ name: "", phone: "", relationship: "", is_primary: true }]);

  const RELATIONSHIPS = [
    { value: "spouse", label: "配偶" },
    { value: "father", label: "父亲" },
    { value: "mother", label: "母亲" },
    { value: "child", label: "子女" },
    { value: "sibling", label: "兄弟姐妹" },
    { value: "friend", label: "朋友" },
    { value: "colleague", label: "同事" },
    { value: "other", label: "其他" },
  ];

  useEffect(() => {
    async function loadData() {
      const [{ data: g }, { data: r }, { data: l }] = await Promise.all([
        supabase.from("employee_groups").select("id, name").order("sort_order"),
        supabase.from("roles").select("id, name, label").order("name"),
        supabase.from("mechanic_levels").select("id, name, level_code").order("level_code"),
      ]);
      setGroups(g || []);
      setRoles(r || []);
      setLevels(l || []);
    }
    loadData();
  }, [supabase]);

  function toggleRole(roleId: string) {
    setRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  }

  function addContact() {
    setContacts([...contacts, { name: "", phone: "", relationship: "", is_primary: false }]);
  }

  function updateContact(index: number, field: string, value: string | boolean) {
    const next = [...contacts];
    (next[index] as any)[field] = value;
    if (field === "is_primary" && value === true) {
      next.forEach((c, i) => { if (i !== index) c.is_primary = false; });
    }
    setContacts(next);
  }

  function removeContact(index: number) {
    setContacts(contacts.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountPhone || !password || !fullName) {
      alert("请填写手机号、密码和姓名");
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(accountPhone)) {
      alert("请输入正确的11位手机号码");
      return;
    }
    if (password.length < 6) {
      alert("密码至少6位");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountPhone,
          password,
          fullName,
          phone,
          groupId,
          roleIds,
          levelId,
          gender,
          entryDate,
          address,
          notes,
          idCard,
          idCardFrontUrl,
          idCardBackUrl,
          contacts,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "创建失败");

      router.push("/employees");
      router.refresh();
    } catch (err: any) {
      alert("保存失败：" + err.message);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="新增员工" description="创建系统账号并完善员工档案" />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">手机号（登录账号）*</label>
              <input
                type="tel"
                value={accountPhone}
                onChange={(e) => setAccountPhone(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="11位手机号码"
                maxLength={11}
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密码 *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="至少6位"
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">电话</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">分组</label>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">请选择分组</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">性别</label>
              <div className="flex gap-2">
                {GENDERS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGender(gender === g.value ? "" : g.value)}
                    className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                      gender === g.value
                        ? "bg-blue-50 text-blue-700 border-blue-300"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">入职日期</label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">技师等级</label>
              <select
                value={levelId}
                onChange={(e) => setLevelId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">请选择等级</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>{l.level_code ? `${l.level_code} ` : ""}{l.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRole(r.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    roleIds.includes(r.id)
                      ? "bg-blue-50 text-blue-700 border-blue-300"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">身份证号</label>
            <input
              type="text"
              value={idCard}
              onChange={(e) => setIdCard(e.target.value)}
              placeholder="18位身份证号码"
              maxLength={18}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">身份证正面</label>
              <ImageUploader
                key={`id-front-${idCardFrontUrl}`}
                existingImages={idCardFrontUrl ? [idCardFrontUrl] : []}
                onUpload={(paths) => setIdCardFrontUrl(paths[0] || "")}
                maxImages={1}
                folder="id-cards"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">身份证反面</label>
              <ImageUploader
                key={`id-back-${idCardBackUrl}`}
                existingImages={idCardBackUrl ? [idCardBackUrl] : []}
                onUpload={(paths) => setIdCardBackUrl(paths[0] || "")}
                maxImages={1}
                folder="id-cards"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>

          {/* 联系人 */}
          <div className="border-t border-gray-100 pt-5">
            <label className="block text-sm font-medium text-gray-700 mb-3">联系人</label>
            <div className="space-y-3">
              {contacts.map((c, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <input
                    type="text"
                    placeholder="姓名"
                    value={c.name}
                    onChange={(e) => updateContact(i, "name", e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="tel"
                    placeholder="电话"
                    value={c.phone}
                    onChange={(e) => updateContact(i, "phone", e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={c.relationship}
                    onChange={(e) => updateContact(i, "relationship", e.target.value)}
                    className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">关系</option>
                    {RELATIONSHIPS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-sm text-gray-600 shrink-0 pt-2">
                    <input
                      type="checkbox"
                      checked={c.is_primary}
                      onChange={(e) => updateContact(i, "is_primary", e.target.checked)}
                      className="rounded"
                    />
                    主要
                  </label>
                  {contacts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeContact(i)}
                      className="text-red-500 text-sm px-2 pt-2 hover:text-red-700"
                    >
                      删除
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addContact}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                + 添加联系人
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? "保存中..." : "保存"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/employees")}
              className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
