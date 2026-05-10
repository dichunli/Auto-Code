import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";

export default async function OperationLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ actionType?: string; userName?: string; keyword?: string }>;
}) {
  const { actionType, userName, keyword } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("operation_logs")
    .select("id, user_name, action_type, target_table, target_name, description, old_values, new_values, ip_address, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (actionType) {
    query = query.eq("action_type", actionType);
  }
  if (userName) {
    query = query.ilike("user_name", `%${userName}%`);
  }
  if (keyword) {
    query = query.or(`description.ilike.%${keyword}%,target_name.ilike.%${keyword}%`);
  }

  const { data: logs } = await query;

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

  return (
    <div>
      <PageHeader
        title="操作日志"
        description="查看系统所有操作记录"
      />

      {/* 筛选 */}
      <form className="flex flex-wrap items-center gap-3 mb-6">
        <select
          name="actionType"
          defaultValue={actionType || ""}
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
          defaultValue={userName || ""}
          placeholder="操作人"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-32"
        />
        <input
          type="text"
          name="keyword"
          defaultValue={keyword || ""}
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
              {logs?.map((log: any) => (
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
                    暂无操作日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
