"use client";

import { useState } from "react";
import { 标记本机操作 } from "@/lib/localEditSignal";
import { 创建保养单 } from "@/app/vehicles/actions";

interface Props {
  vehicleId: string;
  customerId: string;
  orderId: string;
  orderNo: string;
  plateNumber: string;
  modelInfo: string;
  customerName: string;
}

export function CreateMaintenanceWrapper({
  vehicleId,
  customerId,
  orderId,
  plateNumber,
  modelInfo,
  customerName,
}: Props) {
  const [已有保养单, 设置已有保养单] = useState<{ id: string; order_no: string } | null>(null);
  const [处理中, 设置处理中] = useState(false);

  // 点击：先同步打开空白窗口（防止浏览器拦截弹窗），再异步复制创建
  async function 点击创建() {
    // 必须在用户点击的同步上下文中打开窗口，否则会被浏览器拦截
    const 新窗口 = window.open("", "_blank");
    if (!新窗口) {
      alert("浏览器拦截了新窗口，请允许本站弹窗后重试");
      return;
    }

    设置处理中(true);
    try {
      标记本机操作();

      /* 写库走 Server Action：检查已有 → 清残留草稿 → 建草稿 → 复制需求/项目/配件，
       * 整条流水线在服务端完成，避免客户端 session 异常导致复制半截 */
      const result = await 创建保养单({ vehicleId, customerId, orderId });

      if (!result.success) {
        新窗口.close();
        alert("创建失败: " + (result.error || "未知错误"));
        设置处理中(false);
        return;
      }

      /* 该车辆已有正式保养单：关窗口，弹提示 */
      if (result.existingOrder) {
        新窗口.close();
        设置已有保养单(result.existingOrder);
        设置处理中(false);
        return;
      }

      // 空白窗口跳转到保养单详情页（创建模式 + 编辑模式）
      新窗口.location.href = `/work-orders/${result.orderId}?creating=1&edit=1&from_work_order=${orderId}`;
      设置处理中(false);
    } catch (err: unknown) {
      新窗口.close();
      alert("创建失败: " + (err instanceof Error ? err.message : String(err)));
      设置处理中(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={点击创建}
        disabled={处理中}
        className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
      >
        {处理中 ? "创建中..." : "创建保养单"}
      </button>

      {/* 已有保养单提示 */}
      {已有保养单 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-1">该车辆已有保养单</h3>
            <p className="text-xs text-gray-500 mb-4">
              每辆车只能创建一个保养单，您可以查看或编辑已有的保养单
            </p>

            <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-1 text-sm">
              <div>
                <span className="text-gray-400">车牌: </span>
                <span className="text-gray-800 font-medium">{plateNumber || "—"}</span>
              </div>
              <div>
                <span className="text-gray-400">车型: </span>
                <span className="text-gray-800">{modelInfo || "—"}</span>
              </div>
              <div>
                <span className="text-gray-400">客户: </span>
                <span className="text-gray-800">{customerName || "—"}</span>
              </div>
              <div>
                <span className="text-gray-400">已有保养单: </span>
                <span className="text-gray-800 font-medium">{已有保养单.order_no}</span>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => 设置已有保养单(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  设置已有保养单(null);
                  window.open(`/work-orders/${已有保养单.id}`, "_blank");
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                查看保养单
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
