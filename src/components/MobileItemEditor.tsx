"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ItemImageUploader from "./ItemImageUploader";

/* ==================== 类型定义 ==================== */

interface Profile {
  id: string;
  full_name: string;
}

interface ExistingMechanic {
  mechanic_id: string;
  share_pct?: number;
  profiles?: { full_name?: string } | null;
}

interface ConstructionLog {
  id: string;
  action: "start" | "pause" | "resume" | "complete";
  created_at: string;
  mechanic_id: string | null;
}

interface ItemData {
  id: string;
  name: string;
  alias_name?: string | null;
  item_type: string;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  description?: string | null;
  customer_opinion?: string | null;
  is_outsourced?: boolean | null;
  is_customer_part?: boolean | null;
  status?: string | null;
  mechanic_id?: string | null;
  submitter_id?: string | null;
  inspector_id?: string | null;
  service_item_id?: string | null;
  service_items?: { service_name_id?: string | null } | null;
}

interface Props {
  item: ItemData;
  orderId: string;
  orderStatus: string;
  profiles: Profile[];
  existingMechanics: ExistingMechanic[];
  images: string[];
  knowledgeUrl?: string;
  isLocked: boolean;
}

/* ==================== 工具函数 ==================== */

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function getConstructionStatus(logs: ConstructionLog[]): "idle" | "running" | "paused" | "completed" {
  if (logs.length === 0) return "idle";
  const last = logs[logs.length - 1];
  if (last.action === "complete") return "completed";
  if (last.action === "pause") return "paused";
  if (last.action === "start" || last.action === "resume") return "running";
  return "idle";
}

function calculateTotalSeconds(logs: ConstructionLog[], now: Date): number {
  let total = 0;
  let startTime: Date | null = null;
  for (const log of logs) {
    const t = new Date(log.created_at);
    if (log.action === "start" || log.action === "resume") {
      startTime = t;
    } else if (log.action === "pause" || log.action === "complete") {
      if (startTime) {
        total += (t.getTime() - startTime.getTime()) / 1000;
        startTime = null;
      }
    }
  }
  if (startTime) {
    total += (now.getTime() - startTime.getTime()) / 1000;
  }
  return Math.max(0, total);
}

/* ==================== 主组件 ==================== */

