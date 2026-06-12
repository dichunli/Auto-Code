"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import BarcodeScanModal from "@/components/BarcodeScanModal";

interface 工具 {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
  instructions: string | null;
  knowledge_article_id: string | null;
  location: string | null;
  status: string;
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

const 状态标签: Record<string, { label: string; className: string }> = {
  available: { label: "在库", className: "bg-green-50 text-green-700" },
  borrowed: { label: "借出", className: "bg-amber-50 text-amber-700" },
  scrapped: { label: "报废", className: "bg-gray-100 text-gray-500" },
};

export default function ToolBorrowScanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toolId = searchParams.get("id") || "";
  const supabase = useMemo(() => createClient(), []);

  const [工具, set工具] = useState<工具 | null>(null);
  const [未归还记录, set未归还记录] = useState<借用记录 | null>(null);
  const [员工列表, set员工列表] = useState<员工[]>([]);
  const [选中员工, set选中员工] = useState("");
  const [当前用户ID, set当前用户ID] = useState<string | null>(null);
  const [备注, set备注] = useState("");
  const [加载中, set加载中] = useState(true);
  const [提交中, set提交中] = useState(false);
  const [错误, set错误] = useState("");
  const [扫码弹窗打开, set扫码弹窗打开] = useState(false);
  const [成功提示, set成功提示] = useState("");

  const 是App = useMemo(() => 是Capacitor环境(), []);

