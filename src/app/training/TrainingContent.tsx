"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import DeleteCourseButton from "./DeleteCourseButton";

export interface 课程 {
  id: string;
  category: string;
  category_name?: string;
  is_required: boolean;
  title: string;
  description: string | null;
  duration_minutes: number | null;
  passing_score: number;
  points: number | null;
  video_url: string | null;
  has_exam: boolean | null;
  exam_mode: string | null;
  sort_order: number;
  profiles: { full_name: string } | null;
  training_categories?: { id: string; name: string } | null;
  topic_ids?: string[];
}

interface 课程分类 {
  id: string;
  name: string;
  parent_id: string | null;
  children?: 课程分类[];
}

interface 专题 {
  id: string;
  name: string;
}

/* 构建分类树 */
function 构建分类树(flat: 课程分类[]): 课程分类[] {
  const map = new Map<string, 课程分类>();
  const roots: 课程分类[] = [];
  for (const item of flat) map.set(item.id, { ...item, children: [] });
  for (const item of map.values()) {
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children!.push(item);
    } else {
      roots.push(item);
    }
  }
  return roots;
}

/* 获取某分类下的所有子分类ID（含自身） */
function 获取子孙分类ID(cat: 课程分类): string[] {
  const ids = [cat.id];
  if (cat.children) {
    for (const child of cat.children) {
      ids.push(...获取子孙分类ID(child));
    }
  }
  return ids;
}

