"use client";

import { useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 本地今日字符串, 过滤今日任务, 计算时段状态, 时段状态展示 } from "@/lib/behaviorCheck";
import CheckCompleteModal from "./CheckCompleteModal";
import CheckCommentThread from "./CheckCommentThread";

export interface 细节视图 {
  id: string;
  name: string;
  description: string | null;
  guide_images: string[];
  score_value: number;
}

/* 细节打分结果快照（completed 记录上展示用） */
export interface 细节结果 {
  detail_id: string;
  name: string;
  full_score: number;
  given: number;
  photos: string[];
  note: string | null;
}

export interface 考核记录视图 {
  id: string;
  task_id: string;
  item_id: string;
  checker_id: string | null;
  employee_id: string;
  check_date: string;
  status: string;
  score_record_id: string | null;
  detail_results: 细节结果[];
  task_name: string;
  execute_time: string;
  end_time: string;
  item_name: string;
  item_score: number;
  item_score_type: string;
  item_description: string | null;
  responsible_name: string;
  checker_name: string;
  employee_name: string;
  details: 细节视图[];
  comment_count: number;
}

interface 嵌套项目 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
  description: string | null;
  responsible_id: string | null;
  checker_id: string | null;
  responsible: { full_name: string }[] | { full_name: string } | null;
  checker: { full_name: string }[] | { full_name: string } | null;
}

interface 嵌套任务 {
  id: string;
  name: string;
  item_id: string;
  frequency: string;
  execute_time: string;
  end_time: string;
  execute_weekday: number | null;
  execute_day: number | null;
  employee_ids: string[] | null;
  behavior_score_items: 嵌套项目[] | 嵌套项目 | null;
}

