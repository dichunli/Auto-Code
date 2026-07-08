"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import BarcodeScanModal from "@/components/BarcodeScanModal";
import { ImageUploader } from "@/components/ImageUploader";

interface 工具 {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
  instructions: string | null;
  knowledge_article_id: string | null;
  location: string | null;
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
  const [成功提示, set成功提示] = useState("");

  /* 归还验收：仓位扫码 */
  const [仓位扫码弹窗, set仓位扫码弹窗] = useState(false);
  const [已扫仓位, set已扫仓位] = useState("");
  const [仓位倒计时, set仓位倒计时] = useState(0);
  const 仓位计时器 = useRef<ReturnType<typeof setInterval> | null>(null);

  /* 归还验收：拍照 */
  const [归还照片, set归还照片] = useState<string[]>([]);

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
          .order("borrowed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const rec = recordData as 借用记录;
        if (rec && rec.returned_at === null) {
          set未归还记录(rec);
        } else {
          set未归还记录(null);
        }

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

  /* 开始仓位扫码倒计时 */
  function 开始仓位扫码() {
    set仓位倒计时(10);
    set仓位扫码弹窗(true);
    if (仓位计时器.current) clearInterval(仓位计时器.current);
    仓位计时器.current = setInterval(() => {
      set仓位倒计时((prev) => {
        if (prev <= 1) {
          if (仓位计时器.current) clearInterval(仓位计时器.current);
          set仓位扫码弹窗(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function 处理仓位扫码(code: string) {
    const trimmed = code.trim();
    if (!trimmed.startsWith("location:")) {
      alert("未识别为仓位二维码，请扫描存放位置标签");
      return;
    }
    const loc = trimmed.slice(9);
    if (!loc) {
      alert("仓位二维码内容无效");
      return;
    }
    /* 校验扫描的仓位与工具的存放位置是否一致 */
    if (工具.location && loc !== 工具.location) {
      alert(`仓位不匹配！\n扫描位置：${loc}\n工具存放位置：${工具.location}\n请扫描正确的仓位码`);
      return;
    }
    if (仓位计时器.current) clearInterval(仓位计时器.current);
    set仓位倒计时(0);
    set仓位扫码弹窗(false);
    set已扫仓位(loc);
  }

  async function 提交归还() {
    if (!工具 || !未归还记录) return;
    const operatorId = 是App ? 当前用户ID : 选中员工;
    if (!operatorId) {
      alert("请选择归还人");
      return;
    }
    /* 需要仓位扫码 */
    if (工具.require_location_scan && !已扫仓位) {
      alert("请先扫描存放位置二维码（10秒内完成）");
      return;
    }
    /* 需要拍照 */
    if (工具.require_return_photos && 归还照片.length === 0) {
      alert("请先拍摄归还验收照片");
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
            ? `${未归还记录.notes}\n归还备注：${备注.trim() || "无"}\n仓位扫码：${已扫仓位 || "未要求"}`
            : `归还备注：${备注.trim() || "无"}\n仓位扫码：${已扫仓位 || "未要求"}`,
        })
        .eq("id", 未归还记录.id);
      if (updateRecordError) throw updateRecordError;

      /* 保存归还照片 */
      if (归还照片.length > 0) {
        const photos = 归还照片.map((url) => ({
          borrow_record_id: 未归还记录.id,
          tool_id: 工具.id,
          photo_url: url,
        }));
        const { error: photoError } = await supabase.from("tool_return_photos").insert(photos);
        if (photoError) console.warn("归还照片保存失败:", photoError.message);
      }

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
          {(工具.image_url ? 工具.image_url.split(",").filter(Boolean)[0] : "") ? (
            <img
              src={工具.image_url!.split(",").filter(Boolean)[0]}
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

        {/* 需要手机操作的归还，桌面端禁止 */}
        {是归还 && (工具.require_location_scan || 工具.require_return_photos) && !是App ? (
          <div className="text-center py-6 space-y-2">
            <div className="text-amber-600 font-medium">该工具被设置为扫码/拍照归还</div>
            <div className="text-sm text-gray-500">请在手机端 APP 中操作归还</div>
            <button
              type="button"
              onClick={() => router.push("/tools/management")}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              返回工具列表
            </button>
          </div>
        ) : 不可操作 ? (
          <div className="text-center py-6 text-gray-500">该工具已报废，不可借用或归还</div>
        ) : (
          <>
            {/* 归还验收区域 */}
            {是归还 && (工具.require_location_scan || 工具.require_return_photos) && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium text-blue-800">归还验收</p>

                {/* 仓位扫码 */}
                {工具.require_location_scan && (
                  <div>
                    {已扫仓位 ? (
                      <div className="flex items-center gap-2 text-sm text-green-700">
                        <span>已扫仓位：{已扫仓位}</span>
                      </div>
                    ) : (
                      <>
                        {仓位倒计时 > 0 && (
                          <div className="text-sm text-amber-600 mb-2">
                            请在 {仓位倒计时} 秒内扫描存放位置二维码
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={开始仓位扫码}
                          className="px-4 py-2 text-sm font-medium text-blue-600 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
                        >
                          扫描存放位置二维码
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* 拍照验收 */}
                {工具.require_return_photos && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">请拍摄工具归还时的照片（确认齐全及摆放规范）</p>
                    <ImageUploader
                      onUpload={(paths) => set归还照片(paths)}
                      onDelete={(path) => set归还照片((prev) => prev.filter((p) => p !== path))}
                      existingImages={归还照片}
                      maxImages={5}
                      folder="tools"
                      cameraOnly
                    />
                  </div>
                )}
              </div>
            )}

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
                  disabled={
                    提交中 ||
                    (!是App && !选中员工) ||
                    (工具.require_location_scan && !已扫仓位) ||
                    (工具.require_return_photos && 归还照片.length === 0)
                  }
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
        open={仓位扫码弹窗}
        onClose={() => {
          set仓位扫码弹窗(false);
          if (仓位计时器.current) clearInterval(仓位计时器.current);
          set仓位倒计时(0);
        }}
        onScan={处理仓位扫码}
      />

      {/* 仓位扫码倒计时浮层 */}
      {仓位倒计时 > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 bg-red-600 text-white rounded-full text-lg font-bold shadow-lg animate-pulse">
          请在 {仓位倒计时} 秒内扫描仓位码
        </div>
      )}
    </div>
  );
}
