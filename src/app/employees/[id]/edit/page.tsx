"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";

const GENDERS = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
];

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

export default function EditEmployeePage() {
  const router = useRouter();
  const params = useParams();
  const employeeId = params.id as string;
  const supabase = createClient();

  const [groups, setGroups] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [levels, setLevels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [groupId, setGroupId] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [levelId, setLevelId] = useState("");
  const [gender, setGender] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [idCard, setIdCard] = useState("");
  const [idCardFrontUrl, setIdCardFrontUrl] = useState<string>("");
  const [idCardBackUrl, setIdCardBackUrl] = useState<string>("");

  const [contacts, setContacts] = useState<
    { id?: string; name: string; phone: string; relationship: string; is_primary: boolean }[]
  >([]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [{ data: g }, { data: r }, { data: l }] = await Promise.all([
        supabase.from("employee_groups").select("id, name").order("sort_order"),
        supabase.from("roles").select("id, name, label").order("name"),
        supabase.from("mechanic_levels").select("id, name, level_code").order("level_code"),
      ]);
      setGroups(g || []);
      setRoles(r || []);
      setLevels(l || []);

      // 加载员工数据
      const { data: employee } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", employeeId)
        .single();

      if (employee) {
        setFullName(employee.full_name || "");
        setPhone(employee.phone || "");
        setGroupId(employee.group_id || "");
        setLevelId(employee.mechanic_level_id || "");
        setGender(employee.gender || "");
        setEntryDate(employee.entry_date || "");
        setAddress(employee.address || "");
        setNotes(employee.notes || "");
        setIsActive(employee.is_active ?? true);
        setIdCard(employee.id_card || "");
        setIdCardFrontUrl(employee.id_card_front_url || "");
        setIdCardBackUrl(employee.id_card_back_url || "");
      }

      // 加载角色
      const { data: userRoles } = await supabase
        .from("profile_roles")
        .select("role_id")
        .eq("profile_id", employeeId);
      setRoleIds((userRoles || []).map((ur: any) => ur.role_id));

      // 加载联系人
      const { data: userContacts } = await supabase
        .from("employee_contacts")
        .select("*")
        .eq("profile_id", employeeId)
        .order("is_primary", { ascending: false });
      setContacts(
        (userContacts || []).map((c: any) => ({
          id: c.id,
          name: c.name || "",
          phone: c.phone || "",
          relationship: c.relationship || "",
          is_primary: c.is_primary || false,
        }))
      );

      setLoading(false);
    }
    loadData();
  }, [supabase, employeeId]);

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
    if (!fullName) {
      alert("请填写姓名");
      return;
    }

    setSaving(true);
    try {
      // 更新 profiles
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          phone: phone || null,
          group_id: groupId || null,
          mechanic_level_id: levelId || null,
          gender: gender || null,
          entry_date: entryDate || null,
          address: address || null,
          notes: notes || null,
          is_active: isActive,
          id_card: idCard || null,
          id_card_front_url: idCardFrontUrl || null,
          id_card_back_url: idCardBackUrl || null,
        })
        .eq("id", employeeId);

      if (profileError) throw profileError;

      // 更新角色：先删除旧的，再插入新的
      await supabase.from("profile_roles").delete().eq("profile_id", employeeId);
      if (roleIds.length > 0) {
        const roleRows = roleIds.map((rid) => ({
          profile_id: employeeId,
          role_id: rid,
        }));
        const { error: roleError } = await supabase.from("profile_roles").insert(roleRows);
        if (roleError) throw roleError;
      }

      // 更新联系人：删除旧的，插入新的
      await supabase.from("employee_contacts").delete().eq("profile_id", employeeId);
      const validContacts = contacts.filter((c) => c.name.trim() && c.relationship);
      if (validContacts.length > 0) {
        const contactRows = validContacts.map((c) => ({
          profile_id: employeeId,
          name: c.name.trim(),
          phone: c.phone || null,
          relationship: c.relationship,
          is_primary: c.is_primary,
        }));
        const { error: contactError } = await supabase.from("employee_contacts").insert(contactRows);
        if (contactError) throw contactError;
      }

      router.push(`/employees/${employeeId}`);
      router.refresh();
    } catch (err: any) {
      alert("保存失败：" + (err instanceof Error ? err.message : String(err)));
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader title="编辑员工" />
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="编辑员工" description="修改员工档案信息" />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
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

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded"
              />
              在职
            </label>
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
                  {contacts.length > 0 && (
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
              disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button
              type="button"
              onClick={() => router.push(`/employees/${employeeId}`)}
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
