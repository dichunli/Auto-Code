"use client";

import {useState, useEffect, useRef, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import { 完成退货记录 } from "@/app/procurement/actions";
import Link from "next/link";

const returnReasonMap: Record<string, string> = {
  wrong_ship: "错发",
  excess: "多发退货",
  damaged: "损坏",
  cancel: "客户悔单",
  quality: "质量问题",
};

const statusMap: Record<string, { label: string; class: string }> = {
  pending: { label: "待处理", class: "bg-yellow-50 text-yellow-700" },
  completed: { label: "已完成", class: "bg-green-50 text-green-700" },
};

interface SupplierReturnRecord {
  id: string;
  work_order_item_part_id: string;
  return_reason: string;
  quantity: number;
  supplier_name: string | null;
  logistics_company: string | null;
  tracking_no: string | null;
  photos: string[] | null;
  status: string;
  created_at: string;
  work_order_item_parts: { name: string | null; part_number: string | null } | null;
  profiles: { full_name: string | null } | null;
  purchase_return_orders: { id: string; return_no: string } | null;
}

export default function SupplierReturnsContent({ initialRecords, initialCount }: { initialRecords: SupplierReturnRecord[]; initialCount: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [records, setRecords] = useState<SupplierReturnRecord[]>(initialRecords);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  /* 分页状态：首屏数据由服务端给（第 1 页），后续搜索/筛选/翻页走 loadRecords */
  const [total, setTotal] = useState(initialCount);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const debouncedQuery = useDebounce(query, 300);
  const mounted = useRef(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function loadRecords(search: string, status: string, 目标页: number) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    const from = (目标页 - 1) * pageSize;
    const 关键词 = search.trim();
    /* 有搜索词时配件表用 !inner 才能按配件名称/编号过滤主表；
       work_order_item_part_id 必填（每条退货记录必关联工单配件），inner 不会丢记录 */
    const 配件关联 = 关键词 ? "work_order_item_parts!inner(name, part_number)" : "work_order_item_parts(name, part_number)";
    let q = supabase
      .from("supplier_return_records")
      .select(`*, ${配件关联}, profiles(full_name), purchase_return_orders(id, return_no)`, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (status) {
      q = q.eq("status", status);
    }
    if (关键词) {
      q = q.or(`supplier_name.ilike.%${关键词}%,work_order_item_parts.name.ilike.%${关键词}%,work_order_item_parts.part_number.ilike.%${关键词}%`);
    }

    const { data, count, error } = await q;
    if (error) {
      alert("加载失败: " + error.message);
      setLoading(false);
      return;
    }

    setRecords((data as unknown as SupplierReturnRecord[]) || []);
    setTotal(count || 0);
    setPage(目标页);
    setLoading(false);
  }

  // 状态筛选/搜索词变化时重新拉取（跳过首次挂载），回到第 1 页
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    loadRecords(debouncedQuery, statusFilter, 1);
  }, [statusFilter, debouncedQuery]);

  /* 标记完成（2026-08-19 收编）：统一走 Server Action → RPC，
     与待退货页签同口径——标记完成时记应收冲减往来账 */
  async function handleComplete(id: string) {
    const res = await 完成退货记录(id);
    if (!res.success) {
      alert("更新失败: " + (res.error || "未知错误"));
      return;
    }
    if (res.accounted === false) {
      alert("已标记完成，但未记往来账（未匹配到供应商或配件无采购价），请到「往来款项」手工补记");
    }
    /* 刷新当前页；状态筛选下标记完成后该条会移出列表，
       若删的是当前页最后一条且不在第 1 页，退到上一页，避免停在空页 */
    const 目标页 = records.length === 1 && page > 1 ? page - 1 : page;
    loadRecords(debouncedQuery, statusFilter, 目标页);
  }

  return (
    <div>
      <PageHeader
        title="退货记录"
        description="管理供应商退货记录"
        action={{ href: "/procurement", label: "采购管理" }}
      />

      {/* 快捷入口 */}
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/return-orders"
          className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          采退单列表
        </Link>
        <Link
          href="/inbound-orders"
          className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
        >
          入库单列表
        </Link>
      </div>

      {/* 筛选栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="搜索配件名称、编号、供应商..."
          className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="completed">已完成</option>
        </select>
        {query.trim() && (
          <button
            onClick={() => setQuery("")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            清空
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">退货原因</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">物流信息</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联采退单</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">退货照片</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">时间</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map((r) => {
                const s = statusMap[r.status] || { label: r.status, class: "bg-gray-50 text-gray-600" };
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{r.work_order_item_parts?.name || "-"}</div>
                      {r.work_order_item_parts?.part_number && (
                        <div className="text-xs text-gray-400">{r.work_order_item_parts.part_number}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{returnReasonMap[r.return_reason] || r.return_reason}</td>
                    <td className="px-6 py-4 text-gray-600">{r.quantity}</td>
                    <td className="px-6 py-4 text-gray-600">{r.supplier_name || "-"}</td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {r.logistics_company && r.tracking_no ? (
                        <div>
                          <div>{r.logistics_company}</div>
                          <div className="text-gray-400">{r.tracking_no}</div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${s.class}`}>{s.label}</span>
                    </td>
                    <td className="px-6 py-4">
                      {r.purchase_return_orders ? (
                        <Link
                          href={`/return-orders/${r.purchase_return_orders.id}`}
                          className="text-xs text-blue-600 hover:text-blue-700"
                        >
                          {r.purchase_return_orders.return_no}
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {r.photos && r.photos.length > 0 ? (
                        <div className="flex gap-1">
                          {r.photos.slice(0, 3).map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                              <img src={url} alt="" loading="lazy" className="w-8 h-8 object-cover rounded border border-gray-200 hover:opacity-80" />
                            </a>
                          ))}
                          {r.photos.length > 3 && (
                            <span className="text-xs text-gray-400 self-center">+{r.photos.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(r.created_at).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-6 py-4">
                      {r.status === "pending" && !r.purchase_return_orders && (
                        <button
                          onClick={async () => {
                            if (await 请求确认("确认标记为已完成？（将按 数量×采购价 记一条退货冲减往来账）")) {
                              handleComplete(r.id);
                            }
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          标记完成
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(!records || records.length === 0) && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                    {loading ? "加载中..." : "暂无退货记录"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页导航：客户端翻页，保留当前搜索/筛选条件 */}
      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadRecords(debouncedQuery, statusFilter, page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <button
              onClick={() => loadRecords(debouncedQuery, statusFilter, page + 1)}
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {确认弹窗}
    </div>
  );
}
