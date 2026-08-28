"use client";

import { useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 本地今日字符串, 计算时段状态, 时段状态展示 } from "@/lib/behaviorCheck";
import { 懒生成今日考核记录 } from "./actions";
import CheckCompleteModal from "./CheckCompleteModal";
import SelfReportModal from "./SelfReportModal";
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
  checker_ids: string[];
  employee_id: string;
  check_date: string;
  status: string;
  score_record_id: string | null;
  review_score_record_id: string | null;
  detail_results: 细节结果[];
  self_report_photos: string[];
  self_report_note: string | null;
  self_reported_at: string | null;
  task_name: string;
  execute_time: string;
  end_time: string;
  item_name: string;
  item_score: number;
  item_score_type: string;
  item_description: string | null;
  item_guide_images: string[];
  checker_names: string;
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
  responsible_ids: string[] | null;
  checker_ids: string[] | null;
  guide_images: string[] | null;
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

export default function BehaviorChecksContent({ initialRecords, initialCount, currentUserId }: { initialRecords: 考核记录视图[]; initialCount: number; currentUserId: string }) {
  const supabase = useMemo(() => createClient(), []);
  /* 首屏数据由服务端传入；loading 用于提交后重查和翻页 */
  const [records, setRecords] = useState<考核记录视图[]>(initialRecords);
  /* 分页状态：首屏数据由服务端给（第 1 页），提交后重查/翻页走 fetchRecords */
  const [total, setTotal] = useState(initialCount);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [loading, setLoading] = useState(false);
  const [completingRecord, setCompletingRecord] = useState<考核记录视图 | null>(null);
  const [自检记录, set自检记录] = useState<考核记录视图 | null>(null);
  /* 展开"检查标准"明细的记录 id 集合 */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /* 提交后重查/翻页：与服务端 page.tsx 同一套懒生成 + 可见性逻辑（纯函数共用） */
  const fetchRecords = useCallback(async (目标页: number) => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setLoading(false);
      return;
    }
    const uid = userData.user.id;
    const today = 本地今日字符串();

    /* 懒生成今日考核记录走 Server Action（先查后插、忽略唯一冲突，逻辑与服务端渲染一致），
     * 不再由客户端逐条直写 */
    await 懒生成今日考核记录();

    const from = (目标页 - 1) * pageSize;
    const { data, count } = await supabase
      .from("behavior_check_records")
      .select("*, employee:profiles!behavior_check_records_employee_id_fkey(full_name), behavior_check_tasks(name, execute_time, end_time, item_id, behavior_score_items(id, name, score_type, score_value, description, responsible_ids, checker_ids, guide_images))", { count: "exact" })
      .eq("check_date", today)
      .or(`checker_ids.cs.["${uid}"],employee_id.eq.${uid}`)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    const 记录列表 = data || [];
    const itemIds = [...new Set(记录列表.map((r) => 取单((r as { behavior_check_tasks: 嵌套任务 | null }).behavior_check_tasks)?.item_id).filter(Boolean))] as string[];
    const recordIds = 记录列表.map((r) => r.id);

    const [细节结果, 评论结果, 员工结果] = await Promise.all([
      itemIds.length > 0
        ? supabase.from("behavior_item_details").select("*").in("item_id", itemIds).order("sort_order", { ascending: true }).order("created_at", { ascending: true })
        : Promise.resolve({ data: [] }),
      recordIds.length > 0
        ? supabase.from("behavior_check_comments").select("check_record_id").in("check_record_id", recordIds)
        : Promise.resolve({ data: [] }),
      supabase.from("profiles").select("id, full_name"),
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
    const 姓名表 = new Map((员工结果.data || []).map((e: { id: string; full_name: string }) => [e.id, e.full_name]));

    const mapped: 考核记录视图[] = 记录列表.map((r) => {
      const task = 取单((r as { behavior_check_tasks: 嵌套任务 | null }).behavior_check_tasks);
      const item = 取单(task?.behavior_score_items);
      const employee = 取单((r as { employee: { full_name: string }[] | { full_name: string } | null }).employee);
      const checker_ids = (r.checker_ids as string[] | null) || [];
      return {
        id: r.id,
        task_id: r.task_id,
        item_id: task?.item_id || "",
        checker_ids,
        employee_id: r.employee_id,
        check_date: r.check_date,
        status: r.status,
        score_record_id: r.score_record_id,
        review_score_record_id: r.review_score_record_id,
        detail_results: (r.detail_results as 细节结果[]) || [],
        self_report_photos: (r.self_report_photos as string[] | null) || [],
        self_report_note: r.self_report_note,
        self_reported_at: r.self_reported_at,
        task_name: task?.name || "",
        execute_time: task?.execute_time || "00:00",
        end_time: task?.end_time || "23:59",
        item_name: item?.name || "",
        item_score: item?.score_value || 0,
        item_score_type: item?.score_type || "bonus",
        item_description: item?.description || null,
        item_guide_images: (item?.guide_images as string[] | null) || [],
        checker_names: checker_ids.map((id) => 姓名表.get(id) || "?").join("、"),
        employee_name: employee?.full_name || "",
        details: 细节按项目.get(task?.item_id || "") || [],
        comment_count: 评论数.get(r.id) || 0,
      };
    });

    setRecords(mapped);
    setTotal(count || 0);
    setPage(目标页);
    setLoading(false);
  }, [supabase, pageSize]);

  /* 三个分组：
   * 待我自检 —— 我是责任人，由别人检查我，还没自检上报（两阶段流程第一步）
   * 待我检查 —— 我是检查人（含自检模式的自己）；已完成的也留在这里展示
   * 考核我的 —— 我是责任人的其余记录（待核查/已完成），只读+评论 */
  const 待我自检 = records.filter(
    (r) => r.employee_id === currentUserId && r.status === "pending" && r.checker_ids.length > 0 && !r.checker_ids.includes(currentUserId)
  );
  const 待我检查 = records.filter(
    (r) => r.checker_ids.includes(currentUserId) || (r.checker_ids.length === 0 && r.employee_id === currentUserId)
  );
  const 待我自检id集 = new Set(待我自检.map((r) => r.id));
  const 待我检查id集 = new Set(待我检查.map((r) => r.id));
  const 考核我的 = records.filter((r) => r.employee_id === currentUserId && !待我自检id集.has(r.id) && !待我检查id集.has(r.id));

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* 阶段徽章：两阶段流程里的自检/核查状态 */
  function 阶段徽章(r: 考核记录视图) {
    if (r.checker_ids.length === 0) return null; /* 旧数据自检语义，不显示 */
    if (r.status === "self_reported") {
      return <span className="text-xs px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200">已自检·分已计待核查</span>;
    }
    if (r.status === "pending") {
      if (r.checker_ids.includes(currentUserId) && r.employee_id !== currentUserId) {
        return <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">责任人未自检</span>;
      }
      if (r.employee_id === currentUserId && !r.checker_ids.includes(currentUserId)) {
        return <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">待自检上报</span>;
      }
    }
    return null;
  }

  function renderCard(r: 考核记录视图, 分组: "自检" | "检查" | "被考核") {
    /* 传真实状态：self_reported 恒为"已自检待核查"，超时也不算漏检 */
    const 状态 = 计算时段状态(r.execute_time, r.end_time, r.status);
    const 展示 = 时段状态展示[状态];
    const 展开 = expandedIds.has(r.id);
    const 完成合计 = r.detail_results.reduce((s, d) => s + d.given, 0);

    return (
      <div key={r.id} className={`bg-white rounded-xl border p-5 ${r.status === "completed" ? "border-green-300" : 状态 === "closed" ? "border-red-200" : "border-gray-200"}`}>
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
            {阶段徽章(r)}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded ${展示.样式}`}>
            {展示.文案(r.execute_time.slice(0, 5), r.end_time.slice(0, 5))}
          </span>
        </div>

        <p className="text-xs text-gray-500 mb-2">
          {r.task_name} · 时段 {r.execute_time.slice(0, 5)} ~ {r.end_time.slice(0, 5)}
          {" · 责任人："}{r.employee_name}
          {" · 检查人："}{r.checker_names || "自检"}
        </p>

        {/* 检查标准（项目级标准照片 + 细节图文说明，可展开） */}
        {(r.details.length > 0 || r.item_guide_images.length > 0) && (
          <div className="mb-2">
            <button onClick={() => toggleExpanded(r.id)} className="text-xs text-blue-600 hover:text-blue-700">
              {展开 ? "收起检查标准 ▲" : "查看检查标准 ▼"}
            </button>
            {展开 && (
              <div className="mt-2 space-y-2 bg-gray-50 rounded-lg p-3">
                {r.item_guide_images.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">标准照片：</p>
                    <div className="flex flex-wrap gap-2">
                      {r.item_guide_images.map((src, j) => (
                        <a key={j} href={src} target="_blank" rel="noopener noreferrer">
                          <img src={src} alt="标准照片" loading="lazy" className="w-16 h-16 object-cover rounded border border-gray-200" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
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

        {/* 自检上报内容（已自检的记录展示出来） */}
        {r.self_reported_at && (
          <div className="mb-2 bg-cyan-50 rounded-lg p-3">
            <p className="text-xs text-cyan-700 font-medium mb-1">
              责任人自检已于 {new Date(r.self_reported_at).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 上报，合格分已计入
            </p>
            {r.self_report_note && <p className="text-xs text-gray-600 whitespace-pre-wrap">{r.self_report_note}</p>}
            {r.self_report_photos.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {r.self_report_photos.map((src, j) => (
                  <a key={j} href={src} target="_blank" rel="noopener noreferrer">
                    <img src={src} alt="自检照片" loading="lazy" className="w-14 h-14 object-cover rounded border border-cyan-200" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 已完成：展示逐条打分结果 */}
        {r.status === "completed" && r.detail_results.length > 0 && (
          <div className="mb-2 bg-green-50 rounded-lg p-3 space-y-1">
            {r.review_score_record_id && (
              <p className="text-xs text-amber-700 font-medium">检查人核查改判，差额已自动扣回</p>
            )}
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
        {分组 === "自检" && r.status === "pending" && (
          <div className="mt-2">
            {状态 === "closed" ? (
              <span className="text-xs text-gray-400">已超过检查时间段，无法上报</span>
            ) : (
              <button
                onClick={() => set自检记录(r)}
                className="px-4 py-2 text-sm text-white bg-cyan-600 rounded-lg hover:bg-cyan-700"
              >
                拍照自检上报
              </button>
            )}
          </div>
        )}
        {分组 === "检查" && r.status !== "completed" && (
          <div className="mt-2">
            {/* 已自检的（reported）：超时仍可核查改判；未自检的：超时关闭 */}
            {状态 === "closed" ? (
              <span className="text-xs text-gray-400">已超过检查时间段，无法提交</span>
            ) : (
              <button
                onClick={() => setCompletingRecord(r)}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                {r.status === "self_reported" ? "去核查" : "去检查"}
                {r.status === "self_reported" && (
                  <span className="ml-1 text-xs opacity-75">（合格分已计，不符可改判）</span>
                )}
                {r.status === "pending" && r.checker_ids.length > 0 && r.employee_id !== currentUserId && (
                  <span className="ml-1 text-xs opacity-75">（责任人未自检）</span>
                )}
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
        <PageHeader title="今日考核" description="责任人拍照自检即合格计分，检查人事后核查可改判；未自检且超过时间段自动关闭" />
        <div className="p-8 text-center text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="今日考核" description="责任人拍照自检即合格计分，检查人事后核查可改判；未自检且超过时间段自动关闭（漏检不扣分）" />

      {records.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">今天没有考核任务</p>
        </div>
      ) : (
        <>
          {待我自检.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">待我自检（{待我自检.length}）</h2>
              {待我自检.map((r) => renderCard(r, "自检"))}
            </div>
          )}
          {待我检查.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">待我检查（{待我检查.length}）</h2>
              {待我检查.map((r) => renderCard(r, "检查"))}
            </div>
          )}
          {考核我的.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">考核我的（{考核我的.length}）</h2>
              {考核我的.map((r) => renderCard(r, "被考核"))}
            </div>
          )}
        </>
      )}

      {/* 分页导航：考核记录按月/筛选分页，翻页保留当前筛选 */}
      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchRecords(page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <button
              onClick={() => fetchRecords(page + 1)}
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {自检记录 && (
        <SelfReportModal
          record={自检记录}
          onClose={() => set自检记录(null)}
          onReported={() => fetchRecords(page)}
        />
      )}
      {completingRecord && (
        <CheckCompleteModal
          record={completingRecord}
          未自检提示={completingRecord.status === "pending" && completingRecord.employee_id !== currentUserId && completingRecord.checker_ids.length > 0}
          onClose={() => setCompletingRecord(null)}
          onCompleted={() => fetchRecords(page)}
        />
      )}
    </div>
  );
}
