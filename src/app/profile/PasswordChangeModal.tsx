"use client";

import {useState, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { 完整退出登录 } from "@/lib/logout";

interface Props {
  open: boolean;
  onClose: () => void;
  userEmail: string;
}

export function PasswordChangeModal({ open, onClose, userEmail }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* 关闭弹窗时重置状态 */
  function handleClose() {
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setLoading(false);
    onClose();
  }

  async function handleSubmit() {
    setError("");

    /* 校验输入 */
    if (!oldPassword) {
      setError("请输入旧密码");
      return;
    }
    if (!newPassword) {
      setError("请输入新密码");
      return;
    }
    if (newPassword.length < 6) {
      setError("新密码至少6位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (oldPassword === newPassword) {
      setError("新密码不能与旧密码相同");
      return;
    }

    setLoading(true);

    try {
      /* 第一步：用旧密码验证身份 */
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: oldPassword,
      });

      if (signInError) {
        setError("旧密码错误，请重新输入");
        setLoading(false);
        return;
      }

      /* 第二步：更新密码 */
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setError("密码修改失败：" + updateError.message);
        setLoading(false);
        return;
      }

      /* 密码修改成功：退出登录并跳转到登录页 */
      alert("密码修改成功，请使用新密码重新登录");
      /* 完整退出登录（2026-09-01）：本地清除+服务端后台作废 Token，见 src/lib/logout.ts */
      await 完整退出登录();
      window.location.href = "/login";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError("操作失败：" + msg);
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">修改密码</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">旧密码</label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="请输入当前密码"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少6位"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleSubmit();
                }
              }}
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="flex-1 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "修改中..." : "确认修改"}
          </button>
        </div>
      </div>
    </div>
  );
}
