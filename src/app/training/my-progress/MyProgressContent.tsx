"use client";

import {useState} from "react";
import { PageHeader } from "@/components/PageHeader";

interface 课程分配 {
  id: string;
  course_title: string;
  category: string;
  status: string;
  score: number | null;
  due_date: string | null;
  points: number;
}

interface 考试记录 {
  id: string;
  course_title: string;
  total_score: number;
  max_score: number;
  status: string;
  exam_count: number;
  created_at: string;
}

interface 行为记录 {
  id: string;
  item_name: string;
  score: number;
  scored_at: string;
}

interface 返工记录 {
  id: string;
  description: string;
  loss_amount: number;
  recorded_at: string;
}

interface 损失记录 {
  id: string;
  loss_type: string;
  description: string;
  loss_amount: number;
  recorded_at: string;
}

export default function MyProgressContent({
  initialCourses,
  initialExams,
  initialBehaviors,
  initialReworks,
  initialLosses,
}: {
  initialCourses: 课程分配[];
  initialExams: 考试记录[];
  initialBehaviors: 行为记录[];
  initialReworks: 返工记录[];
  initialLosses: 损失记录[];
}) {
  /* 首屏数据由服务端传入；本页为纯展示，无客户端重查 */
  const [courses] = useState<课程分配[]>(initialCourses);
  const [exams] = useState<考试记录[]>(initialExams);
  const [behaviors] = useState<行为记录[]>(initialBehaviors);
  const [reworks] = useState<返工记录[]>(initialReworks);
  const [losses] = useState<损失记录[]>(initialLosses);

  const categoryLabels: Record<string, string> = {
    safety: "安全",
    technical: "技术",
    service: "服务",
    management: "管理",
  };

  const totalPoints = courses.filter((c) => c.status === "completed").reduce((sum, c) => sum + c.points, 0);
  const behaviorTotal = behaviors.reduce((sum, b) => sum + b.score, 0);
  const reworkTotal = reworks.reduce((sum, r) => sum + r.loss_amount, 0);
  const lossTotal = losses.reduce((sum, l) => sum + l.loss_amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="我的学习总览" />

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{totalPoints}</p>
          <p className="text-xs text-gray-500">已获得积分</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className={`text-2xl font-bold ${behaviorTotal >= 0 ? "text-green-600" : "text-red-600"}`}>
            {behaviorTotal > 0 ? "+" : ""}
            {behaviorTotal}
          </p>
          <p className="text-xs text-gray-500">行为规范分数</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-red-600">¥{reworkTotal.toFixed(2)}</p>
          <p className="text-xs text-gray-500">返工损失</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-red-600">¥{lossTotal.toFixed(2)}</p>
          <p className="text-xs text-gray-500">日常损失</p>
        </div>
      </div>

      {/* 课程学习 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">课程学习</h3>
        {courses.length === 0 ? (
          <p className="text-sm text-gray-400">暂无分配课程</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">课程</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">分类</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">积分</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">状态</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">分数</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">截止日期</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {courses.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{c.course_title}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600">
                        {categoryLabels[c.category] || c.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">{c.points}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          c.status === "completed"
                            ? "bg-green-50 text-green-700"
                            : c.status === "in_progress"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-gray-50 text-gray-500"
                        }`}
                      >
                        {c.status === "completed" ? "已完成" : c.status === "in_progress" ? "学习中" : "待开始"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{c.score ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-500">{c.due_date || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 考试记录 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">考试记录</h3>
        {exams.length === 0 ? (
          <p className="text-sm text-gray-400">暂无考试记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">课程</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">分数</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">状态</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">次数</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {exams.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{e.course_title}</td>
                    <td className="px-4 py-3">
                      {e.total_score}/{e.max_score}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          e.status === "passed"
                            ? "bg-green-50 text-green-700"
                            : e.status === "failed"
                            ? "bg-red-50 text-red-700"
                            : "bg-yellow-50 text-yellow-700"
                        }`}
                      >
                        {e.status === "passed" ? "通过" : e.status === "failed" ? "未通过" : "待判卷"}
                      </span>
                    </td>
                    <td className="px-4 py-3">第{e.exam_count}次</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(e.created_at).toLocaleDateString("zh-CN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 行为规范 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">行为规范记录</h3>
        {behaviors.length === 0 ? (
          <p className="text-sm text-gray-400">暂无记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">时间</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">项目</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">分数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {behaviors.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(b.scored_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3">{b.item_name}</td>
                    <td className="px-4 py-3">
                      <span className={b.score > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {b.score > 0 ? "+" : ""}
                        {b.score}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 返工记录 */}
      {reworks.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">返工记录</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">日期</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">原因</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">损失金额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reworks.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(r.recorded_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3">{r.description}</td>
                    <td className="px-4 py-3 text-red-600">¥{r.loss_amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 日常损失 */}
      {losses.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">日常损失记录</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">日期</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">类型</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">描述</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">损失金额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {losses.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(l.recorded_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{l.loss_type}</span>
                    </td>
                    <td className="px-4 py-3">{l.description}</td>
                    <td className="px-4 py-3 text-red-600">¥{l.loss_amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
