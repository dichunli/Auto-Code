"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import { PasswordChangeModal } from "./PasswordChangeModal";
import { 保存个人信息 } from "./actions";

const GENDERS = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
];

interface 用户资料 {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  gender: string | null;
  address: string | null;
  notes: string | null;
  entry_date: string | null;
  id_card: string | null;
  group_id: string | null;
  mechanic_level_id: string | null;
  employee_groups?: { name: string } | null;
  mechanic_levels?: { name: string } | null;
  profile_roles?: { roles: { label: string; name: string } | null }[] | null;
}

export default function ProfilePage() {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const [profile, setProfile] = useState<用户资料 | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [gender, setGender] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  /* 加载用户资料 */
  useEffect(() => {
    async function loadProfile() {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      setUserEmail(user.email || "");

      const { data } = await supabase
        .from("profiles")
        .select(`
          *,
          employee_groups(name),
          mechanic_levels(name),
          profile_roles(roles(label, name))
        `)
        .eq("id", user.id)
        .single();

      if (data) {
        const typed = data as unknown as 用户资料;
        setProfile(typed);
        setFullName(typed.full_name || "");
        setPhone(typed.phone || "");
        setAvatarUrl(typed.avatar_url || "");
        setGender(typed.gender || "");
        setAddress(typed.address || "");
        setNotes(typed.notes || "");
      }

      setLoading(false);
    }

    loadProfile();
  }, [supabase]);

  async function handleSave() {
    if (!fullName.trim()) {
      alert("请填写姓名");
      return;
    }

    setSaving(true);

    try {
      /* 保存走 Server Action，用户身份由服务端验证，只改自己的资料 */
      const result = await 保存个人信息({
        fullName,
        phone,
        avatarUrl,
        gender,
        address,
        notes,
      });

      if (!result.success) {
        alert("保存失败：" + (result.error || "未知错误"));
        return;
      }

      /* 更新本地状态 */
      if (profile) {
        setProfile({
          ...profile,
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          avatar_url: avatarUrl || null,
          gender: gender || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        });
      }

      alert("保存成功");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("保存失败：" + msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader title="个人信息" description="查看和修改个人资料" />
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500">
          加载中...
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader title="个人信息" description="查看和修改个人资料" />
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500">
          未获取到用户信息，请重新登录
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="个人信息" description="查看和修改个人资料" />

      {/* 用户信息卡片 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-4">
          {/* 头像 */}
          <div className="relative shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="头像"
                className="w-16 h-16 rounded-full object-cover border border-gray-200"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xl font-bold border border-gray-200">
                {fullName ? fullName.charAt(0) : "?"}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">
              {profile.full_name}
            </h2>
            <div className="flex flex-wrap gap-1 mt-1">
              {profile.profile_roles && profile.profile_roles.length > 0 ? (
                profile.profile_roles.map((pr, index) => (
                  <span
                    key={index}
                    className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700"
                  >
                    {pr.roles?.label || pr.roles?.name || "未知角色"}
                  </span>
                ))
              ) : (
                <span className="text-xs text-gray-400">未分配角色</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 编辑表单 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h3 className="text-base font-semibold text-gray-900">基本信息</h3>

        {/* 头像上传 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">头像</label>
          <ImageUploader
            existingImages={avatarUrl ? [avatarUrl] : []}
            onUpload={(paths) => setAvatarUrl(paths[0] || "")}
            maxImages={1}
            folder="avatars"
          />
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
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
          />
        </div>

        {/* 只读信息 */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-500">以下信息由管理员管理，如需修改请联系管理员</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">分组：</span>
              <span className="text-gray-900">{profile.employee_groups?.name || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">技师等级：</span>
              <span className="text-gray-900">{profile.mechanic_levels?.name || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">入职日期：</span>
              <span className="text-gray-900">{profile.entry_date || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">身份证号：</span>
              <span className="text-gray-900">{profile.id_card || "-"}</span>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存修改"}
          </button>
          <button
            type="button"
            onClick={() => setShowPasswordModal(true)}
            className="flex-1 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            修改密码
          </button>
        </div>
      </div>

      {/* 修改密码弹窗 */}
      <PasswordChangeModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        userEmail={userEmail}
      />
    </div>
  );
}
