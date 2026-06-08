"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import VehicleModelSelector, { LinkedItem } from "@/components/VehicleModelSelector";
import { 处理外部图片 } from "@/lib/processExternalImages";
import { syncKnowledgeModelsFromVin } from "../../actions";

const BlockNoteEditor = dynamic(
  () => import("@/components/BlockNoteEditor").then((mod) => mod.BlockNoteEditor),
  { ssr: false }
);

interface NamedItem {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
}

interface 岗位 {
  id: string;
  name: string;
  label: string | null;
}

export default function EditKnowledgePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [articleId, setArticleId] = useState<string>("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [roles, setRoles] = useState<岗位[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  const [form, setForm] = useState({
    title: "",
    type: "article" as "article" | "video" | "qa" | "guide",
    category_id: "",
    content: "",
    content_blocks: "",
    video_url: "",
    visibility: "public" as "public" | "internal" | "private" | "role",
  });

  /* 搜索添加维修项目名称 */
  const [nameSearch, setNameSearch] = useState("");
  const [nameResults, setNameResults] = useState<NamedItem[]>([]);
  const [nameSearching, setNameSearching] = useState(false);
  const [linkedNames, setLinkedNames] = useState<NamedItem[]>([]);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 适用车型 */
  const [linkedVehicles, setLinkedVehicles] = useState<LinkedItem[]>([]);

  /* VIN同步 */
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncVin, setSyncVin] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);

  /* 加载文章数据和分类 */
  useEffect(() => {
    async function load() {
      const { id } = await params;
      setArticleId(id);

      /* 加载分类 */
      const { data: cats } = await supabase
        .from("knowledge_categories")
        .select("*")
        .order("sort_order")
        .limit(100);
      setCategories(cats || []);

      /* 加载岗位列表 */
      const { data: rolesData } = await supabase
        .from("roles")
        .select("id, name, label")
        .order("name");
      setRoles((rolesData || []) as 岗位[]);

      /* 加载文章 */
      const { data: article } = await supabase
        .from("knowledge_articles")
        .select("*")
        .eq("id", id)
        .single();

      if (!article) {
        alert("文章不存在");
        router.push("/knowledge");
        return;
      }

      setForm({
        title: article.title || "",
        type: (article.type as "article" | "video" | "qa" | "guide") || "article",
        category_id: article.category_id || "",
        content: article.content || "",
        content_blocks: article.content_blocks
          ? JSON.stringify(article.content_blocks)
          : "",
        video_url: article.video_url || "",
        visibility: (article.visibility as "public" | "internal" | "private" | "role") || "public",
      });

      /* 加载文章关联的岗位 */
      const { data: articleRoles } = await supabase
        .from("knowledge_article_roles")
        .select("role_name")
        .eq("article_id", id);
      if (articleRoles) {
        setSelectedRoles(articleRoles.map((r) => r.role_name));
      }

      /* 加载关联维修项目名称 */
      const { data: nameLinks } = await supabase
        .from("knowledge_service_links")
        .select("service_name_id, service_names(name)")
        .eq("article_id", id);

      if (nameLinks) {
        setLinkedNames(
          nameLinks
            .filter((l) => l.service_name_id)
            .map((l) => ({
              id: l.service_name_id as string,
              name: (l.service_names as { name: string } | null)?.name || "",
            }))
        );
      }

      /* 加载关联车型 */
      const { data: vehicleLinks } = await supabase
        .from("knowledge_vehicle_links")
        .select("vehicle_models(id, 品牌, 车系, 车型, 年款)")
        .eq("article_id", id);

      if (vehicleLinks) {
        setLinkedVehicles(
          vehicleLinks.map((v) => {
            const vm = (v as { vehicle_models: { id: number; 品牌: string; 车系: string; 车型: string | null; 年款: number | null } | null }).vehicle_models;
            return {
              id: String(vm?.id || ""),
              brand: vm?.品牌 || "",
              series: vm?.车系 || "",
              model: vm?.车型 || "",
              yearStart: vm?.年款 || undefined,
              yearEnd: vm?.年款 || undefined,
            };
          })
        );
      }

      setPageLoading(false);
    }

    load();
  }, [params, router, supabase]);

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
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => doNameSearch(val), 300);
  }

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
    if (!articleId) return;
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

      /* 获取当前用户 */
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      /* 更新文章 */
      const { data: updatedRows, error: updateError } = await supabase
        .from("knowledge_articles")
        .update({
          title: form.title,
          type: form.type,
          category_id: form.category_id || null,
          content: form.content || null,
          content_blocks: contentBlocks,
          video_url: form.type === "video" ? form.video_url || null : null,
          visibility: form.visibility,
          created_by: currentUser?.id,
        })
        .eq("id", articleId)
        .select();

      if (updateError) throw updateError;
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error("更新失败，请检查是否有编辑权限");
      }

      /* 删除旧的关联，重新插入 */
      const { error: delNameError } = await supabase.from("knowledge_service_links").delete().eq("article_id", articleId);
      if (delNameError) throw delNameError;
      const { error: delVehicleError } = await supabase.from("knowledge_vehicle_links").delete().eq("article_id", articleId);
      if (delVehicleError) throw delVehicleError;

      /* 更新岗位权限关联（失败不阻塞文章保存） */
      let roleUpdateError = "";
      const { error: delRoleError } = await supabase.from("knowledge_article_roles").delete().eq("article_id", articleId);
      if (delRoleError) {
        roleUpdateError = delRoleError.message;
      } else if (form.visibility === "role" && selectedRoles.length > 0) {
        const roleLinks = selectedRoles.map((roleName) => ({ article_id: articleId, role_name: roleName }));
        const { error: insertRoleError } = await supabase.from("knowledge_article_roles").insert(roleLinks);
        if (insertRoleError) roleUpdateError = insertRoleError.message;
      }

      if (linkedNames.length > 0) {
        const nameLinks = linkedNames.map((n) => ({ article_id: articleId, service_name_id: n.id }));
        const { error: insertNameError } = await supabase.from("knowledge_service_links").insert(nameLinks);
        if (insertNameError) throw insertNameError;
      }

      if (linkedVehicles.length > 0) {
        const vehicleLinks = linkedVehicles.map((v) => ({
          article_id: articleId,
          vehicle_model_id: Number(v.id),
        }));
        const { error: insertVehicleError } = await supabase.from("knowledge_vehicle_links").insert(vehicleLinks);
        if (insertVehicleError) throw insertVehicleError;
      }

      if (roleUpdateError) {
        alert("文章已保存，但岗位权限更新失败：" + roleUpdateError);
      }
      /* 强制完整刷新，避免缓存显示旧数据 */
      window.location.href = `/knowledge/${articleId}`;
    } catch (err: unknown) {
      let message = "保存失败";
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === "object" && err !== null) {
        const errObj = err as Record<string, unknown>;
        if (typeof errObj.message === "string") message = errObj.message;
        else if (typeof errObj.error_description === "string") message = errObj.error_description;
        else message = JSON.stringify(errObj);
      } else {
        message = String(err);
      }
      alert("保存失败: " + message);
      setLoading(false);
    }
  }

  if (pageLoading) {
    return (
      <div>
        <PageHeader title="编辑知识库内容" />
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="编辑知识库内容" />
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
                onChange={(e) => setForm({ ...form, visibility: e.target.value as "public" | "internal" | "private" | "role" })}
              >
                <option value="public">🔓 公开（所有人可见）</option>
                <option value="internal">🔐 内部（登录用户可见）</option>
                <option value="private">🔒 私密（仅管理员和作者可见）</option>
                <option value="role">👥 岗位（指定岗位可见）</option>
              </select>
              {/* 岗位选择 */}
              {form.visibility === "role" && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0">
                  {roles.map((role) => (
                    <label key={role.id} className="inline-flex items-center gap-1 text-sm cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selectedRoles.includes(role.name)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedRoles((prev) => [...prev, role.name]);
                          } else {
                            setSelectedRoles((prev) => prev.filter((r) => r !== role.name));
                          }
                        }}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300"
                      />
                      <span className="text-gray-700">{role.label || role.name}</span>
                    </label>
                  ))}
                  {roles.length === 0 && (
                    <span className="text-xs text-gray-400">暂无岗位数据</span>
                  )}
                </div>
              )}
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

          {/* 关联车型 */}
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
            {loading ? "保存中..." : "保存"}
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