/* 递归渲染分类树节点 */
function CategoryTreeNode({
  item,
  depth,
  selectedId,
  onSelect,
}: {
  item: 课程分类;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;
  const isActive = selectedId === item.id;

  return (
    <div>
      <button
        onClick={() => onSelect(isActive ? null : item.id)}
        className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-1.5 transition-colors ${
          isActive ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-700 hover:bg-gray-100"
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {hasChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="flex-shrink-0"
          >
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {item.name}
      </button>
      {hasChildren && expanded && item.children!.map((child) => (
        <CategoryTreeNode
          key={child.id}
          item={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export default function TrainingContent({
  initialCourses,
  categories,
  topics,
}: {
  initialCourses: 课程[];
  categories: 课程分类[];
  topics: 专题[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [courses, setCourses] = useState<课程[]>(initialCourses);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  /* 筛选状态 */
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  const 分类树 = useMemo(() => 构建分类树(categories), [categories]);

  /* 根据筛选条件过滤课程 */
  const 筛选后课程 = useMemo(() => {
    let result = courses;

    /* 按分类筛选（含子分类） */
    if (selectedCategoryId) {
      const 目标分类 = categories.find((c) => c.id === selectedCategoryId);
      if (目标分类) {
        /* 找到树节点 */
        const 找到节点 = (树: 课程分类[], id: string): 课程分类 | null => {
          for (const node of 树) {
            if (node.id === id) return node;
            if (node.children) {
              const found = 找到节点(node.children, id);
              if (found) return found;
            }
          }
          return null;
        };
        const 节点 = 找到节点(分类树, selectedCategoryId);
        if (节点) {
          const 子孙ID = 获取子孙分类ID(节点);
          result = result.filter((c) => 子孙ID.includes(String(c.category_id || "")));
        }
      }
    }

    /* 按专题筛选 */
    if (selectedTopicId) {
      result = result.filter((c) => c.topic_ids?.includes(selectedTopicId));
    }

    return result;
  }, [courses, selectedCategoryId, selectedTopicId, categories, 分类树]);

  async function saveSortOrder(updated: 课程[]) {
    const updates = updated.map((c, index) => ({
      id: c.id,
      sort_order: index,
    }));

    for (const u of updates) {
      await supabase.from("training_courses").update({ sort_order: u.sort_order }).eq("id", u.id);
    }
  }

  function handleDragStart(id: string) {
    setDragId(id);
  }

  function handleDragOver(e: React.DragEvent, overId: string) {
    e.preventDefault();
    if (dragId && dragId !== overId) {
      setDragOverId(overId);
    }
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const fromIndex = courses.findIndex((c) => c.id === dragId);
    const toIndex = courses.findIndex((c) => c.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const next = [...courses];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);

    setCourses(next);
    saveSortOrder(next);
    setDragId(null);
    setDragOverId(null);
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="培训考核"
        description="员工培训与学习管理"
        action={{ href: "/training/new", label: "新建课程" }}
      />

      {/* 快捷入口 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-2">
          <span className="text-sm font-medium text-gray-700 mr-2">管理:</span>
          <Link href="/training/exam-manage" className="text-xs px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100">
            考题管理
          </Link>
          <Link href="/training/exam-grade" className="text-xs px-3 py-1.5 rounded-lg bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100">
            简答题判卷
          </Link>
          <Link href="/training/behavior-items" className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
            行为项目
          </Link>
          <Link href="/training/behavior-score" className="text-xs px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100">
            行为打分
          </Link>
          <Link href="/training/rework-records" className="text-xs px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100">
            返工记录
          </Link>
          <Link href="/training/loss-records" className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
            损失记录
          </Link>
          <Link href="/training/promotion-rules" className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100">
            晋级规则
          </Link>
          <Link href="/training/promotion-overview" className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
            晋级总览
          </Link>
          <Link href="/training/promotion-records" className="text-xs px-3 py-1.5 rounded-lg bg-cyan-50 text-cyan-700 border border-cyan-200 hover:bg-cyan-100">
            晋级审核
          </Link>
        </div>
        <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-gray-100">
          <span className="text-sm font-medium text-gray-700 mr-2">个人:</span>
          <Link href="/training/my-progress" className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100">
            我的学习
          </Link>
          <Link href="/training/promotion-status" className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100">
            我的晋级
          </Link>
        </div>
      </div>

      {/* 专题筛选标签栏 */}
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-gray-500 mr-1">专题:</span>
          <button
            onClick={() => setSelectedTopicId(null)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              !selectedTopicId
                ? "bg-gray-700 text-white border-gray-700"
                : "bg-white text-gray-500 border-gray-300 hover:border-gray-400"
            }`}
          >
            全部
          </button>
          {topics.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTopicId(selectedTopicId === t.id ? null : t.id)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                selectedTopicId === t.id
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-6">
        {/* 分类树侧栏 */}
        {categories.length > 0 && (
          <div className="w-48 flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-200 p-3 sticky top-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">分类筛选</h3>
              <button
                onClick={() => setSelectedCategoryId(null)}
                className={`w-full text-left px-2 py-1.5 text-sm rounded mb-1 transition-colors ${
                  !selectedCategoryId ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                全部
              </button>
              {分类树.map((node) => (
                <CategoryTreeNode
                  key={node.id}
                  item={node}
                  depth={0}
                  selectedId={selectedCategoryId}
                  onSelect={setSelectedCategoryId}
                />
              ))}
            </div>
          </div>
        )}

        {/* 课程卡片网格 */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {筛选后课程.map((course) => (
          <div
            key={course.id}
            draggable
            onDragStart={() => handleDragStart(course.id)}
            onDragOver={(e) => handleDragOver(e, course.id)}
            onDrop={(e) => handleDrop(e, course.id)}
            onDragEnd={handleDragEnd}
            className={`relative bg-white rounded-xl border p-5 hover:shadow-sm transition-all cursor-move ${
              dragOverId === course.id ? "border-blue-400 ring-2 ring-blue-100" : "border-gray-200"
            } ${dragId === course.id ? "opacity-50" : "opacity-100"}`}
          >
            <div className="absolute top-3 right-3 z-10">
              <DeleteCourseButton
                id={course.id}
                title={course.title}
                className="text-xs px-2 py-1"
              />
            </div>
            <Link href={`/training/${course.id}`} className="block">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                  {course.category_name || course.category || "未分类"}
                </span>
                {course.is_required && (
                  <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">必修</span>
                )}
                {(course.points ?? 0) > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 border border-yellow-100">
                    积分 {course.points}
                  </span>
                )}
                {course.video_url && (
                  <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-600 border border-green-100">
                    视频
                  </span>
                )}
                {course.has_exam && (
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">
                    {course.exam_mode === "offline" ? "线下考试" : "考试"}
                  </span>
                )}
              </div>
              <h3 className="text-base font-semibold text-gray-900">{course.title}</h3>
              {course.description && (
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{course.description}</p>
              )}
              <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
                {course.duration_minutes && <span>{course.duration_minutes} 分钟</span>}
                <span>通过分: {course.passing_score}</span>
                <span>创建: {course.profiles?.full_name}</span>
              </div>
            </Link>
          </div>
        ))}
        {筛选后课程.length === 0 && (
          <div className="col-span-full text-center text-gray-400 py-12">
            {selectedCategoryId || selectedTopicId ? "没有匹配的课程" : "暂无课程"}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