export default function MobileItemEditor({
  item,
  orderId,
  orderStatus,
  profiles,
  existingMechanics,
  images,
  knowledgeUrl,
  isLocked,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  /* 计时状态 */
  const [logs, setLogs] = useState<ConstructionLog[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  /* 施工人选择 */
  const [showMechanicSelect, setShowMechanicSelect] = useState(false);
  const [selectedMechanicId, setSelectedMechanicId] = useState<string>("");

  /* 备注 */
  const [notes, setNotes] = useState(item.description || "");

  /* 加载计时记录 */
  useEffect(() => {
    if (!open || item.item_type !== "labor") return;
    supabase
      .from("work_order_item_construction_logs")
      .select("id, action, created_at, mechanic_id")
      .eq("work_order_item_id", item.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const loaded = (data || []) as ConstructionLog[];
        setLogs(loaded);
        setElapsed(calculateTotalSeconds(loaded, new Date()));
      });
  }, [open, item.id, item.item_type, supabase]);

  /* 实时计时 */
  useEffect(() => {
    const status = getConstructionStatus(logs);
    if (status === "running") {
      timerRef.current = setInterval(() => {
        setElapsed(calculateTotalSeconds(logs, new Date()));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [logs]);

  /* 通用刷新 */
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  /* 更新客户意见 */
  async function updateOpinion(opinion: string) {
    if (loading) return;
    setLoading(true);
    const { error } = await supabase
      .from("work_order_items")
      .update({ customer_opinion: opinion })
      .eq("id", item.id);
    setLoading(false);
    if (error) {
      alert("更新失败: " + error.message);
      return;
    }
    refresh();
  }

  /* 更新标记 */
  async function toggleFlag(field: "is_outsourced" | "is_customer_part", value: boolean) {
    if (loading || isLocked) return;
    setLoading(true);

    const updateData: Record<string, boolean | number | null> = { [field]: value };

    /* 自带配件开关时同步更新价格 */
    if (field === "is_customer_part" && item.service_item_id) {
      const { data: si } = await supabase
        .from("service_items")
        .select("default_price, customer_parts_price")
        .eq("id", item.service_item_id)
        .single();
      if (si) {
        if (value && si.customer_parts_price != null) {
          updateData.unit_price = si.customer_parts_price;
        } else if (!value && si.default_price != null) {
          updateData.unit_price = si.default_price;
        }
      }
    }

    const { error } = await supabase.from("work_order_items").update(updateData).eq("id", item.id);
    setLoading(false);
    if (error) {
      alert("更新失败: " + error.message);
      return;
    }
    refresh();
  }

  /* 保存备注 */
  async function saveNotes() {
    if (loading) return;
    setLoading(true);
    const { error } = await supabase
      .from("work_order_items")
      .update({ description: notes.trim() || null })
      .eq("id", item.id);
    setLoading(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    refresh();
  }

  /* 指派施工人 */
  async function assignMechanic() {
    if (!selectedMechanicId || loading) return;
    setLoading(true);

    /* 先删旧记录 */
    await supabase.from("work_order_item_mechanics").delete().eq("work_order_item_id", item.id);

    /* 插入新记录 */
    const { error } = await supabase.from("work_order_item_mechanics").insert({
      work_order_item_id: item.id,
      mechanic_id: selectedMechanicId,
      share_pct: 100,
    });

    if (!error) {
      /* 同步更新主表 mechanic_id */
      await supabase.from("work_order_items").update({ mechanic_id: selectedMechanicId }).eq("id", item.id);
    }

    setLoading(false);
    setShowMechanicSelect(false);
    if (error) {
      alert("指派失败: " + error.message);
      return;
    }
    refresh();
  }

  /* 计时操作 */
  async function timerAction(action: "start" | "pause" | "resume" | "complete") {
    if (loading) return;
    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const mechanicId = userData.user?.id || null;

    const { error } = await supabase.from("work_order_item_construction_logs").insert({
      work_order_item_id: item.id,
      action,
      mechanic_id: mechanicId,
    });

    if (!error && action === "complete") {
      /* 完工时同步更新项目状态 */
      await supabase.from("work_order_items").update({ status: "completed" }).eq("id", item.id);
    }

    setLoading(false);
    if (error) {
      alert("操作失败: " + error.message);
      return;
    }

    /* 刷新日志 */
    const { data } = await supabase
      .from("work_order_item_construction_logs")
      .select("id, action, created_at, mechanic_id")
      .eq("work_order_item_id", item.id)
      .order("created_at", { ascending: true });
    const loaded = (data || []) as ConstructionLog[];
    setLogs(loaded);
    setElapsed(calculateTotalSeconds(loaded, new Date()));
    refresh();
  }

  /* ========== 渲染 ========== */

  const status = getConstructionStatus(logs);
  const mechanicNames = existingMechanics.map((m) => m.profiles?.full_name).filter(Boolean);
  const submitterName = profiles.find((p) => p.id === item.submitter_id)?.full_name;
  const inspectorName = profiles.find((p) => p.id === item.inspector_id)?.full_name;

  const opinionLabel =
    item.customer_opinion === "agree" ? "同意" :
    item.customer_opinion === "reject" ? "拒绝" : "待确认";
  const opinionColor =
    item.customer_opinion === "agree" ? "text-green-600 bg-green-50" :
    item.customer_opinion === "reject" ? "text-red-600 bg-red-50" : "text-gray-600 bg-gray-100";

  return (
    <>
      {/* 移动端项目卡片 */}
      <div
        className="md:hidden bg-white rounded-lg border border-gray-200 p-3 active:bg-gray-50 transition-colors cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{item.alias_name || item.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${opinionColor}`}>{opinionLabel}</span>
            {item.is_outsourced && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">外包</span>}
            {item.is_customer_part && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700">自带</span>}
            {item.item_type === "labor" && status === "running" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">施工中</span>
            )}
          </div>
          <span className="text-sm font-medium text-gray-900">
            ¥{item.total_price ?? (item.unit_price || 0) * (item.quantity || 1)}
          </span>
        </div>
        {mechanicNames.length > 0 && (
          <div className="text-xs text-gray-500 mt-1">施工人: {mechanicNames.join("、")}</div>
        )}
        {item.description && (
          <div className="text-xs text-gray-400 mt-1 line-clamp-1">备注: {item.description}</div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {open && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-end">
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />

          {/* 底部面板 */}
          <div className="relative bg-white rounded-t-2xl max-h-[85vh] flex flex-col animate-slide-up">
            {/* 头部 */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{item.alias_name || item.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {item.item_type === "labor" ? "工时" : item.item_type === "part" ? "配件" : "其他"} ·
                  ¥{item.unit_price || 0} × {item.quantity || 1}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
              >
                ✕
              </button>
            </div>

            {/* 可滚动内容 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
              {/* 施工人 */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">施工人</h4>
                {mechanicNames.length > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {mechanicNames.map((name, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700">{name}</span>
                    ))}
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => { setShowMechanicSelect(!showMechanicSelect); setSelectedMechanicId(""); }}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        更换
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">
                    {isLocked ? "未指派" : (
                      <button
                        type="button"
                        onClick={() => setShowMechanicSelect(true)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        + 指派施工人
                      </button>
                    )}
                  </div>
                )}

                {showMechanicSelect && !isLocked && (
                  <div className="mt-2 space-y-2">
                    <select
                      value={selectedMechanicId}
                      onChange={(e) => setSelectedMechanicId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="">选择施工人</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={assignMechanic}
                        disabled={!selectedMechanicId || loading}
                        className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
                      >
                        {loading ? "保存中..." : "确认"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMechanicSelect(false)}
                        className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* 提交人 / 质检人 */}
              {(submitterName || inspectorName) && (
                <section className="flex gap-4 text-xs text-gray-500">
                  {submitterName && <span>提交人: {submitterName}</span>}
                  {inspectorName && <span>质检人: {inspectorName}</span>}
                </section>
              )}

              {/* 计时（仅限工时项目） */}
              {item.item_type === "labor" && !isLocked && (
                <section>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">施工计时</h4>
                  <div className="flex items-center gap-3">
                    <div className="text-xl font-mono font-semibold text-gray-900">{formatDuration(elapsed)}</div>
                    <div className="flex gap-2">
                      {status === "idle" && (
                        <button
                          type="button"
                          onClick={() => timerAction("start")}
                          disabled={loading}
                          className="px-3 py-1.5 text-xs text-white bg-green-600 rounded-lg disabled:opacity-50"
                        >
                          开始
                        </button>
                      )}
                      {status === "running" && (
                        <>
                          <button
                            type="button"
                            onClick={() => timerAction("pause")}
                            disabled={loading}
                            className="px-3 py-1.5 text-xs text-white bg-amber-500 rounded-lg disabled:opacity-50"
                          >
                            暂停
                          </button>
                          <button
                            type="button"
                            onClick={() => timerAction("complete")}
                            disabled={loading}
                            className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
                          >
                            完工
                          </button>
                        </>
                      )}
                      {status === "paused" && (
                        <>
                          <button
                            type="button"
                            onClick={() => timerAction("resume")}
                            disabled={loading}
                            className="px-3 py-1.5 text-xs text-white bg-green-600 rounded-lg disabled:opacity-50"
                          >
                            继续
                          </button>
                          <button
                            type="button"
                            onClick={() => timerAction("complete")}
                            disabled={loading}
                            className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
                          >
                            完工
                          </button>
                        </>
                      )}
                      {status === "completed" && (
                        <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500">已完工</span>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* 客户意见 */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">客户意见</h4>
                <div className="flex gap-2">
                  {(["agree", "pending", "reject"] as const).map((op) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => updateOpinion(op)}
                      disabled={loading || isLocked}
                      className={`flex-1 py-2 text-xs rounded-lg border font-medium disabled:opacity-50 ${
                        item.customer_opinion === op
                          ? op === "agree" ? "bg-green-600 text-white border-green-600" :
                            op === "reject" ? "bg-red-600 text-white border-red-600" :
                            "bg-gray-600 text-white border-gray-600"
                          : "bg-white text-gray-600 border-gray-200"
                      }`}
                    >
                      {op === "agree" ? "同意" : op === "reject" ? "拒绝" : "待确认"}
                    </button>
                  ))}
                </div>
              </section>

              {/* 标记 */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">项目标记</h4>
                <div className="space-y-2">
                  <label className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-600">外包项目</span>
                    <input
                      type="checkbox"
                      checked={!!item.is_outsourced}
                      onChange={(e) => toggleFlag("is_outsourced", e.target.checked)}
                      disabled={loading || isLocked}
                      className="w-5 h-5 accent-blue-600 disabled:opacity-50"
                    />
                  </label>
                  <label className="flex items-center justify-between py-2">
                    <span className="text-sm text-gray-600">自带配件</span>
                    <input
                      type="checkbox"
                      checked={!!item.is_customer_part}
                      onChange={(e) => toggleFlag("is_customer_part", e.target.checked)}
                      disabled={loading || isLocked}
                      className="w-5 h-5 accent-blue-600 disabled:opacity-50"
                    />
                  </label>
                </div>
              </section>

              {/* 项目备注 */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">项目备注</h4>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isLocked}
                  rows={2}
                  placeholder="添加备注..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50"
                />
                {notes !== (item.description || "") && !isLocked && (
                  <button
                    type="button"
                    onClick={saveNotes}
                    disabled={loading}
                    className="mt-2 px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
                  >
                    {loading ? "保存中..." : "保存备注"}
                  </button>
                )}
              </section>

              {/* 项目图片 */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">项目图片</h4>
                <ItemImageUploader
                  itemId={item.id}
                  existingImages={images}
                  isLocked={isLocked}
                />
              </section>

              {/* 维修指导 */}
              {knowledgeUrl && (
                <section>
                  <a
                    href={knowledgeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2.5 border border-blue-300 rounded-lg text-sm text-blue-600 bg-blue-50 hover:bg-blue-100"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    查看维修指导
                  </a>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
