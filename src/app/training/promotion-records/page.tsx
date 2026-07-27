"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";

interface 晋级记录 {
  id: string;
  employee_id: string;
  employee_name: string;
  type: string;
  from_level_name: string;
  to_level_name: string;
  to_level_id: string | null;
  reason: string;
  course_points: number;
  work_order_count: number;
  rework_loss_total: number;
  daily_loss_total: number;
  behavior_score_total: number;
  status: string;
  created_at: string;
}

export default function PromotionRecordsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [records, setRecords] = useState<晋级记录[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function fetchData() {
    setLoading(true);
    const { data } = await supabase
      .from("promotion_records")
      .select("id, employee_id, type, reason, course_points, work_order_count, rework_loss_total, daily_loss_total, behavior_score_total, status, created_at, to_level_id, profiles!promotion_records_employee_id_fkey(full_name), from_level:mechanic_levels!promotion_records_from_level_id_fkey(name), to_level:mechanic_levels!promotion_records_to_level_id_fkey(name)")
      .order("created_at", { ascending: false })
      .limit(50);

    setRecords(
      (data || []).map((r: unknown) => {
        const rec = r as {
          id: string;
          employee_id: string;
          type: string;
          reason: string;
          course_points: number;
          work_order_count: number;
          rework_loss_total: number;
          daily_loss_total: number;
          behavior_score_total: number;
          status: string;
          created_at: string;
          to_level_id: string | null;
          profiles: { full_name: string }[] | { full_name: string } | null;
          from_level: { name: string }[] | { name: string } | null;
          to_level: { name: string }[] | { name: string } | null;
        };
        const profile = Array.isArray(rec.profiles) ? rec.profiles[0] : rec.profiles;
        const fromLv = Array.isArray(rec.from_level) ? rec.from_level[0] : rec.from_level;
        const toLv = Array.isArray(rec.to_level) ? rec.to_level[0] : rec.to_level;
        return {
          id: rec.id,
          employee_id: rec.employee_id,
          employee_name: profile?.full_name || "",
          type: rec.type,
          from_level_name: fromLv?.name || "无等级",
          to_level_name: toLv?.name || "",
          to_level_id: rec.to_level_id,
          reason: rec.reason,
          course_points: rec.course_points,
          work_order_count: rec.work_order_count,
          rework_loss_total: rec.rework_loss_total,
          daily_loss_total: rec.daily_loss_total,
          behavior_score_total: rec.behavior_score_total,
          status: rec.status,
          created_at: rec.created_at,
        };
      })
    );
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, [supabase]);

  async function handleApprove(record: 晋级记录) {
    if (!record.to_level_id) {
      alert("目标等级不存在");
      return;
    }
    if (!(await 请求确认("确定批准该晋级申请吗？批准后员工等级将更新。"))) return;

    setProcessingId(record.id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const approverId = userData.user?.id;

      /* 更新申请状态 */
      const { error: updateError } = await supabase
        .from("promotion_records")
        .update({
          status: "approved",
          approved_by: approverId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", record.id);

      if (updateError) throw updateError;

      /* 更新员工等级 */
      const { error: empError } = await supabase
        .from("profiles")
        .update({ mechanic_level_id: record.to_level_id })
        .eq("id", record.employee_id);

      if (empError) throw empError;

      alert("已批准");
      fetchData();
    } catch (err: unknown) {
      alert("操作失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(record: 晋级记录) {
    const reason = prompt("请输入拒绝原因：");
    if (!reason) return;

    setProcessingId(record.id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const approverId = userData.user?.id;

      const { error } = await supabase
        .from("promotion_records")
        .update({
          status: "rejected",
          approved_by: approverId,
          approved_at: new Date().toISOString(),
          reason: reason,
        })
        .eq("id", record.id);

      if (error) throw error;
      alert("已拒绝");
      fetchData();
    } catch (err: unknown) {
      alert("操作失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div>
      <PageHeader title="晋级审核" description="审核员工晋级/降级申请" />

      {loading ? (
        <div className="p-8 text-center text-gray-400">加载中...</div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">暂无晋级/降级记录</p>
        </div>
      ) : (
        <div className="space-y-4">
          {records.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{r.employee_name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                    {r.type === "promotion" ? "晋级" : "降级"}
                  </span>
                  <span className="text-gray-400">{r.from_level_name} → {r.to_level_name}</span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded border ${
                    r.status === "approved"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : r.status === "rejected"
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-yellow-50 text-yellow-700 border-yellow-200"
                  }`}
                >
                  {r.status === "approved" ? "已批准" : r.status === "rejected" ? "已拒绝" : "待审核"}
                </span>
              </div>

              <p className="text-sm text-gray-600 mb-3">{r.reason}</p>

              <div className="grid grid-cols-5 gap-2 text-xs mb-3">
                <div className="bg-gray-50 rounded p-2 text-center">
                  <div className="text-gray-500">课程积分</div>
                  <div className="font-medium">{r.course_points}</div>
                </div>
                <div className="bg-gray-50 rounded p-2 text-center">
                  <div className="text-gray-500">工单数</div>
                  <div className="font-medium">{r.work_order_count}</div>
                </div>
                <div className="bg-gray-50 rounded p-2 text-center">
                  <div className="text-gray-500">行为分数</div>
                  <div className="font-medium">{r.behavior_score_total}</div>
                </div>
                <div className="bg-gray-50 rounded p-2 text-center">
                  <div className="text-gray-500">返工损失</div>
                  <div className="font-medium text-red-600">¥{r.rework_loss_total.toFixed(2)}</div>
                </div>
                <div className="bg-gray-50 rounded p-2 text-center">
                  <div className="text-gray-500">日常损失</div>
                  <div className="font-medium text-red-600">¥{r.daily_loss_total.toFixed(2)}</div>
                </div>
              </div>

              <div className="text-xs text-gray-400">
                申请时间: {new Date(r.created_at).toLocaleDateString("zh-CN")}
              </div>

              {r.status === "pending" && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleApprove(r)}
                    disabled={processingId === r.id}
                    className="px-3 py-1.5 text-xs text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    批准
                  </button>
                  <button
                    onClick={() => handleReject(r)}
                    disabled={processingId === r.id}
                    className="px-3 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100 border border-red-200 disabled:opacity-50"
                  >
                    拒绝
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {确认弹窗}
    </div>
  );
}
