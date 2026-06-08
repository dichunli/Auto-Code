export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlockNoteRenderer } from "@/components/BlockNoteRenderer";
import { BlockNoteTOC } from "@/components/BlockNoteTOC";
import { PresentationView } from "@/components/PresentationView";
import { KnowledgeDeleteButton } from "@/components/KnowledgeDeleteButton";
import KnowledgeVehicleLinks from "@/components/KnowledgeVehicleLinks";
import { 是抖音链接, 抖音视频简化卡片 } from "@/components/DouyinVideo";

interface 维修项目关联 {
  service_names: { name: string } | null;
  service_items: { name: string } | null;
}

interface 阅读记录 {
  user_id: string;
  read_date: string;
  created_at: string;
  full_name: string;
}

interface BlockItem {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown[];
  children?: BlockItem[];
}

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

  const { data: article } = await supabase
    .from("knowledge_articles")
    .select("*, knowledge_categories(name), profiles(full_name)")
    .eq("id", id)
    .single();

  /* 查询阅读次数 */
  const { count: readCount } = await supabase
    .from("knowledge_article_reads")
    .select("*", { count: "exact", head: true })
    .eq("article_id", id);

  /* 查询阅读记录，再单独查用户名 */
  const { data: readsRaw } = await supabase
    .from("knowledge_article_reads")
    .select("user_id, read_date, created_at")
    .eq("article_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  let readList: 阅读记录[] = [];
  if (readsRaw && readsRaw.length > 0) {
    const userIds = [...new Set(readsRaw.map((r) => r.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    const profileMap = new Map((profiles || []).map((p) => [p.id, p.full_name]));
    readList = readsRaw.map((r) => ({
      user_id: r.user_id,
      read_date: r.read_date,
      created_at: r.created_at,
      full_name: profileMap.get(r.user_id) || "未知用户",
    }));
  }

  /* 记录阅读（登录用户才记录，不阻塞页面加载） */
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    void supabase.from("knowledge_article_reads").upsert(
      { article_id: id, user_id: user.id },
      { onConflict: "article_id,user_id,read_date" }
    ).then(() => {}).catch(() => {});
  }

  if (!article) notFound();

  const { data: links } = await supabase
    .from("knowledge_service_links")
    .select("service_name_id, service_item_id, service_names(name), service_items(name)")
    .eq("article_id", id);

  const { data: vehicleLinks } = await supabase
    .from("knowledge_vehicle_links")
    .select("vehicle_models(id, 厂商, 品牌, 车系, 车型, 销售版本, 年款, 排量, 发动机型号, 燃油类型, 进气形式, 变速箱类型, 变速箱代号, 底盘代号, 驱动方式, 车身类型, 排放标准)")
    .eq("article_id", id);

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
            {article.content_blocks && Array.isArray(article.content_blocks) && (
              <PresentationView blocks={article.content_blocks as BlockItem[]} title={article.title} autoOpen={autoPresent} />
            )}
            <Link
              href={`/knowledge/${id}/edit`}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              编辑
            </Link>
            <KnowledgeDeleteButton articleId={id} />
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
                <BlockNoteTOC blocks={article.content_blocks as BlockItem[]} />
              </div>
            </details>
          </div>
        )}

        {/* 块级内容渲染 */}
        {article.content_blocks && Array.isArray(article.content_blocks) ? (
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              <BlockNoteRenderer blocks={article.content_blocks as BlockItem[]} />
            </div>
            {/* 桌面端目录 */}
            <div className="hidden lg:block w-52 flex-shrink-0">
              <div className="sticky top-20 bg-white rounded-xl border border-gray-200 p-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
                <BlockNoteTOC blocks={article.content_blocks as BlockItem[]} />
              </div>
            </div>
          </div>
        ) : article.content ? (
          <div
            className="prose prose-sm max-w-none text-gray-700"
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
        ) : null}

        {vehicleLinks && vehicleLinks.length > 0 && (
          <KnowledgeVehicleLinks vehicleLinks={vehicleLinks} />
        )}

        {links && links.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">关联维修项目</h3>
            <div className="flex flex-wrap gap-2">
              {links.map((link: 维修项目关联, i: number) => (
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
        {readList && readList.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-100">
            <details className="bg-gray-50 rounded-lg border border-gray-200">
              <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center justify-between">
                <span>📖 阅读记录（{readList.length} 人）</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-4 pb-4 border-t border-gray-100">
                <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                  {readList.map((record, index) => (
                    <div key={index} className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-white">
                      <span className="text-gray-700">{record.full_name}</span>
                      <span className="text-gray-400 text-xs">{new Date(record.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </div>
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
