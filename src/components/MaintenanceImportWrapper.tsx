"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { 标记本机操作 } from "@/lib/localEditSignal";
import { 保养单草稿前缀, 找重复项目名 } from "@/lib/maintenance";
import { 导入保养单到工单 } from "@/app/vehicles/actions";
import type { 保养导入项目, 保养导入配件 } from "@/app/vehicles/actions";

interface Props {
  vehicleId: string;
  orderId: string;
}

interface 保养单 {
  id: string;
  order_no: string;
  created_at: string;
  mileage_in: number | null;
  customers: { name: string; phone: string } | null;
  vehicles: { plate_number: string; vin: string } | null;
}

interface 保养项目 {
  id: string;
  name: string;
  item_type: string;
  quantity: number;
  unit_price: number;
  description: string | null;
  service_item_id: string | null;
  mechanic_id: string | null;
}

interface 保养配件 {
  id: string;
  work_order_item_id: string;
  name: string;
  part_number: string | null;
  unit: string | null;
  brand: string | null;
  specification: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number | null;
  notes: string | null;
  part_name_id: string | null;
  part_id: string | null;
}

export function MaintenanceImportWrapper({ vehicleId, orderId }: Props) {
  const [show, setShow] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShow(true)}
        className="text-sm text-purple-600 hover:text-purple-700 font-medium"
      >
        从保养单导入
      </button>
      {show && (
        <MaintenanceImportModal
          vehicleId={vehicleId}
          orderId={orderId}
          onClose={() => setShow(false)}
        />
      )}
    </>
  );
}