function 取单<T>(v: T[] | T | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

export default function BehaviorChecksContent({ initialRecords, currentUserId }: { initialRecords: 考核记录视图[]; currentUserId: string }) {
  const supabase = useMemo(() => createClient(), []);
  /* 首屏数据由服务端传入；loading 仅用于提交后的客户端重查 */
  const [records, setRecords] = useState<考核记录视图[]>(initialRecords);
  const [loading, setLoading] = useState(false);
  const [completingRecord, setCompletingRecord] = useState<考核记录视图 | null>(null);
  /* 展开"检查标准"明细的记录 id 集合 */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /* 提交后重查：与服务端 page.tsx 同一套懒生成 + 可见性逻辑（纯函数共用） */
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setLoading(false);
      return;
    }
    const uid = userData.user.id;
    const today = 本地今日字符串();

    const { data: taskData } = await supabase
      .from("behavior_check_tasks")
      .select("*, behavior_score_items(id, name, score_type, score_value, description, responsible_id, checker_id, responsible:profiles!behavior_score_items_responsible_id_fkey(full_name), checker:profiles!behavior_score_items_checker_id_fkey(full_name))")
      .eq("is_active", true);

    const todayTasks = 过滤今日任务((taskData || []) as 嵌套任务[]);

    for (const task of todayTasks) {
      const item = 取单(task.behavior_score_items);
      let 被考核人: string;
      let 应检查人: string;
      if (item?.responsible_id) {
        被考核人 = item.responsible_id;
        应检查人 = item.checker_id || item.responsible_id;
        if (uid !== 应检查人) continue;
      } else {
        if (task.employee_ids && task.employee_ids.length > 0 && !task.employee_ids.includes(uid)) continue;
        被考核人 = uid;
        应检查人 = uid;
      }
      const { data: existing } = await supabase
        .from("behavior_check_records")
        .select("id")
        .eq("task_id", task.id)
        .eq("employee_id", 被考核人)
        .eq("check_date", today)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabase.from("behavior_check_records").insert({
          task_id: task.id,
          employee_id: 被考核人,
          checker_id: 应检查人,
          check_date: today,
          status: "pending",
        });
        if (error && error.code !== "23505") {
          console.error("生成今日考核记录失败:", error.message);
        }
      }
    }

    const { data } = await supabase
      .from("behavior_check_records")
      .select("*, employee:profiles!behavior_check_records_employee_id_fkey(full_name), behavior_check_tasks(name, execute_time, end_time, item_id, behavior_score_items(id, name, score_type, score_value, description, responsible_id, checker_id, responsible:profiles!behavior_score_items_responsible_id_fkey(full_name), checker:profiles!behavior_score_items_checker_id_fkey(full_name)))")
      .eq("check_date", today)
      .or(`checker_id.eq.${uid},employee_id.eq.${uid}`)
      .order("created_at", { ascending: true });

    const 记录列表 = data || [];
    const itemIds = [...new Set(记录列表.map((r) => 取单((r as { behavior_check_tasks: 嵌套任务 | null }).behavior_check_tasks)?.item_id).filter(Boolean))] as string[];
    const recordIds = 记录列表.map((r) => r.id);

    const [细节结果, 评论结果] = await Promise.all([
      itemIds.length > 0
        ? supabase.from("behavior_item_details").select("*").in("item_id", itemIds).order("sort_order", { ascending: true }).order("created_at", { ascending: true })
        : Promise.resolve({ data: [] }),
      recordIds.length > 0
        ? supabase.from("behavior_check_comments").select("check_record_id").in("check_record_id", recordIds)
        : Promise.resolve({ data: [] }),
    ]);

    const 细节按项目 = new Map<string, 细节视图[]>();
    for (const d of 细节结果.data || []) {
      const list = 细节按项目.get(d.item_id) || [];
      list.push({ id: d.id, name: d.name, description: d.description, guide_images: d.guide_images || [], score_value: d.score_value });
      细节按项目.set(d.item_id, list);
    }
    const 评论数 = new Map<string, number>();
    for (const c of 评论结果.data || []) {
      评论数.set(c.check_record_id, (评论数.get(c.check_record_id) || 0) + 1);
    }

    const mapped: 考核记录视图[] = 记录列表.map((r) => {
      const task = 取单((r as { behavior_check_tasks: 嵌套任务 | null }).behavior_check_tasks);
      const item = 取单(task?.behavior_score_items);
      const responsible = 取单(item?.responsible);
      const checker = 取单(item?.checker);
      const employee = 取单((r as { employee: { full_name: string }[] | { full_name: string } | null }).employee);
      return {
        id: r.id,
        task_id: r.task_id,
        item_id: task?.item_id || "",
        checker_id: r.checker_id,
        employee_id: r.employee_id,
        check_date: r.check_date,
        status: r.status,
        score_record_id: r.score_record_id,
        detail_results: (r.detail_results as 细节结果[]) || [],
        task_name: task?.name || "",
        execute_time: task?.execute_time || "00:00",
        end_time: task?.end_time || "23:59",
        item_name: item?.name || "",
        item_score: item?.score_value || 0,
        item_score_type: item?.score_type || "bonus",
        item_description: item?.description || null,
        responsible_name: responsible?.full_name || employee?.full_name || "",
        checker_name: checker?.full_name || "",
        employee_name: employee?.full_name || "",
        details: 细节按项目.get(task?.item_id || "") || [],
        comment_count: 评论数.get(r.id) || 0,
      };
    });

    setRecords(mapped);
    setLoading(false);
  }, [supabase]);

  /* 分两组：待我检查（我是检查人）/ 考核我的（我是被考核人但不由我检查） */
  const 待我检查 = records.filter((r) => r.checker_id === currentUserId || (!r.checker_id && r.employee_id === currentUserId));
  const 考核我的 = records.filter((r) => r.employee_id === currentUserId && r.checker_id && r.checker_id !== currentUserId);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderCard(r: 考核记录视图, 可操作: boolean) {
    const 状态 = 计算时段状态(r.execute_time, r.end_time, r.status);
    const 展示 = 时段状态展示[状态];
    const 展开 = expandedIds.has(r.id);
    const 完成合计 = r.detail_results.reduce((s, d) => s + d.given, 0);

    return (
      <div key={r.id} className={`bg-white rounded-xl border p-5 ${状态 === "completed" ? "border-green-300" : 状态 === "closed" ? "border-red-200" : "border-gray-200"}`}>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{r.item_name || r.task_name}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${r.item_score_type === "bonus" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              {r.item_score_type === "bonus" ? "加分项" : "扣分项"}
              {r.details.length === 0 && ` ${r.item_score_type === "bonus" ? "+" : "-"}${r.item_score}`}
            </span>
            {r.details.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                {r.details.length} 条检查细节
              </span>
            )}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded ${展示.样式}`}>
            {展示.文案(r.execute_time.slice(0, 5), r.end_time.slice(0, 5))}
          </span>
        </div>

        <p className="text-xs text-gray-500 mb-2">
          {r.task_name} · 时段 {r.execute_time.slice(0, 5)} ~ {r.end_time.slice(0, 5)}
          {" · 责任人："}{r.responsible_name || r.employee_name}
          {" · 检查人："}{r.checker_name || "自检"}
        </p>

        {/* 检查标准（细节图文说明，可展开） */}
        {r.details.length > 0 && (
          <div className="mb-2">
            <button onClick={() => toggleExpanded(r.id)} className="text-xs text-blue-600 hover:text-blue-700">
              {展开 ? "收起检查标准 ▲" : "查看检查标准 ▼"}
            </button>
            {展开 && (
              <div className="mt-2 space-y-2 bg-gray-50 rounded-lg p-3">
                {r.details.map((d, i) => (
                  <div key={d.id} className="text-sm">
                    <span className="text-gray-700 font-medium">#{i + 1} {d.name}</span>
                    <span className="text-xs text-gray-400 ml-2">满分 {d.score_value}</span>
                    {d.description && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{d.description}</p>}
                    {d.guide_images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-1">
                        {d.guide_images.map((src, j) => (
                          <img key={j} src={src} alt="标准" loading="lazy" className="w-14 h-14 object-cover rounded border border-gray-200" />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 无细节项目的整体说明 */}
        {r.details.length === 0 && r.item_description && (
          <p className="text-xs text-gray-500 mb-2 whitespace-pre-wrap">{r.item_description}</p>
        )}

        {/* 已完成：展示逐条打分结果 */}
        {r.status === "completed" && r.detail_results.length > 0 && (
          <div className="mb-2 bg-green-50 rounded-lg p-3 space-y-1">
            {r.detail_results.map((d) => (
              <div key={d.detail_id} className="text-xs text-gray-700 flex items-center gap-2 flex-wrap">
                <span>{d.name}</span>
                <span className={d.given > 0 ? (r.item_score_type === "penalty" ? "text-red-600" : "text-green-600") : "text-gray-400"}>
                  {r.item_score_type === "penalty" ? `扣 ${d.given}` : `得 ${d.given}`} / {d.full_score}
                </span>
                {d.photos.length > 0 && <span className="text-gray-400">📷{d.photos.length}</span>}
                {d.note && <span className="text-gray-500">— {d.note}</span>}
              </div>
            ))}
            <div className={`text-xs font-semibold pt-1 ${r.item_score_type === "penalty" ? "text-red-600" : "text-green-600"}`}>
              合计：{r.item_score_type === "penalty" ? "-" : "+"}{完成合计} 分
            </div>
          </div>
        )}

        {/* 操作区 */}
        {可操作 && r.status === "pending" && (
          <div className="mt-2">
            {状态 === "closed" ? (
              <span className="text-xs text-gray-400">已超过检查时间段，无法提交</span>
            ) : (
              <button
                onClick={() => setCompletingRecord(r)}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                去检查
                {状态 === "not_started" && <span className="ml-1 text-xs opacity-75">（未到时间可提前）</span>}
              </button>
            )}
          </div>
        )}

        <CheckCommentThread checkRecordId={r.id} initialCount={r.comment_count} />
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="今日考核" description="在检查时间段内完成检查，超时自动关闭" />
        <div className="p-8 text-center text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="今日考核" description="在检查时间段内完成检查，超时自动关闭（漏检不扣分）" />

      {records.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">今天没有考核任务</p>
        </div>
      ) : (
        <>
          {待我检查.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">待我检查（{待我检查.length}）</h2>
              {待我检查.map((r) => renderCard(r, true))}
            </div>
          )}
          {考核我的.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">考核我的（{考核我的.length}）</h2>
              {考核我的.map((r) => renderCard(r, false))}
            </div>
          )}
        </>
      )}

      {completingRecord && (
        <CheckCompleteModal
          record={completingRecord}
          onClose={() => setCompletingRecord(null)}
          onCompleted={fetchRecords}
        />
      )}
    </div>
  );
}
