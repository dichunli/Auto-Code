"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { 借用工具, 归还工具 } from "@/app/tools/actions";

interface 工具 {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
  status: string;
  require_return_photos?: boolean;
  require_location_scan?: boolean;
}

interface 借用记录 {
  id: string;
  tool_id: string;
  borrower_id: string | null;
  borrowed_at: string;
  returner_id: string | null;
  returned_at: string | null;
  notes: string | null;
  profiles?: { full_name: string | null } | null;
}

interface 员工 {
  id: string;
  full_name: string | null;
}

interface Props {
  工具: 工具 | null;
  未归还记录: 借用记录 | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const 状态标签: Record<string, { label: string; className: string }> = {
  available: { label: "在库", className: "bg-green-50 text-green-700" },
  borrowed: { label: "借出", className: "bg-amber-50 text-amber-700" },
  scrapped: { label: "报废", className: "bg-gray-100 text-gray-500" },
};

export default function ToolBorrowReturnModal({
  工具,
  未归还记录,
  open,
  onClose,
  onSuccess,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [员工列表, set员工列表] = useState<员工[]>([]);
  const [选中员工, set选中员工] = useState("");
  const [当前用户ID, set当前用户ID] = useState<string | null>(null);
  const [备注, set备注] = useState("");
  const [提交中, set提交中] = useState(false);
  const [加载中, set加载中] = useState(false);

  const 是App = useMemo(() => 是Capacitor环境(), []);

  useEffect(() => {
    if (!open) return;
    async function 加载() {
      set加载中(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          set当前用户ID(user.id);
          if (!是App) set选中员工(user.id);
        }

        if (!是App) {
          const { data: empData } = await supabase
            .from("profiles")
            .select("id, full_name")
            .eq("is_active", true)
            .order("full_name")
            .limit(200);
          set员工列表((empData as 员工[]) || []);
        }
      } finally {
        set加载中(false);
      }
    }
    加载();
  }, [open, supabase, 是App]);

  useEffect(() => {
    if (open) {
      set备注("");
    }
  }, [open, 工具?.id]);

  if (!open || !工具) return null;

  const 状态配置 = 状态标签[工具.status] || { label: 工具.status, className: "bg-gray-100 text-gray-600" };
  const 是借用 = 工具.status === "available";
  const 是归还 = 工具.status === "borrowed";
  const 不可操作 = 工具.status === "scrapped";

  async function 提交借用() {
    const operatorId = 是App ? 当前用户ID : 选中员工;
    if (!operatorId) {
      alert("请选择借用人");
      return;
    }
    set提交中(true);
    try {
      /* 写库走 Server Action：插借用记录 + 改工具状态在服务端顺序执行 */
      const result = await 借用工具({ toolId: 工具!.id, borrowerId: operatorId, notes: 备注 });
      if (!result.success) throw new Error(result.error || "借用失败");

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("借用失败: " + msg);
    } finally {
      set提交中(false);
    }
  }

  async function 提交归还() {
    if (!未归还记录) return;
    const operatorId = 是App ? 当前用户ID : 选中员工;
    if (!operatorId) {
      alert("请选择归还人");
      return;
    }
    set提交中(true);
    try {
      /* 写库走 Server Action：改借用记录 + 改工具状态在服务端顺序执行 */
      const 合并备注 = 未归还记录.notes
        ? `${未归还记录.notes}\n归还备注：${备注.trim() || "无"}`
        : `归还备注：${备注.trim() || "无"}`;
      const result = await 归还工具({
        recordId: 未归还记录.id,
        toolId: 工具!.id,
        returnerId: operatorId,
        notes: 合并备注,
        photos: [],
      });
      if (!result.success) throw new Error(result.error || "归还失败");

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("归还失败: " + msg);
    } finally {
      set提交中(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-6 max-w-md w-full mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">工具{是借用 ? "借用" : 是归还 ? "归还" : "状态"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        </div>

        <div className="flex gap-3">
          {(工具.image_url ? 工具.image_url.split(",").filter(Boolean)[0] : "") ? (
            <img
              src={工具.image_url!.split(",").filter(Boolean)[0]}
              alt={工具.name}
              className="w-16 h-16 rounded-lg object-cover border border-gray-200"
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs">无图</div>
          )}
          <div className="flex-1 space-y-1">
            <div className="font-medium text-gray-900">{工具.name}</div>
            <div className="text-sm text-gray-500">编码：{工具.code}</div>
            <span className={`text-xs px-2 py-0.5 rounded ${状态配置.className}`}>{状态配置.label}</span>
          </div>
        </div>

        {未归还记录 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
            <p className="text-amber-800">借用人：{未归还记录.profiles?.full_name || "-"}</p>
            <p className="text-amber-700">借用时间：{new Date(未归还记录.borrowed_at).toLocaleString()}</p>
          </div>
        )}

        {不可操作 ? (
          <div className="text-center py-4 text-gray-500">该工具已报废，不可借用或归还</div>
        ) : (
          <>
            <div className="space-y-3">
              {!是App && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {是借用 ? "借用人" : "归还人"} *
                  </label>
                  <select
                    value={选中员工}
                    onChange={(e) => set选中员工(e.target.value)}
                    disabled={加载中}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="">请选择</option>
                    {员工列表.map((e) => (
                      <option key={e.id} value={e.id}>{e.full_name || "未命名"}</option>
                    ))}
                  </select>
                </div>
              )}
              {是App && (
                <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
                  当前为 APP 操作，将使用您的登录账号作为{是借用 ? "借用人" : "归还人"}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <input
                  type="text"
                  value={备注}
                  onChange={(e) => set备注(e.target.value)}
                  placeholder="可选：填写借还备注"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              {是借用 && (
                <button
                  type="button"
                  onClick={提交借用}
                  disabled={提交中 || (!是App && !选中员工)}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {提交中 ? "提交中..." : "确认借用"}
                </button>
              )}
              {是归还 && (工具.require_return_photos || 工具.require_location_scan) && !是App ? (
                <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg text-center">
                  该工具需扫码/拍照归还，请在手机端 APP 操作
                </div>
              ) : 是归还 && (
                <button
                  type="button"
                  onClick={提交归还}
                  disabled={提交中 || (!是App && !选中员工)}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  {提交中 ? "提交中..." : "确认归还"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
