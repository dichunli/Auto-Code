"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 刷新基础数据缓存 } from "@/app/work-orders/actions";
import { 解绑钉钉账号, 保存员工档案 } from "../../actions";
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
  base_salary: number | null;
  dingtalk_userid: string | null;
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
  /* 底薪数字字段按规范用字符串存储，提交时转 number */
  const [baseSalary, setBaseSalary] = useState(
    employee.base_salary != null ? String(employee.base_salary) : ""
  );
  const [dingtalkUserid, setDingtalkUserid] = useState(employee.dingtalk_userid || "");
  const [解绑中, set解绑中] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [originalContactIds] = useState<Set<string>>(
    new Set(initialContacts.map((c) => c.id).filter((id): id is string => !!id))
  );

  function toggleRole(roleId: string) {
    setRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  }

  /* 解除钉钉绑定（写库走 Server Action，解绑后该员工不再参与考勤同步） */
  async function 解绑钉钉() {
    if (!confirm("确定解除钉钉绑定吗？解绑后该员工不再参与考勤同步，可之后重新匹配。")) return;
    set解绑中(true);
    try {
      const result = await 解绑钉钉账号(employeeId);
      if (!result.success) {
        alert("解绑失败：" + (result.error || "未知错误"));
        return;
      }
      setDingtalkUserid("");
      alert("已解绑");
    } catch (err: unknown) {
      alert("解绑失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      set解绑中(false);
    }
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
      /* 写库走 Server Action：主表 + 角色 + 联系人在服务端一次提交内顺序执行 */
      const result = await 保存员工档案({
        employeeId,
        fullName,
        phone,
        groupId,
        levelId,
        gender,
        entryDate,
        address,
        notes,
        isActive,
        idCard,
        idCardFrontUrl,
        idCardBackUrl,
        baseSalary,
        roleIds,
        contacts,
        originalContactIds: [...originalContactIds],
      });
      if (!result.success) {
        alert("保存失败：" + (result.error || "未知错误"));
        setSaving(false);
        return;
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">月底薪标准（元）</label>
              <input
                type="number"
                min="0"
                step="100"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                placeholder="生成工资单时按出勤折算"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">钉钉绑定（考勤同步用）</label>
              {dingtalkUserid ? (
                <div className="flex items-center gap-3 h-9">
                  <span className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200">
                    已绑定
                  </span>
                  <span className="text-xs text-gray-400">编号 {dingtalkUserid}</span>
                  <button
                    type="button"
                    onClick={解绑钉钉}
                    disabled={解绑中}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {解绑中 ? "解绑中..." : "解绑"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center h-9">
                  <span className="text-xs px-2 py-1 rounded bg-gray-50 text-gray-500 border border-gray-200">
                    未绑定
                  </span>
                  <span className="ml-2 text-xs text-gray-400">到「考勤月报」页点「匹配钉钉账号」自动绑定</span>
                </div>
              )}
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