function MaintenanceImportModal({ vehicleId, orderId, onClose }: Props & { onClose: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const [保养单, 设置保养单] = useState<保养单 | null>(null);
  const [项目列表, 设置项目列表] = useState<保养项目[]>([]);
  const [配件映射, 设置配件映射] = useState<Record<string, 保养配件[]>>({});
  const [选中项目ID, 设置选中项目ID] = useState<Set<string>>(new Set());
  const [选中配件ID, 设置选中配件ID] = useState<Record<string, Set<string>>>({});
  const [信息校验, 设置信息校验] = useState<{
    车牌一致: boolean;
    VIN一致: boolean;
    手机号一致: boolean;
  } | null>(null);
  const [导入中, 设置导入中] = useState(false);
  const [加载中, 设置加载中] = useState(true);
  // 重复项目处理
  const [重复项目名, 设置重复项目名] = useState<string[]>([]);
  const [显示重复确认, 设置显示重复确认] = useState(false);

  // 加载保养单及项目配件
  useEffect(() => {
    if (!vehicleId) return;

    async function 加载数据() {
      /* 保养单查询与当前工单校验无依赖，并行发起（原来串行 4 轮等待，
       * 网络慢时打开弹窗要等很久；并行后省一整轮） */
      const [保养单结果, 当前工单结果] = await Promise.all([
        supabase
          .from("work_orders")
          .select("id, order_no, created_at, mileage_in, customers(name, phone), vehicles(plate_number, vin)")
          .eq("vehicle_id", vehicleId)
          .eq("order_type", "maintenance")
          .not("order_no", "like", 保养单草稿前缀 + "%")
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
        supabase
          .from("work_orders")
          .select("vehicles(plate_number, vin), customers(phone)")
          .eq("id", orderId)
          .single(),
      ]);

      const 保养单数据 = 保养单结果.data;
      if (!保养单数据) {
        设置加载中(false);
        return;
      }

      /* supabase 关联查询推导类型与 保养单 接口重叠不足，先转 unknown 再断言 */
      const 保养单 = 保养单数据 as unknown as 保养单;
      设置保养单(保养单);

      const 当前工单 = 当前工单结果.data;
      const 当前车辆 = (当前工单 as Record<string, unknown> | null)?.vehicles as { plate_number: string; vin: string } | null;
      const 当前客户 = (当前工单 as Record<string, unknown> | null)?.customers as { phone: string } | null;

      设置信息校验({
        车牌一致: (当前车辆?.plate_number || "") === (保养单.vehicles?.plate_number || ""),
        VIN一致: (当前车辆?.vin || "") === (保养单.vehicles?.vin || ""),
        手机号一致: (当前客户?.phone || "") === (保养单.customers?.phone || ""),
      });

      // 加载项目（含备注）
      const { data: 项目数据 } = await supabase
        .from("work_order_items")
        .select("id, name, item_type, quantity, unit_price, description, service_item_id, mechanic_id")
        .eq("work_order_id", 保养单.id)
        .order("created_at", { ascending: true });

      const 项目列表 = (项目数据 || []) as 保养项目[];
      设置项目列表(项目列表);

      // 加载配件（含编码、单位、备注）
      if (项目列表.length > 0) {
        const { data: 配件数据 } = await supabase
          .from("work_order_item_parts")
          .select("id, work_order_item_id, name, part_number, unit, brand, specification, quantity, unit_price, unit_cost, notes, part_name_id, part_id")
          .in("work_order_item_id", 项目列表.map((i) => i.id))
          .order("created_at", { ascending: true });

        const 映射: Record<string, 保养配件[]> = {};
        for (const 配件 of 配件数据 || []) {
          if (!映射[配件.work_order_item_id]) {
            映射[配件.work_order_item_id] = [];
          }
          映射[配件.work_order_item_id].push(配件);
        }
        设置配件映射(映射);

        // 默认全选所有项目
        设置选中项目ID(new Set(项目列表.map((i) => i.id)));
        const 全部配件: Record<string, Set<string>> = {};
        for (const 项目 of 项目列表) {
          const 配件列表 = 映射[项目.id] || [];
          if (配件列表.length > 0) {
            全部配件[项目.id] = new Set(配件列表.map((p) => p.id));
          }
        }
        设置选中配件ID(全部配件);
      }

      设置加载中(false);
    }

    加载数据();
  }, [vehicleId, orderId, supabase]);

  // 切换项目选中（同时切换其下所有配件）
  function 切换项目(项目ID: string) {
    const next = new Set(选中项目ID);
    if (next.has(项目ID)) {
      next.delete(项目ID);
      // 取消选中该项目下所有配件
      设置选中配件ID((prev) => {
        const next = { ...prev };
        delete next[项目ID];
        return next;
      });
    } else {
      next.add(项目ID);
      // 选中该项目下所有配件
      const 配件列表 = 配件映射[项目ID] || [];
      if (配件列表.length > 0) {
        设置选中配件ID((prev) => ({
          ...prev,
          [项目ID]: new Set(配件列表.map((p) => p.id)),
        }));
      }
    }
    设置选中项目ID(next);
  }

  // 切换配件选中
  function 切换配件(项目ID: string, 配件ID: string) {
    设置选中配件ID((prev) => {
      const next = { ...prev };
      if (!next[项目ID]) {
        next[项目ID] = new Set();
      }
      const set = new Set(next[项目ID]);
      if (set.has(配件ID)) {
        set.delete(配件ID);
      } else {
        set.add(配件ID);
      }
      next[项目ID] = set;
      return next;
    });
  }

  // 全选/取消全选
  function 全选() {
    if (选中项目ID.size === 项目列表.length) {
      设置选中项目ID(new Set());
      设置选中配件ID({});
    } else {
      const 全部项目 = new Set(项目列表.map((i) => i.id));
      设置选中项目ID(全部项目);
      const 全部配件: Record<string, Set<string>> = {};
      for (const 项目 of 项目列表) {
        const 配件列表 = 配件映射[项目.id] || [];
        if (配件列表.length > 0) {
          全部配件[项目.id] = new Set(配件列表.map((p) => p.id));
        }
      }
      设置选中配件ID(全部配件);
    }
  }

  // 确认导入：先检查重复项目
  async function 确认导入() {
    if (!保养单 || 选中项目ID.size === 0) return;

    // 获取当前工单已有项目名称
    const { data: 已有项目 } = await supabase
      .from("work_order_items")
      .select("name")
      .eq("work_order_id", orderId);
    const 已有名称 = (已有项目 || []).map((i: { name: string }) => i.name);

    // 找出选中项目中与当前工单重复的
    const 重复名 = 找重复项目名(
      已有名称,
      项目列表.filter((项目) => 选中项目ID.has(项目.id)).map((项目) => 项目.name)
    );

    if (重复名.length > 0) {
      // 有重复，弹窗询问
      设置重复项目名(重复名);
      设置显示重复确认(true);
      return;
    }

    // 无重复，直接导入
    await 执行导入("跳过");
  }

  // 执行导入：处理模式 = 跳过重复 | 覆盖重复（写库走 Server Action）
  async function 执行导入(处理模式: "跳过" | "覆盖") {
    if (!保养单) return;
    设置显示重复确认(false);
    设置导入中(true);

    try {
      标记本机操作();

      /* 待导入项目清单（按勾选过滤；跳过模式的按名剔重由服务端做） */
      const 待导入项目: 保养导入项目[] = 项目列表.filter((项目) => 选中项目ID.has(项目.id));

      /* 勾选配件按源项目分组，传给服务端按新项目归属写入 */
      const 配件映射参数: Record<string, 保养导入配件[]> = {};
      for (const 项目 of 待导入项目) {
        const 勾选配件 = 选中配件ID[项目.id] || new Set<string>();
        const 清单 = (配件映射[项目.id] || []).filter((配件) => 勾选配件.has(配件.id));
        if (清单.length > 0) {
          配件映射参数[项目.id] = 清单;
        }
      }

      const result = await 导入保养单到工单({
        orderId,
        orderNo: 保养单.order_no,
        处理模式,
        重复项目名,
        项目列表: 待导入项目,
        配件映射: 配件映射参数,
      });
      if (!result.success) {
        throw new Error(result.error || "导入失败");
      }

      if (处理模式 === "跳过" && (result.跳过数量 || 0) > 0) {
        alert(`导入完成。${result.跳过数量} 个项目因名称重复已跳过。`);
      }
      if (处理模式 === "覆盖" && 重复项目名.length > 0) {
        alert(`导入完成。${重复项目名.length} 个重复项目已覆盖更新。`);
      }

      onClose();
      router.refresh();
    } catch (err: unknown) {
      alert("导入失败: " + (err instanceof Error ? err.message : String(err)));
      设置导入中(false);
    }
  }

  if (加载中) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4">
          <p className="text-sm text-gray-500">加载保养单中...</p>
        </div>
      </div>
    );
  }

  if (!保养单) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4">
          <p className="text-sm text-gray-500 text-center py-8">该车辆暂无保养单</p>
          <div className="flex justify-end mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col">
        <h3 className="text-base font-semibold text-gray-900 mb-4">从保养单导入</h3>

        {/* 信息校验 - 三行绿钩 */}
        {信息校验 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-600">✓</span>
              <span className="text-green-700">车牌号码一致</span>
            </div>
            <div className="flex items-center gap-2 text-sm mt-1">
              <span className="text-green-600">✓</span>
              <span className="text-green-700">VIN码一致</span>
            </div>
            <div className="flex items-center gap-2 text-sm mt-1">
              <span className="text-green-600">✓</span>
              <span className="text-green-700">客户信息一致</span>
            </div>
          </div>
        )}

        {/* 保养单信息 */}
        <div className="bg-gray-50 rounded-lg p-3 mb-4">
          <div className="text-sm font-medium text-gray-900">{保养单.order_no}</div>
          <div className="text-xs text-gray-500 mt-1">
            创建时间: {new Date(保养单.created_at).toLocaleDateString("zh-CN")}
            {保养单.mileage_in ? ` · 里程: ${保养单.mileage_in}km` : ""}
          </div>
        </div>

        {/* 项目列表 */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">选择要导入的项目和配件</span>
            {项目列表.length > 0 && (
              <button
                type="button"
                onClick={全选}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                {选中项目ID.size === 项目列表.length ? "取消全选" : "全选"}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-3">
            {项目列表.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">该保养单暂无项目</p>
            ) : (
              项目列表.map((项目) => {
                const 配件列表 = 配件映射[项目.id] || [];
                return (
                  <div key={项目.id} className="border border-gray-200 rounded-lg overflow-hidden">
                    <label
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                        选中项目ID.has(项目.id) ? "bg-purple-50" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={选中项目ID.has(项目.id)}
                        onChange={() => 切换项目(项目.id)}
                        className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-800">{项目.name}</div>
                        <div className="text-xs text-gray-400">
                          {项目.item_type === "labor" ? "工时" : 项目.item_type === "part" ? "配件" : "其他"}
                          {" × "}{项目.quantity} · {formatCurrency(项目.unit_price)}
                        </div>
                      </div>
                    </label>
                    {配件列表.length > 0 && 选中项目ID.has(项目.id) && (
                      <div className="border-t border-gray-100 bg-gray-50/50">
                        {配件列表.map((配件) => (
                          <label
                            key={配件.id}
                            className={`flex items-center gap-3 px-5 py-1.5 cursor-pointer hover:bg-gray-100 text-xs ${
                              (选中配件ID[项目.id] || new Set()).has(配件.id) ? "bg-purple-50" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={(选中配件ID[项目.id] || new Set()).has(配件.id)}
                              onChange={() => 切换配件(项目.id, 配件.id)}
                              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="flex-1 text-gray-700">
                              {配件.name}
                              {配件.brand && <span className="text-gray-400"> · {配件.brand}</span>}
                              {配件.specification && <span className="text-gray-400"> · {配件.specification}</span>}
                            </span>
                            <span className="text-gray-400">
                              ×{配件.quantity} · {formatCurrency(配件.unit_price)}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {选中项目ID.size > 0
              ? `已选 ${选中项目ID.size} 个项目`
              : "请选择要导入的项目"}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            {项目列表.length > 0 && (
              <button
                type="button"
                onClick={确认导入}
                disabled={选中项目ID.size === 0 || 导入中}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {导入中 ? "导入中..." : `确认导入 (${选中项目ID.size})`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 重复项目确认弹窗 */}
      {显示重复确认 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h4 className="text-base font-semibold text-gray-900 mb-2">
              发现 {重复项目名.length} 个重复项目
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              当前工单已存在以下同名维修项目：
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto">
              {重复项目名.map((名称) => (
                <div key={名称} className="text-sm text-amber-800 py-0.5">
                  · {名称}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mb-4">
              跳过：保留现有项目，不导入重复的；覆盖：删除现有项目，替换为保养单中的
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => 设置显示重复确认(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                返回
              </button>
              <button
                type="button"
                onClick={() => 执行导入("跳过")}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-purple-300 rounded-lg hover:bg-purple-50"
              >
                跳过重复项
              </button>
              <button
                type="button"
                onClick={() => 执行导入("覆盖")}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
              >
                覆盖重复项
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
