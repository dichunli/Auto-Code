"use client";

import {useState, useEffect, useMemo} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import VehicleModelSelector, { LinkedItem } from "@/components/VehicleModelSelector";
import { 处理外部图片 } from "@/lib/processExternalImages";
import { syncKnowledgeModelsFromVin } from "../actions";

const BlockNoteEditor = dynamic(
  () => import("@/components/BlockNoteEditor").then((mod) => mod.BlockNoteEditor),
  { ssr: false }
);

interface NamedItem {
  id: string;
  name: string;
}

export default function NewKnowledgePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);
  interface Category {
    id: string;
    name: string;
  }

  const [categories, setCategories] = useState<Category[]>([]);

  const [form, setForm] = useState({
    title: "",
    type: "article" as "article" | "video" | "qa" | "guide",
    category_id: "",
    content: "",
    content_blocks: "",
    video_url: "",
    visibility: "public" as "public" | "internal" | "private",
  });

  // 搜索添加维修项目名称
  const [nameSearch, setNameSearch] = useState("");
  const debouncedNameSearch = useDebounce(nameSearch, 300);
  const [nameResults, setNameResults] = useState<NamedItem[]>([]);
  const [nameSearching, setNameSearching] = useState(false);
  const [linkedNames, setLinkedNames] = useState<NamedItem[]>([]);

  // 适用车型
  const [linkedVehicles, setLinkedVehicles] = useState<LinkedItem[]>([]);

  // VIN同步
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncVin, setSyncVin] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);

  useEffect(() => {
    supabase.from("knowledge_categories").select("*").order("sort_order").limit(100).then(({ data }) => setCategories(data || []));
  }, [supabase]);

  async function doNameSearch(keyword: string) {
    if (!keyword.trim()) { setNameResults([]); return; }
    setNameSearching(true);
    const { data } = await supabase
      .from("service_names")
      .select("id, name")
      .ilike("name", `%${keyword.trim()}%`)
      .limit(20);
    setNameResults((data || []) as NamedItem[]);
    setNameSearching(false);
  }

  function handleNameSearchChange(val: string) {
    setNameSearch(val);
  }

  useEffect(() => {
    doNameSearch(debouncedNameSearch);
  }, [debouncedNameSearch]);

  function addLinkedName(item: NamedItem) {
    if (!linkedNames.find((n) => n.id === item.id)) {
      setLinkedNames((prev) => [...prev, item]);
    }
    setNameSearch("");
    setNameResults([]);
  }

  function removeLinkedName(id: string) {
    setLinkedNames((prev) => prev.filter((n) => n.id !== id));
  }

  async function handleSyncVin() {
    const vin = syncVin.trim().toUpperCase();
    if (vin.length !== 17) {
      alert("VIN码必须为17位");
      return;
    }
    setSyncLoading(true);
    try {
      const res = await syncKnowledgeModelsFromVin(vin);
      if (res.success && res.matchedModels && res.matchedModels.length > 0) {
        const newItems = res.matchedModels.map((vm) => ({
          id: String(vm.id),
          name: `${vm.品牌 || ""} ${vm.车系 || ""} ${vm.车型 || ""}`.trim(),
          manufacturer: vm.厂商 || "",
          brand: vm.品牌 || "",
          series: vm.车系 || "",
          model_name: vm.车型 || "",
          sales_version: vm.销售版本 || "",
          year_start: vm.年款 ?? undefined,
          year_end: vm.年款 ?? undefined,
          displacement: vm.排量 || "",
          engine: vm.发动机型号 || "",
          fuel_type: vm.燃油类型 || "",
          intake_form: vm.进气形式 || "",
          transmission_type: vm.变速箱类型 || "",
          transmission_code: vm.变速箱代号 || "",
          chassis_code: vm.底盘代号 || "",
          drive_type: vm.驱动方式 || "",
          body_type: vm.车身类型 || "",
          emission_standard: vm.排放标准 || "",
        }));
        setLinkedVehicles((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const uniqueNew = newItems.filter((n) => !existingIds.has(n.id));
          return [...prev, ...uniqueNew];
        });
        setSyncOpen(false);
        setSyncVin("");
        alert(`已同步${res.matchedModels.length}个车型`);
      } else {
        alert(res.error || "未找到匹配车型");
      }
    } catch (err: unknown) {
      alert("同步出错：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSyncLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      /* 校验：维修指导类型/分类必须关联维修项目和车型 */
      const 维修指导分类ID = categories.find((c) => c.name === "维修指导")?.id;
      const is维修指导 = form.type === "guide" || form.category_id === 维修指导分类ID;
      if (is维修指导 && linkedNames.length === 0) {
        alert("维修指导文章必须至少关联一个维修项目");
        setLoading(false);
        return;
      }
      if (is维修指导 && linkedVehicles.length === 0) {
        alert("维修指导文章必须至少关联一个适用车型");
        setLoading(false);
        return;
      }

      /* 处理外部图片：自动下载到本地 */
      let contentBlocks = form.content_blocks ? JSON.parse(form.content_blocks) : null;
      if (contentBlocks && Array.isArray(contentBlocks)) {
        contentBlocks = await 处理外部图片(contentBlocks);
      }

      const { data: article, error } = await supabase
        .from("knowledge_articles")
        .insert({
          title: form.title,
          type: form.type,
          category_id: form.category_id || null,
          content: form.content || null,
          content_blocks: contentBlocks,
          video_url: form.type === "video" ? form.video_url || null : null,
          visibility: form.visibility,
        })
        .select("id")
        .single();

      if (error || !article) throw error || new Error("创建失败");

      if (linkedNames.length > 0) {
        const nameLinks = linkedNames.map((n) => ({ article_id: article.id, service_name_id: n.id }));
        const { error: insertNameError } = await supabase.from("knowledge_service_links").insert(nameLinks);
        if (insertNameError) throw insertNameError;
      }

      if (linkedVehicles.length > 0) {
        const vehicleLinks = linkedVehicles.map((v) => ({
          article_id: article.id,
          vehicle_model_id: Number(v.id),
        }));
        const { error: insertVehicleError } = await supabase.from("knowledge_vehicle_links").insert(vehicleLinks);
        if (insertVehicleError) throw insertVehicleError;
      }

      router.push("/knowledge");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert("保存失败: " + message);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="新建知识库内容" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
            <input
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as "article" | "video" | "qa" | "guide" })}
              >
                <option value="article">文章</option>
                <option value="video">视频</option>
                <option value="qa">知识问答</option>
                <option value="guide">维修指导</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              >
                <option value="">未分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">阅读权限</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.visibility}
                onChange={(e) => setForm({ ...form, visibility: e.target.value as "public" | "internal" | "private" })}
              >
                <option value="public">所有人可见</option>
                <option value="internal">内部可见</option>
                <option value="private">仅自己可见</option>
              </select>
            </div>
          </div>

          {form.type === "video" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">视频链接</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="支持外部视频链接"
                value={form.video_url}
                onChange={(e) => setForm({ ...form, video_url: e.target.value })}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">内容</label>
            <BlockNoteEditor
              initialValue={form.content_blocks}
              onChange={(json) => setForm({ ...form, content_blocks: json })}
            />
          </div>

          {/* 关联维修项目名称 */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">关联维修项目名称</h3>
            <input
              type="text"
              value={nameSearch}
              onChange={(e) => handleNameSearchChange(e.target.value)}
              placeholder="输入项目名称搜索后添加..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"
            />
            {nameSearching && <p className="text-xs text-gray-400">搜索中...</p>}
            {nameResults.length > 0 && (
              <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto mb-2">
                {nameResults.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => addLinkedName(n)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    {n.name}
                  </button>
                ))}
              </div>
            )}
            {linkedNames.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {linkedNames.map((n) => (
                  <span key={n.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    {n.name}
                    <button
                      type="button"
                      onClick={() => removeLinkedName(n.id)}
                      className="text-blue-400 hover:text-blue-600">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 关联车型 - 使用适用车型模块 */}
          <div className="border-t border-gray-100 pt-4">
            <VehicleModelSelector
              value={linkedVehicles}
              onChange={setLinkedVehicles}
              onSyncVin={() => setSyncOpen(true)}
            />
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </form>

      {/* VIN同步弹窗 */}
      {syncOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">通过VIN同步车型</h3>
            <input
              type="text"
              value={syncVin}
              onChange={(e) => setSyncVin(e.target.value.toUpperCase())}
              placeholder="输入17位VIN码"
              maxLength={17}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm mb-4 font-mono"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setSyncOpen(false); setSyncVin(""); }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSyncVin}
                disabled={syncLoading || syncVin.trim().length !== 17}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {syncLoading ? "同步中..." : "同步"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