  useEffect(() => {
    async function 加载() {
      set加载中(true);
      set错误("");
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) set当前用户ID(user.id);

        if (!toolId) {
          set错误("未提供工具 ID");
          set加载中(false);
          return;
        }

        const { data: toolData, error: toolError } = await supabase
          .from("tools")
          .select("*")
          .eq("id", toolId)
          .single();
        if (toolError || !toolData) {
          set错误("工具不存在或已删除");
          set加载中(false);
          return;
        }
        set工具(toolData as 工具);

        /* 加载当前未归还记录 */
        const { data: recordData } = await supabase
          .from("tool_borrow_records")
          .select("*, profiles(full_name)")
          .eq("tool_id", toolId)
          .is("returned_at", null)
          .order("borrowed_at", { ascending: false })
          .limit(1)
          .single();
        set未归还记录((recordData as 借用记录) || null);

        /* 浏览器环境：加载员工列表供选择 */
        if (!是App) {
          const { data: empData } = await supabase
            .from("profiles")
            .select("id, full_name")
            .eq("is_active", true)
            .order("full_name")
            .limit(200);
          set员工列表((empData as 员工[]) || []);
          if (user) set选中员工(user.id);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        set错误(msg);
      } finally {
        set加载中(false);
      }
    }
    加载();
  }, [toolId, supabase, 是App]);

  async function 提交借用() {
    if (!工具) return;
    const operatorId = 是App ? 当前用户ID : 选中员工;
    if (!operatorId) {
      alert("请选择借用人");
      return;
    }
    set提交中(true);
    try {
      const { error: insertError } = await supabase.from("tool_borrow_records").insert({
        tool_id: 工具.id,
        borrower_id: operatorId,
        borrowed_at: new Date().toISOString(),
        notes: 备注.trim() || null,
      });
      if (insertError) throw insertError;

      const { error: updateError } = await supabase
        .from("tools")
        .update({ status: "borrowed", updated_at: new Date().toISOString() })
        .eq("id", 工具.id);
      if (updateError) throw updateError;

      set成功提示("借用登记成功");
      setTimeout(() => router.push("/tools/management"), 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("借用失败: " + msg);
    } finally {
      set提交中(false);
    }
  }

  async function 提交归还() {
    if (!工具 || !未归还记录) return;
    const operatorId = 是App ? 当前用户ID : 选中员工;
    if (!operatorId) {
      alert("请选择归还人");
      return;
    }
    set提交中(true);
    try {
      const { error: updateRecordError } = await supabase
        .from("tool_borrow_records")
        .update({
          returner_id: operatorId,
          returned_at: new Date().toISOString(),
          notes: 未归还记录.notes
            ? `${未归还记录.notes}\n归还备注：${备注.trim() || "无"}`
            : `归还备注：${备注.trim() || "无"}`,
        })
        .eq("id", 未归还记录.id);
      if (updateRecordError) throw updateRecordError;

      const { error: updateToolError } = await supabase
        .from("tools")
        .update({ status: "available", updated_at: new Date().toISOString() })
        .eq("id", 工具.id);
      if (updateToolError) throw updateToolError;

      set成功提示("归还登记成功");
      setTimeout(() => router.push("/tools/management"), 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("归还失败: " + msg);
    } finally {
      set提交中(false);
    }
  }

  function 处理扫码(code: string) {
    const trimmed = code.trim();
    if (!trimmed.startsWith("tool:")) {
      alert("未识别为工具二维码");
      return;
    }
    const newId = trimmed.slice(5);
    if (!newId) {
      alert("二维码内容无效");
      return;
    }
    router.push(`/tools/borrow-scan?id=${encodeURIComponent(newId)}`);
  }

  if (加载中) {
    return (
      <div>
        <PageHeader title="工具借还" />
        <div className="text-sm text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  if (错误 || !工具) {
    return (
      <div>
        <PageHeader title="工具借还" />
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700">{错误 || "未找到工具"}</p>
          <button
            onClick={() => router.push("/tools/management")}
            className="mt-4 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            返回工具列表
          </button>
        </div>
      </div>
    );
  }

  const 状态配置 = 状态标签[工具.status] || { label: 工具.status, className: "bg-gray-100 text-gray-600" };
  const 是借用 = 工具.status === "available";
  const 是归还 = 工具.status === "borrowed";
  const 不可操作 = 工具.status === "scrapped";

  return (
    <div>
      <PageHeader title="工具借还" />

      {成功提示 && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {成功提示}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl space-y-5">
        {/* 工具信息卡片 */}
        <div className="flex gap-4">
          {工具.image_url ? (
            <img
              src={工具.image_url}
              alt={工具.name}
              className="w-24 h-24 rounded-lg object-cover border border-gray-200"
            />
          ) : (
            <div className="w-24 h-24 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs">无图</div>
          )}
          <div className="flex-1 space-y-1">
            <div className="text-lg font-semibold text-gray-900">{工具.name}</div>
            <div className="text-sm text-gray-500">编码：{工具.code}</div>
            <div className="text-sm text-gray-500">位置：{工具.location || "-"}</div>
            <div className="pt-1">
              <span className={`text-xs px-2 py-0.5 rounded ${状态配置.className}`}>{状态配置.label}</span>
            </div>
          </div>
        </div>

        {工具.instructions && (
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">
            {工具.instructions}
          </div>
        )}

        {未归还记录 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
            <p className="font-medium text-amber-800">当前借出信息</p>
            <p className="text-amber-700">借用人：{未归还记录.profiles?.full_name || "-"}</p>
            <p className="text-amber-700">借用时间：{new Date(未归还记录.borrowed_at).toLocaleString()}</p>
          </div>
        )}

        {不可操作 ? (
          <div className="text-center py-6 text-gray-500">该工具已报废，不可借用或归还</div>
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => router.push("/tools/management")}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => set扫码弹窗打开(true)}
                className="px-4 py-2 text-sm font-medium text-blue-600 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
              >
                继续扫码
              </button>
              {是借用 && (
                <button
                  type="button"
                  onClick={提交借用}
                  disabled={提交中 || (!是App && !选中员工)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {提交中 ? "提交中..." : "确认借用"}
                </button>
              )}
              {是归还 && (
                <button
                  type="button"
                  onClick={提交归还}
                  disabled={提交中 || (!是App && !选中员工)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  {提交中 ? "提交中..." : "确认归还"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <BarcodeScanModal
        open={扫码弹窗打开}
        onClose={() => set扫码弹窗打开(false)}
        onScan={处理扫码}
      />
    </div>
  );
}
