"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";

interface 操作日志 {
  id: string;
  user_name: string | null;
  action_type: string;
  target_table: string | null;
  target_name: string | null;
  description: string | null;
  old_values: unknown;
  new_values: unknown;
  ip_address: string | null;
  created_at: string;
}

const actionTypeMap: Record<string, string> = {
  login: "登录",
  logout: "登出",
  work_order_create: "创建工单",
  work_order_update: "修改工单",
  work_order_delete: "删除工单",
  work_order_status_change: "工单状态变更",
  work_order_assign: "工单指派",
  work_order_settle: "工单结算",
  work_order_convert: "工单转换",
  customer_create: "创建客户",
  customer_update: "修改客户",
  customer_delete: "删除客户",
  vehicle_create: "创建车辆",
  vehicle_update: "修改车辆",
  vehicle_delete: "删除车辆",
  part_in: "配件入库",
  part_out: "配件出库",
  part_adjust: "库存调整",
  payment_create: "收款",
  payment_refund: "退款",
  purchase_order_create: "创建采购单",
  purchase_order_update: "修改采购单",
  purchase_order_arrive: "采购到货",
  construction_start: "开始施工",
  construction_pause: "暂停施工",
  construction_complete: "完成施工",
  quality_check: "质检",
  follow_up_create: "创建回访",
  inventory_check: "盘点",
  finance_transaction: "财务交易",
};

const actionTypes = Object.entries(actionTypeMap).map(([value, label]) => ({ value, label }));

interface Props {
  initialLogs: 操作日志[];
  initialCount: number;
  actionType: string;
  userName: string;
  keyword: string;
}

export default function OperationLogsContent({ initialLogs, initialCount, actionType, userName, keyword }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [logs, setLogs] = useState<操作日志[]>(initialLogs);
  /* 分页状态：首屏数据由服务端给（第 1 页），后续翻页走 loadLogs */
  const [total, setTotal] = useState(initialCount);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function loadLogs(目标页: number) {
    /* 客户端 session 丢失时不查询，避免空结果覆盖服务端数据 */
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    const from = (目标页 - 1) * pageSize;

    /* 与服务端 page.tsx 保持一致的筛选逻辑 */
    let q = supabase
      .from("operation_logs")
      .select("id, user_name, action_type, target_table, target_name, description, old_values, new_values, ip_address, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (actionType) {
      q = q.eq("action_type", actionType);
    }
    if (userName) {
      q = q.ilike("user_name", `%${userName}%`);
    }
    if (keyword) {
      q = q.or(`description.ilike.%${keyword}%,target_name.ilike.%${keyword}%`);
    }

    const { data, count, error } = await q;
    if (error) {
      console.error("操作日志加载失败:", error);
      alert("加载失败: " + error.message);
    } else {
      setLogs((data as unknown as 操作日志[]) || []);
      setTotal(count || 0);
      setPage(目标页);
    }
    setLoading(false);
  }

  return (
    <div>
      <PageHeader
        title="操作日志"
        description="查看系统所有操作记录"
      />

      {/* 筛选：表单 GET 提交走 URL，服务端重新取第 1 页（组件按 key 重挂载回到第 1 页） */}
      <form className="flex flex-wrap items-center gap-3 mb-6">
        <select
          name="actionType"
          defaultValue={actionType}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">全部操作类型</option>
          {actionTypes.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          type="text"
          name="userName"
          defaultValue={userName}
          placeholder="操作人"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-32"
        />
        <input
          type="text"
          name="keyword"
          defaultValue={keyword}
          placeholder="搜索描述或对象"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-48"
        />
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          搜索
        </button>
      </form>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">时间</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">操作人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">操作类型</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">对象</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">描述</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">IP地址</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">变更</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs?.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(log.created_at)}</td>
                  <td className="px-4 py-3 text-gray-900">{log.user_name || "-"}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">
                      {actionTypeMap[log.action_type] || log.action_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {log.target_name || log.target_table || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-900 max-w-md truncate">{log.description}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{log.ip_address || "-"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">
                    {log.old_values || log.new_values ? (
                      <span title={JSON.stringify({ 前: log.old_values, 后: log.new_values }, null, 2)}>
                        有变更
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
              {(!logs || logs.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    {loading ? "加载中..." : "暂无操作日志"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页导航：客户端翻页，保留当前筛选条件 */}
      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadLogs(page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => loadLogs(page + 1)}
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
