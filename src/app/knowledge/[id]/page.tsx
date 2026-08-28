export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BlockNoteRenderer } from "@/components/BlockNoteRenderer";
import { BlockNoteTOC } from "@/components/BlockNoteTOC";
import { PresentationView } from "@/components/PresentationView";
import { KnowledgeDeleteButton } from "@/components/KnowledgeDeleteButton";
import { 是抖音链接, 抖音视频简化卡片 } from "@/components/DouyinVideo";
import { 消毒Html } from "@/lib/sanitizeHtml";
import { 记录文章阅读 } from "../actions";

interface 维修项目关联 {
  service_names: { name: string } | null;
  service_items: { name: string } | null;
}

import { KnowledgeReadList } from "@/components/KnowledgeReadList";
import type { ComponentProps } from "react";

/* 权限标签配置 */
const 权限标签: Record<string, { label: string; className: string }> = {
  public: { label: "公开", className: "bg-green-50 text-green-700" },
  internal: { label: "内部", className: "bg-yellow-50 text-yellow-700" },
  private: { label: "私密", className: "bg-red-50 text-red-700" },
  role: { label: "岗位", className: "bg-purple-50 text-purple-700" },
};

export default async function KnowledgeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const autoPresent = sp.present === "1";
  const supabase = await createClient();

  /* 第 1 轮并行：互不依赖的查询同时发出 */
  const [userResult, articleResult, readCountResult, linksResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("knowledge_articles")
      .select("*, knowledge_categories(name), profiles(full_name)")
      .eq("id", id)
      .single(),
    supabase
      .from("knowledge_article_reads")
      .select("*", { count: "exact", head: true })
      .eq("article_id", id),
    supabase
      .from("knowledge_service_links")
      .select("service_name_id, service_item_id, service_names(name), service_items(name)")
      .eq("article_id", id),
  ]);

  const { data: { user: currentUser } } = userResult;
  const { data: article } = articleResult;
  const currentUserId = currentUser?.id;
  const readCount = readCountResult.count ?? 0;
  const links = linksResult.data;

  if (!article) notFound();

  /* 第 2 轮并行：依赖 userId 的查询同时发出（无登录用户则跳过） */
  let isAdmin = false;
  let userGroupId = "";
  if (currentUserId) {
    const [roleResult, profileResult] = await Promise.all([
      supabase.from("profile_roles").select("roles(name)").eq("profile_id", currentUserId),
      supabase.from("profiles").select("group_id").eq("id", currentUserId).single(),
    ]);

    const { data: roleData } = roleResult;
    const roleNames = ((roleData || []) as unknown as { roles?: { name?: string } | null }[]).map(
      (d) => d.roles?.name
    ).filter(Boolean) as string[];
    isAdmin = roleNames.includes("admin");

    const { data: profileData } = profileResult;
    userGroupId = profileData?.group_id ? String(profileData.group_id) : "";

    /* 记录阅读（不阻塞页面加载）；写库收口到 Server Action，用户身份由服务端验证 */
    void 记录文章阅读(id).then(() => {}, () => {});
  }

  /* 权限检查 */
  const isOwner = article.created_by === currentUserId;
  const canView = isAdmin || isOwner || article.visibility === "public" || article.visibility === "internal";
  const canEdit = isAdmin || isOwner;

  if (!canView) {
    redirect("/knowledge");
  }

  return (
    <div>
      <PageHeader title={article.title} />

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                article.type === "video"
                  ? "bg-red-50 text-red-700"
                  : article.type === "qa"
                  ? "bg-green-50 text-green-700"
                  : article.type === "guide"
                  ? "bg-orange-50 text-orange-700"
                  : "bg-blue-50 text-blue-700"
              }`}
            >
              {article.type === "video" ? "视频" : article.type === "qa" ? "问答" : article.type === "guide" ? "维修指导" : "文章"}
            </span>
            {/* 阅读权限标签 */}
            {(() => {
              const vis = article.visibility || "public";
              const cfg = 权限标签[vis] || 权限标签.public;
              return (
                <span className={`text-xs px-2 py-0.5 rounded ${cfg.className}`}>
                  {cfg.label}
                </span>
              );
            })()}
            {article.knowledge_categories?.name && (
              <span className="text-xs text-gray-500">{article.knowledge_categories.name}</span>
            )}
            <span className="text-xs text-gray-400">
              {article.profiles?.full_name || "系统"} · {new Date(article.created_at).toLocaleDateString()}
            </span>
            {/* 阅读次数 */}
            {readCount !== null && readCount > 0 && (
              <span className="text-xs text-gray-400">
                阅读 {readCount} 次
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* 移动端：返回知识库列表 */}
            <Link
              href="/knowledge"
              className="md:hidden text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              返回列表
            </Link>
            {article.content_blocks && Array.isArray(article.content_blocks) && (
              <PresentationView
                blocks={article.content_blocks as unknown as ComponentProps<typeof PresentationView>["blocks"]}
                title={article.title}
                autoOpen={autoPresent}
                userGroupId={userGroupId}
                isAdmin={isAdmin}
              />
            )}
            {canEdit && (
              <>
                <Link
                  href={`/knowledge/${id}/edit`}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  编辑
                </Link>
                <div className="ml-6">
                  <KnowledgeDeleteButton articleId={id} canDelete={canEdit} />
                </div>
              </>
            )}
          </div>
        </div>

        {article.type === "video" && article.video_url && (
          <>
            {是抖音链接(article.video_url) ? (
              <抖音视频简化卡片 url={article.video_url} />
            ) : (
              <div className="mb-6 aspect-video bg-gray-900 rounded-lg flex items-center justify-center">
                <a
                  href={article.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white text-sm flex items-center gap-2 hover:text-blue-300"
                >
                  <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  点击播放视频
                </a>
              </div>
            )}
          </>
        )}

        {/* 移动端目录 */}
        {article.content_blocks && Array.isArray(article.content_blocks) && (
          <div className="lg:hidden mb-4">
            <details className="bg-white rounded-xl border border-gray-200">
              <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer select-none">
                查看目录
              </summary>
              <div className="px-4 pb-4 border-t border-gray-100">
                <BlockNoteTOC blocks={article.content_blocks as unknown as ComponentProps<typeof BlockNoteTOC>["blocks"]} />
              </div>
            </details>
          </div>
        )}

        {/* 块级内容渲染 */}
        {article.content_blocks && Array.isArray(article.content_blocks) ? (
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              <BlockNoteRenderer
                blocks={article.content_blocks as unknown as ComponentProps<typeof BlockNoteRenderer>["blocks"]}
                userGroupId={userGroupId}
                isAdmin={isAdmin}
              />
            </div>
            {/* 桌面端目录 */}
            <div className="hidden lg:block w-52 flex-shrink-0">
              <div className="sticky top-20 bg-white rounded-xl border border-gray-200 p-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
                <BlockNoteTOC blocks={article.content_blocks as unknown as ComponentProps<typeof BlockNoteTOC>["blocks"]} />
              </div>
            </div>
          </div>
        ) : article.content ? (
          <div
            className="prose prose-sm max-w-none text-gray-700"
            /* 用户可编辑内容（含 Word 导入）渲染前必须消毒，防 XSS */
            dangerouslySetInnerHTML={{ __html: 消毒Html(article.content) }}
          />
        ) : null}

        {links && links.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">关联维修项目</h3>
            <div className="flex flex-wrap gap-2">
              {(links as unknown as 维修项目关联[]).map((link, i) => (
                <span
                  key={i}
                  className="px-2 py-1 rounded bg-gray-50 text-gray-600 text-xs border border-gray-200"
                >
                  {link.service_names?.name || link.service_items?.name || "-"}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 阅读人列表 */}
        {readCount !== null && readCount >= 0 && (
          <KnowledgeReadList articleId={id} readCount={readCount} />
        )}

        <div className="mt-8">
          <Link
            href="/knowledge"
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            ← 返回知识库
          </Link>
        </div>
      </div>
    </div>
  );
}
