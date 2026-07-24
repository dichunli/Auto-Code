"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 刷新基础数据缓存 } from "@/app/work-orders/actions";
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

interface EmployeeGroup {
  id: string;
  name: string;
}

interface Role {
  id: string;
  name: string;
  label: string;
}

interface MechanicLevel {
  id: string;
  name: string;
  level_code: string;
}

interface Employee {
  full_name: string;
  phone: string | null;
  group_id: string | null;
  mechanic_level_id: string | null;
  gender: string | null;
  entry_date: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  id_card: string | null;
  id_card_front_url: string | null;
  id_card_back_url: string | null;
}

interface Contact {
  id?: string;
  name: string;
  phone: string | null;
  relationship: string;
  is_primary: boolean;
}

interface Props {
  employeeId: string;
  groups: EmployeeGroup[];
  roles: Role[];
  levels: MechanicLevel[];
  employee: Employee;
  initialRoleIds: string[];
  initialContacts: Contact[];
}

export function EmployeeEditForm({
  employeeId,
  groups,
  roles,
  levels,
  employee,
  initialRoleIds,
  initialContacts,
}: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState(employee.full_name || "");
  const [phone, setPhone] = useState(employee.phone || "");
  const [groupId, setGroupId] = useState(employee.group_id || "");
  const [roleIds, setRoleIds] = useState<string[]>(initialRoleIds);
  const [levelId, setLevelId] = useState(employee.mechanic_level_id || "");
  const [gender, setGender] = useState(employee.gender || "");
  const [entryDate, setEntryDate] = useState(employee.entry_date || "");
  const [address, setAddress] = useState(employee.address || "");
  const [notes, setNotes] = useState(employee.notes || "");
  const [isActive, setIsActive] = useState(employee.is_active ?? true);
  const [idCard, setIdCard] = useState(employee.id_card || "");
  const [idCardFrontUrl, setIdCardFrontUrl] = useState<string>(employee.id_card_front_url || "");
  const [idCardBackUrl, setIdCardBackUrl] = useState<string>(employee.id_card_back_url || "");

  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [originalContactIds] = useState<Set<string>>(
    new Set(initialContacts.map((c) => c.id).filter(Boolean))
  );

  function toggleRole(roleId: string) {
    setRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  }

  function addContact() {
    setContacts([...contacts, { name: "", phone: "", relationship: "", is_primary: false }]);
  }

  function updateContact(index: number, field: "name" | "phone" | "relationship" | "is_primary", value: string | boolean) {
    setContacts((prev) =>
      prev.map((c, i) => {
        if (i === index) {
          return { ...c, [field]: value };
        }
        if (field === "is_primary" && value === true) {
          return { ...c, is_primary: false };
        }
        return c;
      })
    );
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

      const { data: existingRoles } = await supabase
        .from("profile_roles")
        .select("role_id")
        .eq("profile_id", employeeId);
      const existingRoleIds = (existingRoles || []).map((r: { role_id: string }) => r.role_id);
      const rolesToAdd = roleIds.filter((id) => !existingRoleIds.includes(id));
      const rolesToRemove = existingRoleIds.filter((id) => !roleIds.includes(id));

      if (rolesToAdd.length > 0) {
        const roleRows = rolesToAdd.map((rid) => ({
          profile_id: employeeId,
          role_id: rid,
        }));
        const { error: addRoleError } = await supabase.from("profile_roles").insert(roleRows);
        if (addRoleError) throw addRoleError;
      }
      if (rolesToRemove.length > 0) {
        const { error: removeRoleError } = await supabase
          .from("profile_roles")
          .delete()
          .eq("profile_id", employeeId)
          .in("role_id", rolesToRemove);
        if (removeRoleError) throw removeRoleError;
      }

      const validContacts = contacts.filter((c) => c.name.trim());
      const contactsToAdd = validContacts.filter((c) => !c.id);
      const contactsToUpdate = validContacts.filter((c) => c.id);
      const keptContactIds = new Set(contactsToUpdate.map((c) => c.id));
      const contactIdsToRemove = [...originalContactIds].filter((id) => !keptContactIds.has(id));

      if (contactsToAdd.length > 0) {
        const contactRows = contactsToAdd.map((c) => ({
          profile_id: employeeId,
          name: c.name.trim(),
          phone: c.phone || null,
          relationship: c.relationship || "other",
          is_primary: c.is_primary,
        }));
        const { error: addContactError } = await supabase.from("employee_contacts").insert(contactRows);
        if (addContactError) throw addContactError;
      }

      for (const c of contactsToUpdate) {
        const { error: updateContactError } = await supabase
          .from("employee_contacts")
          .update({
            name: c.name.trim(),
            phone: c.phone || null,
            relationship: c.relationship || "other",
            is_primary: c.is_primary,
          })
          .eq("id", c.id);
        if (updateContactError) throw updateContactError;
      }

      if (contactIdsToRemove.length > 0) {
        const { error: removeContactError } = await supabase
          .from("employee_contacts")
          .delete()
          .eq("profile_id", employeeId)
          .in("id", contactIdsToRemove);
        if (removeContactError) throw removeContactError;
      }

      await 刷新基础数据缓存();
      await router.push(`/employees/${employeeId}`);
      router.refresh();
    } catch (err: unknown) {
      alert("保存失败：" + (err instanceof Error ? err.message : String(err)));
      setSaving(false);
    }
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
                    value={c.phone || ""}
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
