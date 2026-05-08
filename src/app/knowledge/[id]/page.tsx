import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function KnowledgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: article } = await supabase
    .from("knowledge_articles")
    .select("*, knowledge_categories(name), profiles(full_name)")
    .eq("id", id)
    .single();

  if (!article) notFound();

  const { data: links } = await supabase
    .from("knowledge_service_links")
    .select("service_name_id, service_item_id, service_names(name), service_items(name)")
    .eq("article_id", id);

  const { data: vehicleLinks } = await supabase
    .from("knowledge_vehicle_links")
    .select("vehicle_models(id, brand, series, model_name, year_start, year_end)")
    .eq("article_id", id);

  return (
    <div>
      <PageHeader title={article.title} />

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl">
        <div className="flex items-center gap-3 mb-4">
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
          {article.knowledge_categories?.name && (
            <span className="text-xs text-gray-500">{article.knowledge_categories.name}</span>
          )}
          <span className="text-xs text-gray-400">
            {article.profiles?.full_name || "系统"} · {new Date(article.created_at).toLocaleDateString()}
          </span>
        </div>

        {article.type === "video" && article.video_url && (
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

        {article.content && (
          <div
            className="prose prose-sm max-w-none text-gray-700"
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
        )}

        {vehicleLinks && vehicleLinks.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">关联车型</h3>
            <div className="flex flex-wrap gap-2">
              {vehicleLinks.map((vlink: any, i: number) => {
                const vm = vlink.vehicle_models;
                const label = vm ? `${vm.brand} ${vm.series} ${vm.model_name || ""} ${vm.year_start ? vm.year_start + "款" : ""}`.trim() : "-";
                return (
                  <span
                    key={i}
                    className="px-2 py-1 rounded bg-blue-50 text-blue-600 text-xs border border-blue-200"
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {links && links.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">关联维修项目</h3>
            <div className="flex flex-wrap gap-2">
              {links.map((link: any, i: number) => (
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
