import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { redirect } from "next/navigation";

interface 文章记录 {
  id: string;
  title: string;
  type: string;
  created_at: string;
  visibility: string;
  category_name?: string | null;
}

interface 月份统计 {
  月份: string;
  数量: number;
}

const 类型标签映射: Record<string, { label: string; className: string }> = {
  video: { label: "视频", className: "bg-red-50 text-red-700" },
  qa: { label: "问答", className: "bg-green-50 text-green-700" },
  guide: { label: "维修指导", className: "bg-orange-50 text-orange-700" },
  article: { label: "文章", className: "bg-blue-50 text-blue-700" },
};

function 类型标签(type: string) {
  const config = 类型标签映射[type] || 类型标签映射.article;
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${config.className}`}>
      {config.label}
    </span>
  );
}

function 权限标签(visibility: string) {
  const map: Record<string, { label: string; className: string }> = {
    public: { label: "公开", className: "bg-green-50 text-green-700" },
    internal: { label: "内部", className: "bg-blue-50 text-blue-700" },
    private: { label: "私有", className: "bg-gray-100 text-gray-600" },
    role: { label: "岗位", className: "bg-purple-50 text-purple-700" },
  };
  const config = map[visibility] || map.public;
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${config.className}`}>
      {config.label}
    </span>
  );
}

export default async function MyKnowledgePage() {
  const supabase = await createClient();

  const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null; /* getSession本地读不联网（2026-09-03） */
  if (!user) {
    redirect("/login");
  }

  const { data: articles } = await supabase
    .from("knowledge_articles")
    .select("id, title, type, created_at, visibility, knowledge_categories(name)")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false })
    .returns<文章记录[]>();

  /* 按月统计 */
  const 月份统计映射 = new Map<string, number>();
  (articles || []).forEach((article) => {
    const 月份 = article.created_at.slice(0, 7);
    月份统计映射.set(月份, (月份统计映射.get(月份) || 0) + 1);
  });

  const 月份统计列表: 月份统计[] = Array.from(月份统计映射.entries())
    .map(([月份, 数量]) => ({ 月份, 数量 }))
    .sort((a, b) => b.月份.localeCompare(a.月份));

  /* 本月数量 */
  const 当前日期 = new Date();
  const 当前年月 = `${当前日期.getFullYear()}-${String(当前日期.getMonth() + 1).padStart(2, "0")}`;
  const 本月数量 = 月份统计映射.get(当前年月) || 0;

  return (
    <div className="space-y-6">
      <PageHeader title="我的文章" description="查看我提交的知识库文章列表与统计" />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
          <p className="text-sm text-blue-600 mb-1">本月提交</p>
          <p className="text-3xl font-bold text-blue-700">{本月数量}</p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-6">
          <p className="text-sm text-gray-600 mb-1">文章总数</p>
          <p className="text-3xl font-bold text-gray-700">{(articles || []).length}</p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-6">
          <p className="text-sm text-gray-600 mb-1">有提交的月份</p>
          <p className="text-3xl font-bold text-gray-700">{月份统计映射.size}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 文章列表 */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">文章列表</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {(articles || []).length === 0 ? (
              <div className="px-5 py-12 text-center text-gray-400">
                暂无提交的文章
              </div>
            ) : (
              (articles || []).map((article) => (
                <Link
                  key={article.id}
                  href={`/knowledge/${article.id}`}
                  className="block px-5 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {类型标签(article.type)}
                    {权限标签(article.visibility)}
                    {article.category_name && (
                      <span className="text-xs text-gray-500">{article.category_name}</span>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-gray-900 mb-1">{article.title}</h3>
                  <p className="text-xs text-gray-400">
                    {new Date(article.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* 按月统计 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">按月统计</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">月份</th>
                  <th className="text-right px-5 py-3 font-medium">数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {月份统计列表.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-5 py-8 text-center text-gray-400">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  月份统计列表.map((项) => (
                    <tr key={项.月份} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-gray-700">{项.月份}</td>
                      <td className="px-5 py-3 text-right text-gray-900 font-medium">{项.数量}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
