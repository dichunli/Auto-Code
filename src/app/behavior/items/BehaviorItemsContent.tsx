"use client";

import {useState, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import CategoryManageModal, { 行为分类 } from "./CategoryManageModal";
import DetailManageModal from "./DetailManageModal";

interface 行为项目 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
  description: string | null;
  is_active: boolean;
  category_id: string | null;
  responsible_id: string | null;
  checker_id: string | null;
}

interface 员工 {
  id: string;
  full_name: string;
}

interface Props {
  initialItems: 行为项目[];
  initialCategories: 行为分类[];
  initialEmployees: 员工[];
  initialDetailCounts: Record<string, number>;
}

export default function BehaviorItemsContent({ initialItems, initialCategories, initialEmployees, initialDetailCounts }: Props) {
  const supabase = useMemo(() => createClient(), []);
  /* 首屏数据由服务端传入；loading 仅用于增删改后的客户端重查 */
  const [items, setItems] = useState<行为项目[]>(initialItems);
  const [categories, setCategories] = useState<行为分类[]>(initialCategories);
  const [detailCounts, setDetailCounts] = useState<Record<string, number>>(initialDetailCounts);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /* 分类筛选："" 全部 / "none" 未分类 / 分类 id */
  const [filterCategory, setFilterCategory] = useState("");
  /* 分类管理弹窗 */
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  /* 细节管理弹窗：正在管理细节的项目 */
  const [detailItem, setDetailItem] = useState<行为项目 | null>(null);

  /* 项目编辑弹窗 */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<行为项目 | null>(null);
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [form, setForm] = useState({
    name: "",
    score_type: "bonus",
    score_value: "",
    description: "",
    category_id: "",
    responsible_id: "",
    checker_id: "",
    is_active: true,
  });

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const employeeMap = useMemo(() => new Map(initialEmployees.map((e) => [e.id, e.full_name])), [initialEmployees]);

  /* 按分类筛选后的列表 */
  const filteredItems = useMemo(() => {
    if (filterCategory === "") return items;
    if (filterCategory === "none") return items.filter((i) => !i.category_id);
    return items.filter((i) => i.category_id === filterCategory);
  }, [items, filterCategory]);

  async function fetchItems() {
    setLoading(true);
    const [项目结果, 细节结果] = await Promise.all([
      supabase.from("behavior_score_items").select("*").order("created_at", { ascending: false }),
      supabase.from("behavior_item_details").select("id, item_id"),
    ]);
    setItems((项目结果.data as 行为项目[] | null) || []);
    const counts: Record<string, number> = {};
    for (const d of 细节结果.data || []) {
      counts[d.item_id] = (counts[d.item_id] || 0) + 1;
    }
    setDetailCounts(counts);
    setLoading(false);
  }

  async function fetchCategories() {
    const { data } = await supabase
      .from("behavior_categories")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    setCategories((data as 行为分类[] | null) || []);
  }

  function openAdd() {
    setEditingItem(null);
    setForm({ name: "", score_type: "bonus", score_value: "", description: "", category_id: "", responsible_id: "", checker_id: "", is_active: true });
    setModalOpen(true);
  }

  function openEdit(item: 行为项目) {
    setEditingItem(item);
    setForm({
      name: item.name,
      score_type: item.score_type,
      score_value: String(item.score_value),
      description: item.description || "",
      category_id: item.category_id || "",
      responsible_id: item.responsible_id || "",
      checker_id: item.checker_id || "",
      is_active: item.is_active,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      alert("请输入项目名称");
      return;
    }
    if (!form.score_value || parseInt(form.score_value) <= 0) {
      alert("请输入有效分值");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        score_type: form.score_type,
        score_value: parseInt(form.score_value),
        description: form.description.trim() || null,
        category_id: form.category_id || null,
        responsible_id: form.responsible_id || null,
        checker_id: form.checker_id || null,
        is_active: form.is_active,
      };

      if (editingItem) {
        const { error } = await supabase.from("behavior_score_items").update(payload).eq("id", editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("behavior_score_items").insert(payload);
        if (error) throw error;
      }

      setModalOpen(false);
      fetchItems();
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: 行为项目) {
    /* 删除项目会级联删除关联的考核任务→检查记录→评论，先查引用数让用户知情 */
    const { count } = await supabase
      .from("behavior_check_tasks")
      .select("id", { count: "exact", head: true })
      .eq("item_id", item.id);
    const cascadeTip = count && count > 0
      ? `\n注意：有 ${count} 个考核任务关联此项目，删除后这些任务及其检查记录、评论将被一并删除！`
      : "";
    if (!(await 请求确认(`确定删除项目「${item.name}」吗？已有的打分流水保留，但无法再使用此项目。${cascadeTip}`))) return;
    const { error } = await supabase.from("behavior_score_items").delete().eq("id", item.id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    fetchItems();
  }

  return (
    <div>
      <PageHeader
        title="行为规范项目"
        description="配置日常行为加减分项目，按分类组织；设了责任人的项目由检查人逐条细节打分"
        action={{ label: "+ 添加项目", onClick: openAdd }}
      />

      {/* 工具条：分类筛选 + 分类管理 */}
      <div className="flex items-center gap-2 mb-4">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.is_active ? "" : "（已停用）"}
            </option>
          ))}
          <option value="none">未分类</option>
        </select>
        <button
          onClick={() => setCategoryModalOpen(true)}
          className="px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          分类管理
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-400">加载中...</div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">{items.length === 0 ? "暂无项目，点击上方按钮添加" : "该分类下暂无项目"}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">项目名称</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">分类</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">类型</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">分值</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">责任人（检查人）</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">说明</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-4 py-3">
                    {item.category_id && categoryMap.get(item.category_id) ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                        {categoryMap.get(item.category_id)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">未分类</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        item.score_type === "bonus"
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                      }`}
                    >
                      {item.score_type === "bonus" ? "加分" : "减分"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={item.score_type === "bonus" ? "text-green-600" : "text-red-600"}>
                      {item.score_type === "bonus" ? "+" : "-"}
                      {item.score_value}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {item.responsible_id
                      ? `${employeeMap.get(item.responsible_id) || "?"}（${item.checker_id ? employeeMap.get(item.checker_id) || "?" : "自检"}）`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-40 truncate">{item.description || "-"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        item.is_active
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-gray-50 text-gray-500 border border-gray-200"
                      }`}
                    >
                      {item.is_active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setDetailItem(item)}
                      className="text-xs px-2 py-1 text-teal-600 hover:bg-teal-50 rounded border border-teal-200 mr-2"
                    >
                      细节{detailCounts[item.id] ? `(${detailCounts[item.id]})` : ""}
                    </button>
                    <button
                      onClick={() => openEdit(item)}
                      className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded border border-blue-200 mr-2"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
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

      {/* 项目编辑弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              {editingItem ? "编辑项目" : "添加项目"}
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">项目名称 *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="如：维修车间地面"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
                  <select
                    value={form.category_id}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">未分类</option>
                    {categories.filter((c) => c.is_active || c.id === form.category_id).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                  <select
                    value={form.score_type}
                    onChange={(e) => setForm({ ...form, score_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    <option value="bonus">加分</option>
                    <option value="penalty">减分</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">分值 *</label>
                  <input
                    type="number"
                    value={form.score_value}
                    onChange={(e) => setForm({ ...form, score_value: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="如：5"
                  />
                  <p className="text-xs text-gray-400 mt-1">设了检查细节后，此处仅作无细节时的默认分值</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">说明</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="简要说明此项目的检查范围..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">责任人</label>
                  <select
                    value={form.responsible_id}
                    onChange={(e) => setForm({ ...form, responsible_id: e.target.value, checker_id: e.target.value ? form.checker_id : "" })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">不指定（旧模式）</option>
                    {initialEmployees.map((e) => (
                      <option key={e.id} value={e.id}>{e.full_name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">被考核人，分数记在他头上</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">检查人</label>
                  <select
                    value={form.checker_id}
                    onChange={(e) => setForm({ ...form, checker_id: e.target.value })}
                    disabled={!form.responsible_id}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:opacity-50"
                  >
                    <option value="">责任人自检</option>
                    {initialEmployees.map((e) => (
                      <option key={e.id} value={e.id}>{e.full_name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">不选则责任人自己检查拍照</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="is_active" className="text-sm text-gray-700">
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

      {/* 分类管理弹窗 */}
      {categoryModalOpen && (
        <CategoryManageModal
          categories={categories}
          onClose={() => setCategoryModalOpen(false)}
          onChanged={fetchCategories}
        />
      )}

      {/* 细节管理弹窗 */}
      {detailItem && (
        <DetailManageModal
          itemId={detailItem.id}
          itemName={detailItem.name}
          onClose={() => setDetailItem(null)}
          onSaved={fetchItems}
        />
      )}
      {确认弹窗}
    </div>
  );
}
