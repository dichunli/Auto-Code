"use client";

import {useState, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { 保存晋级规则, 删除晋级规则 } from "../actions";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";

export interface 技师等级 {
  id: string;
  name: string;
}

export interface 课程 {
  id: string;
  title: string;
}

export interface 晋级规则 {
  id: string;
  from_level_id: string | null;
  to_level_id: string;
  from_level_name: string;
  to_level_name: string;
  min_course_points: number;
  min_work_orders: number;
  max_rework_loss: number;
  max_daily_loss: number;
  min_behavior_score: number;
  min_exam_score: number;
  exam_pass_required: boolean;
  period_months: number;
  required_course_ids: string[];
  description: string | null;
  is_active: boolean;
}

export default function PromotionRulesContent({
  initialLevels,
  initialCourses,
  initialRules,
}: {
  initialLevels: 技师等级[];
  initialCourses: 课程[];
  initialRules: 晋级规则[];
}) {
  const supabase = useMemo(() => createClient(), []);
  /* 首屏数据由服务端传入；loading 仅用于增删改后的客户端重查 */
  const [levels, setLevels] = useState<技师等级[]>(initialLevels);
  const [courses, setCourses] = useState<课程[]>(initialCourses);
  const [rules, setRules] = useState<晋级规则[]>(initialRules);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<晋级规则 | null>(null);
  const { 请求确认, 确认弹窗 } = useConfirm();

  const [form, setForm] = useState({
    from_level_id: "",
    to_level_id: "",
    min_course_points: "",
    min_work_orders: "",
    max_rework_loss: "",
    max_daily_loss: "",
    min_behavior_score: "",
    min_exam_score: "",
    exam_pass_required: true,
    period_months: "6",
    required_course_ids: [] as string[],
    description: "",
    is_active: true,
  });

  async function fetchData() {
    setLoading(true);
    const [{ data: levelData }, { data: ruleData }, { data: courseData }] = await Promise.all([
      supabase.from("mechanic_levels").select("id, name").order("sort_order", { ascending: true }),
      supabase.from("promotion_rules").select("*").order("created_at", { ascending: false }),
      supabase.from("training_courses").select("id, title").eq("is_required", true).order("title"),
    ]);

    const levelMap = new Map<string, string>();
    (levelData as 技师等级[] | null)?.forEach((l) => levelMap.set(l.id, l.name));
    setLevels((levelData as 技师等级[] | null) || []);
    setCourses((courseData as 课程[] | null) || []);

    setRules(
      ((ruleData || []) as 晋级规则[]).map((r) => ({
        ...r,
        from_level_name: r.from_level_id ? levelMap.get(r.from_level_id) || "无等级" : "无等级",
        to_level_name: levelMap.get(r.to_level_id) || "未知",
        required_course_ids: r.required_course_ids || [],
      }))
    );
    setLoading(false);
  }

  function openAdd() {
    setEditingRule(null);
    setForm({
      from_level_id: "",
      to_level_id: "",
      min_course_points: "",
      min_work_orders: "",
      max_rework_loss: "",
      max_daily_loss: "",
      min_behavior_score: "",
      min_exam_score: "",
      exam_pass_required: true,
      period_months: "6",
      required_course_ids: [],
      description: "",
      is_active: true,
    });
    setModalOpen(true);
  }

  function openEdit(rule: 晋级规则) {
    setEditingRule(rule);
    setForm({
      from_level_id: rule.from_level_id || "",
      to_level_id: rule.to_level_id,
      min_course_points: String(rule.min_course_points),
      min_work_orders: String(rule.min_work_orders),
      max_rework_loss: String(rule.max_rework_loss),
      max_daily_loss: String(rule.max_daily_loss),
      min_behavior_score: String(rule.min_behavior_score),
      min_exam_score: String(rule.min_exam_score),
      exam_pass_required: rule.exam_pass_required,
      period_months: String(rule.period_months),
      required_course_ids: rule.required_course_ids || [],
      description: rule.description || "",
      is_active: rule.is_active,
    });
    setModalOpen(true);
  }

  function toggleCourse(courseId: string) {
    setForm((prev) => {
      const exists = prev.required_course_ids.includes(courseId);
      if (exists) {
        return { ...prev, required_course_ids: prev.required_course_ids.filter((id) => id !== courseId) };
      }
      return { ...prev, required_course_ids: [...prev.required_course_ids, courseId] };
    });
  }

  async function handleSave() {
    if (!form.to_level_id) {
      alert("请选择目标等级");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        from_level_id: form.from_level_id || null,
        to_level_id: form.to_level_id,
        min_course_points: parseInt(form.min_course_points) || 0,
        min_work_orders: parseInt(form.min_work_orders) || 0,
        max_rework_loss: parseFloat(form.max_rework_loss) || 0,
        max_daily_loss: parseFloat(form.max_daily_loss) || 0,
        min_behavior_score: parseInt(form.min_behavior_score) || 0,
        min_exam_score: parseInt(form.min_exam_score) || 0,
        exam_pass_required: form.exam_pass_required,
        period_months: parseInt(form.period_months) || 6,
        required_course_ids: form.required_course_ids.length > 0 ? form.required_course_ids : null,
        description: form.description.trim() || null,
        is_active: form.is_active,
      };

      /* 写库走 Server Action */
      const result = await 保存晋级规则({ id: editingRule?.id || null, payload });
      if (!result.success) throw new Error(result.error || "保存失败");

      setModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await 请求确认("确定删除这条晋级规则吗？"))) return;
    const result = await 删除晋级规则(id);
    if (!result.success) {
      alert("删除失败: " + (result.error || "未知错误"));
      return;
    }
    fetchData();
  }


  return (
    <div>
      <PageHeader
        title="晋级规则配置"
        description="配置各等级的晋升条件"
        action={{ label: "+ 添加规则", onClick: openAdd }}
      />

      {loading ? (
        <div className="p-8 text-center text-gray-400">加载中...</div>
      ) : rules.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">暂无晋级规则</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">晋级路径</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">课程积分</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">工单数量</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">行为分数</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">考核得分</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">必修课程</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">考察期</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="text-gray-500">{r.from_level_name}</span>
                    <span className="mx-1 text-gray-400">→</span>
                    <span className="font-medium text-gray-900">{r.to_level_name}</span>
                  </td>
                  <td className="px-4 py-3">{r.min_course_points}</td>
                  <td className="px-4 py-3">{r.min_work_orders}</td>
                  <td className="px-4 py-3">{r.min_behavior_score}</td>
                  <td className="px-4 py-3">{r.min_exam_score > 0 ? r.min_exam_score : "-"}</td>
                  <td className="px-4 py-3">
                    {r.required_course_ids && r.required_course_ids.length > 0 ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                        {r.required_course_ids.length} 门
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{r.period_months} 个月</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        r.is_active
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-gray-50 text-gray-500 border border-gray-200"
                      }`}
                    >
                      {r.is_active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(r)}
                      className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded border border-blue-200 mr-2"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded border border-red-200"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              {editingRule ? "编辑规则" : "添加规则"}
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">起始等级</label>
                  <select
                    value={form.from_level_id}
                    onChange={(e) => setForm({ ...form, from_level_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">无等级（入职）</option>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">目标等级 *</label>
                  <select
                    value={form.to_level_id}
                    onChange={(e) => setForm({ ...form, to_level_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">请选择</option>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">最低课程积分</label>
                  <input
                    type="number"
                    value={form.min_course_points}
                    onChange={(e) => setForm({ ...form, min_course_points: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">最低工单数</label>
                  <input
                    type="number"
                    value={form.min_work_orders}
                    onChange={(e) => setForm({ ...form, min_work_orders: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">最低行为分数</label>
                  <input
                    type="number"
                    value={form.min_behavior_score}
                    onChange={(e) => setForm({ ...form, min_behavior_score: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">返工损失上限（0=不限）</label>
                  <input
                    type="number"
                    value={form.max_rework_loss}
                    onChange={(e) => setForm({ ...form, max_rework_loss: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">日常损失上限（0=不限）</label>
                  <input
                    type="number"
                    value={form.max_daily_loss}
                    onChange={(e) => setForm({ ...form, max_daily_loss: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">最低考核得分</label>
                  <input
                    type="number"
                    value={form.min_exam_score}
                    onChange={(e) => setForm({ ...form, min_exam_score: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="0=不限"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">考察期（月）</label>
                  <input
                    type="number"
                    value={form.period_months}
                    onChange={(e) => setForm({ ...form, period_months: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="exam_pass"
                    checked={form.exam_pass_required}
                    onChange={(e) => setForm({ ...form, exam_pass_required: e.target.checked })}
                    className="rounded"
                  />
                  <label htmlFor="exam_pass" className="text-sm text-gray-700">
                    要求所有考试通过
                  </label>
                </div>
              </div>

              {/* 必修课程选择 */}
              {courses.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">必修课程</label>
                  <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                    {courses.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.required_course_ids.includes(c.id)}
                          onChange={() => toggleCourse(c.id)}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-700">{c.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">说明</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active_rule"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="is_active_rule" className="text-sm text-gray-700">
                  启用
                </label>
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-gray-100">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
      {确认弹窗}
    </div>
  );
}
