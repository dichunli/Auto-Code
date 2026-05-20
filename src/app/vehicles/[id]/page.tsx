import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function VehicleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from_work_order?: string }>;
}) {
  const { id } = await params;
  const { from_work_order } = await searchParams;
  const supabase = await createClient();

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("id, plate_number, brand, model, vin, engine_no, color, year, mileage, notes, customer_id, customers(id, name, phone), companies(id, name), vehicle_model_id, vehicle_models(*), created_at")
    .eq("id", id)
    .single();

  if (!vehicle) {
    notFound();
  }

  /* 查询该车辆历史工单 */
  const { data: workOrders } = await supabase
    .from("work_orders")
    .select("id, order_no, status, mileage_in, created_at, total_amount")
    .eq("vehicle_id", id)
    .order("created_at", { ascending: false });

  const customer = vehicle.customers as any;
  const company = vehicle.companies as any;
  const model = (Array.isArray(vehicle.vehicle_models) ? vehicle.vehicle_models[0] : vehicle.vehicle_models) as any;

  return (
    <div>
      <PageHeader
        title="车辆详情"
        description={`${vehicle.plate_number} 的档案信息`}
        action={{ href: `/vehicles/${id}/edit`, label: "编辑车辆" }}
      />

      {/* 返回工单按钮 */}
      {from_work_order && (
        <div className="mb-4">
          <Link
            href={`/work-orders/${from_work_order}`}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回工单
          </Link>
        </div>
      )}

      <div className="space-y-6 max-w-4xl">
        {/* 基本信息 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">基本信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">车牌号：</span>
              <span className="text-gray-900 font-medium">{vehicle.plate_number || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">品牌：</span>
              <span className="text-gray-900">{vehicle.brand || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">车型：</span>
              <span className="text-gray-900">{vehicle.model || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">VIN：</span>
              <span className="text-gray-900 font-mono">{vehicle.vin || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">发动机号：</span>
              <span className="text-gray-900">{vehicle.engine_no || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">颜色：</span>
              <span className="text-gray-900">{vehicle.color || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">年份：</span>
              <span className="text-gray-900">{vehicle.year || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">里程：</span>
              <span className="text-gray-900">{vehicle.mileage != null ? `${vehicle.mileage} km` : "-"}</span>
            </div>
            <div className="sm:col-span-3">
              <span className="text-gray-500">备注：</span>
              <span className="text-gray-900">{vehicle.notes || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">注册时间：</span>
              <span className="text-gray-900">{formatDate(vehicle.created_at)}</span>
            </div>
          </div>
        </div>

        {/* 车型信息 */}
        {model && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">车型信息</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              {model.厂商 && (
                <div><span className="text-gray-500">厂商：</span><span className="text-gray-900">{model.厂商}</span></div>
              )}
              {model.车辆类型 && (
                <div><span className="text-gray-500">车辆类型：</span><span className="text-gray-900">{model.车辆类型}</span></div>
              )}
              {model.年款 && (
                <div><span className="text-gray-500">年款：</span><span className="text-gray-900">{model.年款}</span></div>
              )}
              {model.车系 && (
                <div><span className="text-gray-500">车系：</span><span className="text-gray-900">{model.车系}</span></div>
              )}
              {model.车型 && (
                <div><span className="text-gray-500">车型：</span><span className="text-gray-900">{model.车型}</span></div>
              )}
              {model.销售版本 && (
                <div><span className="text-gray-500">销售版本：</span><span className="text-gray-900">{model.销售版本}</span></div>
              )}
              {model.销售名称 && (
                <div><span className="text-gray-500">销售名称：</span><span className="text-gray-900">{model.销售名称}</span></div>
              )}
              {model.排量 && (
                <div><span className="text-gray-500">排量：</span><span className="text-gray-900">{model.排量}</span></div>
              )}
              {model.发动机型号 && (
                <div><span className="text-gray-500">发动机型号：</span><span className="text-gray-900">{model.发动机型号}</span></div>
              )}
              {model.燃油类型 && (
                <div><span className="text-gray-500">燃油类型：</span><span className="text-gray-900">{model.燃油类型}</span></div>
              )}
              {model.燃油标号 && (
                <div><span className="text-gray-500">燃油标号：</span><span className="text-gray-900">{model.燃油标号}</span></div>
              )}
              {model.进气形式 && (
                <div><span className="text-gray-500">进气形式：</span><span className="text-gray-900">{model.进气形式}</span></div>
              )}
              {model.排放标准 && (
                <div><span className="text-gray-500">排放标准：</span><span className="text-gray-900">{model.排放标准}</span></div>
              )}
              {model.功率 && (
                <div><span className="text-gray-500">功率：</span><span className="text-gray-900">{model.功率} kW</span></div>
              )}
              {model.马力 && (
                <div><span className="text-gray-500">马力：</span><span className="text-gray-900">{model.马力} PS</span></div>
              )}
              {model.驱动方式 && (
                <div><span className="text-gray-500">驱动方式：</span><span className="text-gray-900">{model.驱动方式}</span></div>
              )}
              {model.变速箱类型 && (
                <div><span className="text-gray-500">变速箱类型：</span><span className="text-gray-900">{model.变速箱类型}</span></div>
              )}
              {model.变速箱代号 && (
                <div><span className="text-gray-500">变速箱代号：</span><span className="text-gray-900">{model.变速箱代号}</span></div>
              )}
              {model.档位数 && (
                <div><span className="text-gray-500">档位数：</span><span className="text-gray-900">{model.档位数}</span></div>
              )}
              {model.底盘代号 && (
                <div><span className="text-gray-500">底盘代号：</span><span className="text-gray-900">{model.底盘代号}</span></div>
              )}
              {model.车身类型 && (
                <div><span className="text-gray-500">车身类型：</span><span className="text-gray-900">{model.车身类型}</span></div>
              )}
              {model.车门数 && (
                <div><span className="text-gray-500">车门数：</span><span className="text-gray-900">{model.车门数}</span></div>
              )}
              {model.座位数 && (
                <div><span className="text-gray-500">座位数：</span><span className="text-gray-900">{model.座位数}</span></div>
              )}
              {model.车身尺寸 && (
                <div><span className="text-gray-500">车身尺寸：</span><span className="text-gray-900">{model.车身尺寸}</span></div>
              )}
              {model.轴距 && (
                <div><span className="text-gray-500">轴距：</span><span className="text-gray-900">{model.轴距} mm</span></div>
              )}
              {model.前轮距 && (
                <div><span className="text-gray-500">前轮距：</span><span className="text-gray-900">{model.前轮距} mm</span></div>
              )}
              {model.后轮距 && (
                <div><span className="text-gray-500">后轮距：</span><span className="text-gray-900">{model.后轮距} mm</span></div>
              )}
              {model.整备质量 && (
                <div><span className="text-gray-500">整备质量：</span><span className="text-gray-900">{model.整备质量} kg</span></div>
              )}
              {model.前轮胎规格 && (
                <div><span className="text-gray-500">前轮胎规格：</span><span className="text-gray-900">{model.前轮胎规格}</span></div>
              )}
              {model.后轮胎规格 && (
                <div><span className="text-gray-500">后轮胎规格：</span><span className="text-gray-900">{model.后轮胎规格}</span></div>
              )}
              {model.厂商指导价 && (
                <div><span className="text-gray-500">厂商指导价：</span><span className="text-gray-900">{formatCurrency(model.厂商指导价)}</span></div>
              )}
            </div>
          </div>
        )}

        {/* 关联客户 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">关联客户</h2>
          {customer ? (
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="text-gray-500">客户姓名：</span>
                <Link
                  href={`/customers/${customer.id}${from_work_order ? `?from_work_order=${from_work_order}` : ""}`}
                  className="text-blue-600 hover:underline font-medium"
                >
                  {customer.name}
                </Link>
              </div>
              <div>
                <span className="text-gray-500">电话：</span>
                <span className="text-gray-900">{customer.phone || "-"}</span>
              </div>
              {company?.name && (
                <div>
                  <span className="text-gray-500">单位：</span>
                  <span className="text-gray-900">{company.name}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">未关联客户</p>
          )}
        </div>

        {/* 历史工单 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">历史工单</h2>
          {workOrders && workOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">工单号</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">状态</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">接车里程</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">金额</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">日期</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {workOrders.map((wo) => (
                    <tr key={wo.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/work-orders/${wo.id}`} className="text-blue-600 hover:underline font-medium">
                          {wo.order_no || wo.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          wo.status === "completed" ? "bg-green-100 text-green-700" :
                          wo.status === "in_progress" ? "bg-blue-100 text-blue-700" :
                          wo.status === "cancelled" ? "bg-gray-100 text-gray-600" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>
                          {wo.status === "completed" ? "已完成" :
                           wo.status === "in_progress" ? "维修中" :
                           wo.status === "cancelled" ? "已取消" :
                           wo.status === "quoted" ? "已报价" : "待处理"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{wo.mileage_in ? `${wo.mileage_in} km` : "-"}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(wo.total_amount || 0)}</td>
                      <td className="px-4 py-3">{formatDate(wo.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-400">暂无历史工单</p>
          )}
        </div>
      </div>
    </div>
  );
}
