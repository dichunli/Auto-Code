import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";

interface 文章记录 {
  id: string;
  created_at: string;
  created_by: string | null;
  profiles: { full_name: string | null } | null;
}

interface 月份统计 {
  月份: string;
  数量: number;
}

interface 提交人统计 {
  提交人: string;
  数量: number;
}

export default async function KnowledgeArticleStatsPage() {
  const supabase = await createClient();

  const { data: articles } = await supabase
    .from("knowledge_articles")
    .select("id, created_at, created_by, profiles(full_name)")
    .order("created_at", { ascending: false })
    .returns<文章记录[]>();

  /* 按月统计 */
  const 月份统计映射 = new Map<string, number>();
  /* 按提交人统计 */
  const 提交人统计映射 = new Map<string, number>();

  (articles || []).forEach((article) => {
    const 月份 = article.created_at.slice(0, 7);
    月份统计映射.set(月份, (月份统计映射.get(月份) || 0) + 1);

    const 提交人 = article.profiles?.full_name || "未知用户";
    提交人统计映射.set(提交人, (提交人统计映射.get(提交人) || 0) + 1);
  });

  const 月份统计列表: 月份统计[] = Array.from(月份统计映射.entries())
    .map(([月份, 数量]) => ({ 月份, 数量 }))
    .sort((a, b) => b.月份.localeCompare(a.月份));

  const 提交人统计列表: 提交人统计[] = Array.from(提交人统计映射.entries())
    .map(([提交人, 数量]) => ({ 提交人, 数量 }))
    .sort((a, b) => b.数量 - a.数量);

  /* 本月提交数量 */
  const 当前日期 = new Date();
  const 当前年月 = `${当前日期.getFullYear()}-${String(当前日期.getMonth() + 1).padStart(2, "0")}`;
  const 本月数量 = 月份统计映射.get(当前年月) || 0;

  return (
    <div className="space-y-6">
      <PageHeader title="知识库文章统计" description="按月与提交人统计知识库文章提交情况" />

      {/* 本月数量卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
          <p className="text-sm text-blue-600 mb-1">本月提交数量</p>
          <p className="text-3xl font-bold text-blue-700">{本月数量}</p>
          <p className="text-xs text-blue-500 mt-2">仅统计当前已保留的文章</p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-6">
          <p className="text-sm text-gray-600 mb-1">文章总数</p>
          <p className="text-3xl font-bold text-gray-700">{(articles || []).length}</p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-6">
          <p className="text-sm text-gray-600 mb-1">提交人数</p>
          <p className="text-3xl font-bold text-gray-700">{提交人统计映射.size}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                  <th className="text-right px-5 py-3 font-medium">提交数量</th>
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

        {/* 按提交人统计 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">按提交人统计</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">提交人</th>
                  <th className="text-right px-5 py-3 font-medium">提交数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {提交人统计列表.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-5 py-8 text-center text-gray-400">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  提交人统计列表.map((项) => (
                    <tr key={项.提交人} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-gray-700">{项.提交人}</td>
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
