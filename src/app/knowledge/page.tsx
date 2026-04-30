import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function KnowledgePage() {
  const supabase = await createClient();
  const { data: articles } = await supabase
    .from("knowledge_articles")
    .select("*, knowledge_categories(name), profiles(full_name)")
    .order("created_at", { ascending: false });

  const { data: categories } = await supabase
    .from("knowledge_categories")
    .select("*")
    .order("sort_order", { ascending: true });

  return (
    <div>
      <PageHeader
        title="知识库"
        description="维修指导、视频教程、常见问题"
        action={{ href: "/knowledge/new", label: "新建知识" }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 分类侧边栏 */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">分类</h3>
            <div className="space-y-1">
              <Link
                href="/knowledge"
                className="block px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                全部
              </Link>
              {categories?.map((c: any) => (
                <Link
                  key={c.id}
                  href={`/knowledge?category=${c.id}`}
                  className="block px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* 文章列表 */}
        <div className="lg:col-span-3 space-y-4">
          {articles?.map((a: any) => (
            <Link
              key={a.id}
              href={`/knowledge/${a.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        a.type === "video"
                          ? "bg-red-50 text-red-700"
                          : a.type === "qa"
                          ? "bg-green-50 text-green-700"
                          : "bg-blue-50 text-blue-700"
                      }`}
                    >
                      {a.type === "video" ? "视频" : a.type === "qa" ? "问答" : "文章"}
                    </span>
                    {a.knowledge_categories?.name && (
                      <span className="text-xs text-gray-500">
                        {a.knowledge_categories.name}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">
                    {a.title}
                  </h3>
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {a.content?.replace(/<[^>]*>/g, "").slice(0, 120) || "暂无内容"}
                  </p>
                  <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                    <span>{a.profiles?.full_name || "系统"}</span>
                    <span>{new Date(a.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
          {(!articles || articles.length === 0) && (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
              暂无知识库内容
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
