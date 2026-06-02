"use client";

import { useState } from "react";

interface 车型项 {
  vehicle_models: {
    品牌: string;
    车系: string;
    车型: string | null;
    年款: number | null;
  } | null;
}

interface KnowledgeVehicleLinksProps {
  vehicleLinks: 车型项[];
}

export default function KnowledgeVehicleLinks({ vehicleLinks }: KnowledgeVehicleLinksProps) {
  const [弹窗打开, set弹窗打开] = useState(false);

  const 有效车型 = vehicleLinks.filter((v) => v.vehicle_models);

  return (
    <div className="mt-8 pt-6 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">关联车型</h3>
        <button
          type="button"
          onClick={() => set弹窗打开(true)}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          共关联 {有效车型.length} 个车型，点击查看
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {有效车型.slice(0, 8).map((vlink, i) => {
          const vm = vlink.vehicle_models;
          const label = vm
            ? `${vm.品牌} ${vm.车系} ${vm.车型 || ""} ${vm.年款 ? vm.年款 + "款" : ""}`.trim()
            : "-";
          return (
            <span
              key={i}
              className="px-2 py-1 rounded bg-blue-50 text-blue-600 text-xs border border-blue-200"
            >
              {label}
            </span>
          );
        })}
        {有效车型.length > 8 && (
          <span className="px-2 py-1 rounded bg-gray-100 text-gray-500 text-xs border border-gray-200">
            +{有效车型.length - 8}
          </span>
        )}
      </div>

      {弹窗打开 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[70vh] flex flex-col mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">
                关联车型（共 {有效车型.length} 个）
              </h3>
              <button
                type="button"
                onClick={() => set弹窗打开(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-3">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">序号</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">品牌</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">车系</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">车型</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">年款</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {有效车型.map((vlink, i) => {
                    const vm = vlink.vehicle_models!;
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2">{vm.品牌}</td>
                        <td className="px-3 py-2">{vm.车系}</td>
                        <td className="px-3 py-2 text-gray-700">{vm.车型 || "-"}</td>
                        <td className="px-3 py-2 text-gray-500">
                          {vm.年款 ? `${vm.年款}款` : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-gray-200">
              <button
                type="button"
                onClick={() => set弹窗打开(false)}
                className="w-full px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
