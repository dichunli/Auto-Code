"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 考核记录 {
  id: string;
  task_id: string;
  task_name: string;
  item_name: string;
  item_score: number;
  item_score_type: string;
  check_date: string;
  status: string;
  score_record_id: string | null;
  media_urls: string[];
}

/* 给图片添加时间水印 */
async function addWatermark(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("无法创建画布"));
        return;
      }

      ctx.drawImage(img, 0, 0);

      const now = new Date();
      const timeText = now.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      ctx.font = `${Math.max(16, Math.floor(img.width / 30))}px sans-serif`;
      const metrics = ctx.measureText(timeText);
      const padding = Math.max(10, Math.floor(img.width / 60));
      const bgX = img.width - metrics.width - padding * 2;
      const bgY = img.height - Math.max(30, Math.floor(img.height / 20)) - padding;
      const bgW = metrics.width + padding * 2;
      const bgH = Math.max(30, Math.floor(img.height / 20)) + padding;

      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(bgX, bgY, bgW, bgH);

      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(timeText, bgX + padding, bgY + bgH / 2);

      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(new File([blob], file.name, { type: file.type }));
        } else {
          reject(new Error("水印处理失败"));
        }
      }, file.type);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };
    img.src = url;
  });
}

export default function BehaviorChecksPage() {
  const supabase = createClient();
  const [records, setRecords] = useState<考核记录[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setLoading(false);
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    const now = new Date();
    const weekday = now.getDay();
    const dayOfMonth = now.getDate();

    /* 1. 获取所有启用的考核任务 */
    const { data: taskData } = await supabase
      .from("behavior_check_tasks")
      .select("*")
      .eq("is_active", true);

    /* 2. 筛选今天应该执行的任务 */
    const todayTasks = (taskData || []).filter((t: { frequency: string; execute_weekday: number | null; execute_day: number | null; employee_ids: string[] | null }) => {
      if (t.frequency === "daily") return true;
      if (t.frequency === "weekly" && t.execute_weekday === weekday) return true;
      if (t.frequency === "monthly" && t.execute_day === dayOfMonth) return true;
      return false;
    }).filter((t: { employee_ids: string[] | null }) => {
      /* 检查当前用户是否在考核范围内 */
      if (!t.employee_ids || t.employee_ids.length === 0) return true;
      return t.employee_ids.includes(userData.user.id);
    });

    /* 3. 为今天应该执行但还没有记录的任务创建记录 */
    for (const task of todayTasks) {
      const { data: existing } = await supabase
        .from("behavior_check_records")
        .select("id")
        .eq("task_id", (task as { id: string }).id)
        .eq("employee_id", userData.user.id)
        .eq("check_date", today)
        .single();

      if (!existing) {
        await supabase.from("behavior_check_records").insert({
          task_id: (task as { id: string }).id,
          employee_id: userData.user.id,
          check_date: today,
          status: "pending",
        });
      }
    }

    /* 4. 获取今天的考核记录 */
    const { data } = await supabase
      .from("behavior_check_records")
      .select("*, behavior_check_tasks(name, item_id, behavior_score_items(name, score_value, score_type))")
      .eq("employee_id", userData.user.id)
      .eq("check_date", today)
      .order("created_at", { ascending: true });

    const mapped = (data || []).map((r: unknown) => {
      const rec = r as {
        id: string;
        task_id: string;
        check_date: string;
        status: string;
        score_record_id: string | null;
        behavior_check_tasks: {
          name: string;
          item_id: string;
          behavior_score_items: { name: string; score_value: number; score_type: string }[] | { name: string; score_value: number; score_type: string } | null;
        } | null;
      };
      const item = Array.isArray(rec.behavior_check_tasks?.behavior_score_items)
        ? rec.behavior_check_tasks?.behavior_score_items[0]
        : rec.behavior_check_tasks?.behavior_score_items;
      return {
        id: rec.id,
        task_id: rec.task_id,
        task_name: rec.behavior_check_tasks?.name || "",
        item_name: item?.name || "",
        item_score: item?.score_value || 0,
        item_score_type: item?.score_type || "bonus",
        check_date: rec.check_date,
        status: rec.status,
        score_record_id: rec.score_record_id,
        media_urls: [],
      };
    });

    setRecords(mapped);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const uploadPhoto = useCallback(async (file: File): Promise<string> => {
    const watermarked = await addWatermark(file);
    const fileName = `behavior-checks/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage.from("media").upload(fileName, watermarked);
    if (error) throw error;
    const { data: urlData } = supabase.storage.from("media").getPublicUrl(fileName);
    return urlData.publicUrl;
  }, [supabase]);

  async function handleComplete(recordId: string) {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert("请先拍照上传");
      return;
    }

    setSubmittingId(recordId);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const employeeId = userData.user?.id;
      if (!employeeId) throw new Error("未登录");

      const record = records.find((r) => r.id === recordId);
      if (!record) throw new Error("记录不存在");

      /* 上传照片 */
      const photoUrl = await uploadPhoto(file);

      /* 创建行为打分记录 */
      const finalScore = record.item_score_type === "penalty" ? -Math.abs(record.item_score) : Math.abs(record.item_score);
      const { data: scoreData, error: scoreError } = await supabase
        .from("behavior_score_records")
        .insert({
          employee_id: employeeId,
          item_id: record.task_id,
          score: finalScore,
          notes: `完成定时考核任务：${record.task_name}`,
          media_urls: [photoUrl],
        })
        .select("id")
        .single();

      if (scoreError) throw scoreError;

      /* 更新考核记录 */
      const { error: updateError } = await supabase
        .from("behavior_check_records")
        .update({
          status: "completed",
          score_record_id: scoreData.id,
        })
        .eq("id", recordId);

      if (updateError) throw updateError;

      alert("任务完成！已自动加分");
      fetchRecords();
    } catch (err: unknown) {
      alert("提交失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmittingId(null);
      setActiveRecordId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="今日考核" description="完成今日行为考核任务" />
        <div className="p-8 text-center text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="今日考核" description="完成今日行为考核任务，拍照上传即可自动加分" />

      {records.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">今天没有考核任务</p>
        </div>
      ) : (
        <div className="space-y-4">
          {records.map((r) => (
            <div
              key={r.id}
              className={`bg-white rounded-xl border p-5 ${
                r.status === "completed" ? "border-green-300" : "border-gray-200"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900">{r.task_name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      r.item_score_type === "bonus"
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-red-50 text-red-700 border border-red-200"
                    }`}
                  >
                    {r.item_score_type === "bonus" ? "+" : "-"}
                    {r.item_score}
                  </span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    r.status === "completed"
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-yellow-50 text-yellow-700 border border-yellow-200"
                  }`}
                >
                  {r.status === "completed" ? "已完成" : "待完成"}
                </span>
              </div>

              {r.status === "pending" ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">请拍照上传完成任务</p>
                  {activeRecordId === r.id ? (
                    <div className="space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setActiveRecordId(null);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                          className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => handleComplete(r.id)}
                          disabled={submittingId === r.id}
                          className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          {submittingId === r.id ? "提交中..." : "确认完成"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setActiveRecordId(r.id)}
                      className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      去拍照
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                    已完成加分
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
