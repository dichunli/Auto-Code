import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import { 清理搜索词 } from "@/lib/sanitizeQuery";
import Link from "next/link";

export default async function MembersPage({ searchParams }: { searchParams?: Promise<{ status?: string; q?: string; page?: string }> }) {
  const { status, q, page: pageParam } = (await searchParams) || {};
  const supabase = await createClient();

  /* 分页：每页 20 条，防止会员量增长后全量拉取拖慢页面 */
  const pageSize = 20;
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("members").select("*, customers(name, phone)", { count: "exact" });

  if (status && status !== "all") query = query.eq("status", status);
  if (q) {
    // 清理输入中的过滤器特殊字符，防止破坏 PostgREST 过滤器语法
    const safeQ = 清理搜索词(q);
    if (safeQ) {
      query = query.or(`name.ilike.%${safeQ}%,phone.ilike.%${safeQ}%,card_no.ilike.%${safeQ}%`);
    }
  }

  const { data: members, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const statusMap: Record<string, string> = {
    active: "正常",
    frozen: "冻结",
    expired: "过期",
  };

  const statusColor: Record<string, string> = {
    active: "bg-green-50 text-green-700",
    frozen: "bg-orange-50 text-orange-700",
    expired: "bg-gray-50 text-gray-500",
  };

  return (
    <div>
      <PageHeader title="会员管理" description={`共 ${count || 0} 位会员`} />

      <div className="flex flex-col sm:flex-row gap-3 mb-4 items-start sm:items-center justify-between">
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q || ""}
            placeholder="搜索卡号/姓名/手机号"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-56"
          />
          <select
            name="status"
            defaultValue={status || "all"}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="all">全部状态</option>
            <option value="active">正常</option>
            <option value="frozen">冻结</option>
            <option value="expired">过期</option>
          </select>
          <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            搜索
          </button>
        </form>
        <Link
          href="/members/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + 新增会员
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">会员卡号</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">姓名</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">手机号</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">余额</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">折扣</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members?.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/members/${m.id}`} className="text-blue-600 hover:text-blue-700">
                    {m.card_no}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-900">{m.name}</td>
                <td className="px-4 py-3 text-gray-600">{m.phone || "-"}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(m.balance)}</td>
                <td className="px-4 py-3 text-gray-600">{m.discount_rate < 1 ? `${(m.discount_rate * 100).toFixed(0)}折` : "无折扣"}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${statusColor[m.status] || "bg-gray-50 text-gray-500"}`}>
                    {statusMap[m.status] || m.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{m.notes || "-"}</td>
              </tr>
            ))}
            {(!members || members.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  暂无会员数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页导航：保留搜索条件，仅切换页码 */}
      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const 构造链接 = (目标页: number) => {
                const params = new URLSearchParams();
                if (q) params.set("q", q);
                if (status && status !== "all") params.set("status", status);
                params.set("page", String(目标页));
                return `/members?${params.toString()}`;
              };
              return (
                <>
                  {page > 1 ? (
                    <Link href={构造链接(page - 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                      上一页
                    </Link>
                  ) : (
                    <span className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-300">上一页</span>
                  )}
                  {page < totalPages ? (
                    <Link href={构造链接(page + 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                      下一页
                    </Link>
                  ) : (
                    <span className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-300">下一页</span>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
