"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/lib/useDebounce";
import { useToast } from "@/components/Toast";
import {
  统一确认领料,
  type 统一领料工单组,
} from "@/app/picking-orders/actions";

/* 待领料行（一个工单配件分支） */
export interface 待领行 {
  id: string;
  名称: string;
  brand: string | null;
  specification: string | null;
  part_number: string | null;
  unit: string;
  项目名: string;
  需求数量: number;
  已领: number;
  /* 展示用库存：关联配件档案的库存；未挂档案但编码能匹配到档案时取匹配档案的库存 */
  库存: number;
  /* 仓库·仓位拼装文本（有货"主仓库·A-01×3"，无货仅标"主仓库·A-01"），无分仓数据时空串 */
  仓位信息: string;
  申领数: number;
  /* true=有库存可立即领；false=已进入待入库流程但未入账（可急件直领） */
  可领: boolean;
}

/* 按工单分组的待领料卡片 */
export interface 待领工单组 {
  工单id: string;
  工单号: string;
  车牌: string;
  客户: string;
  车主电话: string;
  车型信息: string;
  行列表: 待领行[];
}

export interface 员工选项 {
  id: string;
  full_name: string | null;
}

/* 篮子项（已点选待统一确认的配件） */
interface 篮子项 {
  分支id: string;
  名称: string;
  unit: string;
  /* normal=有库存正常领料；direct=待入库急件直领 */
  类型: "normal" | "direct";
  /* 表单规范：数字字段字符串存储，提交时转 number */
  数量: string;
  /* 数量上限（加入时的剩余需领，服务端还会再校验） */
  剩余需领: number;
  工单id: string;
  工单号: string;
  车牌: string;
}

const 每页分支数 = 50;

/* 左栏单个工单卡片：三级结构（工单 → 维修项目 → 配件行） */
function 待领工单卡片({
  组,
  已选,
  on加入,
  on移出,
}: {
  组: 待领工单组;
  已选: Record<string, 篮子项>;
  on加入: (行: 待领行, 组: 待领工单组) => void;
  on移出: (分支id: string) => void;
}) {
  /* 二级：按维修项目分组 */
  const 项目分组: [string, 待领行[]][] = [];
  for (const 行 of 组.行列表) {
    const 已有 = 项目分组.find(([名]) => 名 === 行.项目名);
    if (已有) {
      已有[1].push(行);
    } else {
      项目分组.push([行.项目名, [行]]);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* 一级：工单卡头 */}
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap px-5 py-3 bg-gray-50 border-b border-gray-100">
        <Link
          href={`/work-orders/${组.工单id}`}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          {组.工单号}
        </Link>
        <span className="text-lg font-bold text-gray-900 tracking-wide">{组.车牌}</span>
        {组.车型信息 && <span className="text-sm text-gray-500">{组.车型信息}</span>}
        <span className="text-sm text-gray-500">
          车主：{组.客户}
          {组.车主电话 ? ` ${组.车主电话}` : ""}
        </span>
      </div>

      {/* 二级：维修项目分组 */}
      {项目分组.map(([项目名, 行列表]) => (
        <div key={项目名}>
          <div className="px-5 py-1.5 text-xs text-gray-400 bg-gray-50/50 border-b border-gray-100">
            {项目名}
          </div>
          <div className="divide-y divide-gray-50">
            {行列表.map((行) => {
              const 已加入 = !!已选[行.id];
              return (
                <div key={行.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                  {/* 三级：配件信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">
                      {行.名称}
                      {行.申领数 > 0 && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                          已申领×{行.申领数}
                        </span>
                      )}
                      {!行.可领 && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-200">
                          待入库
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate">
                      {[行.brand, 行.specification].filter(Boolean).join(" / ")}
                      {行.part_number && ` · ${行.part_number}`}
                      {行.仓位信息 && ` · ${行.仓位信息}`}
                    </div>
                  </div>
                  <div className="w-24 shrink-0 text-right text-sm">
                    <span className="text-gray-900">需 {行.需求数量}</span>
                    <span className="text-gray-400"> / 已领 {行.已领}</span>
                  </div>
                  {/* 库存列：所有行都显示库存数，无货用浅灰（待入库的件也能一眼看到当前存货） */}
                  <div
                    className={`w-14 shrink-0 text-right text-sm ${
                      行.库存 > 0 ? "text-gray-600" : "text-gray-300"
                    }`}
                  >
                    存 {行.库存}
                  </div>
                  {/* 操作列：未加入显示领料按钮，已加入显示标记（点击移出） */}
                  <div className="w-24 shrink-0 text-right">
                    {已加入 ? (
                      <button
                        type="button"
                        onClick={() => on移出(行.id)}
                        title="点击移出待确认区"
                        className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 whitespace-nowrap"
                      >
                        ✓ 已加入
                      </button>
                    ) : 行.可领 ? (
                      <button
                        type="button"
                        onClick={() => on加入(行, 组)}
                        className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
                      >
                        领料
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => on加入(行, 组)}
                        className="text-xs px-2 py-1 rounded bg-orange-500 text-white hover:bg-orange-600 whitespace-nowrap"
                      >
                        急件直领
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* 右栏篮子面板（PC 侧栏和移动端抽屉复用） */
function 篮子面板({
  已选,
  on改数量,
  on移出,
  员工列表,
  领料人id,
  设领料人id,
  领料人搜索,
  设领料人搜索,
  备注,
  设备注,
  提交中,
  on提交,
  on清空,
}: {
  已选: Record<string, 篮子项>;
  on改数量: (分支id: string, 值: string) => void;
  on移出: (分支id: string) => void;
  员工列表: 员工选项[];
  领料人id: string;
  设领料人id: (id: string) => void;
  领料人搜索: string;
  设领料人搜索: (词: string) => void;
  备注: string;
  设备注: (词: string) => void;
  提交中: boolean;
  on提交: () => void;
  on清空: () => void;
}) {
  const 项列表 = Object.values(已选);

  /* 篮子按工单分组显示 */
  const 篮子组: { 工单id: string; 工单号: string; 车牌: string; 项: 篮子项[] }[] = [];
  for (const 项 of 项列表) {
    const 已有 = 篮子组.find((g) => g.工单id === 项.工单id);
    if (已有) {
      已有.项.push(项);
    } else {
      篮子组.push({ 工单id: 项.工单id, 工单号: 项.工单号, 车牌: 项.车牌, 项: [项] });
    }
  }

  const 过滤后员工 = 领料人搜索.trim()
    ? 员工列表.filter((p) => (p.full_name || "").includes(领料人搜索.trim()))
    : 员工列表;

  if (项列表.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-gray-400">
        点击左边配件的「领料」/「急件直领」按钮，配件会移到这里统一确认
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-bold text-gray-900">
          待确认领料（{项列表.length} 项）
        </span>
        <button
          type="button"
          onClick={on清空}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          清空
        </button>
      </div>

      {/* 已选配件：按工单分组，数量可改、可移除 */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {篮子组.map((g) => (
          <div key={g.工单id}>
            <div className="text-xs text-gray-400 py-1">
              {g.工单号} · <span className="font-medium text-gray-600">{g.车牌}</span>
            </div>
            <div className="space-y-1.5">
              {g.项.map((项) => (
                <div
                  key={项.分支id}
                  className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 truncate">
                      {项.名称}
                      {项.类型 === "direct" && (
                        <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-orange-100 text-orange-700">
                          急件
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400">剩余需领 {项.剩余需领}</div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={项.剩余需领}
                    value={项.数量}
                    onChange={(e) => on改数量(项.分支id, e.target.value)}
                    className="w-16 px-1.5 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                  />
                  <span className="text-xs text-gray-400">{项.unit}</span>
                  <button
                    type="button"
                    onClick={() => on移出(项.分支id)}
                    title="移出"
                    className="text-gray-300 hover:text-red-500 text-base leading-none px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 底栏：领料人 + 备注 + 统一确认 */}
      <div className="border-t border-gray-100 px-4 py-3 space-y-2.5">
        <div>
          <input
            type="text"
            value={领料人搜索}
            onChange={(e) => 设领料人搜索(e.target.value)}
            placeholder="搜索领料人姓名"
            className="w-full px-3 py-1.5 mb-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
          />
          <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-1.5 space-y-0.5">
            {过滤后员工.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-2">没有匹配的人员</p>
            )}
            {过滤后员工.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer"
              >
                <input
                  type="radio"
                  name="统一领料人"
                  checked={领料人id === p.id}
                  onChange={() => 设领料人id(p.id)}
                  className="accent-blue-600"
                />
                <span className="text-sm">{p.full_name || "-"}</span>
              </label>
            ))}
          </div>
        </div>
        <input
          type="text"
          value={备注}
          onChange={(e) => 设备注(e.target.value)}
          placeholder="备注（可空）"
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
        />
        <button
          type="button"
          onClick={on提交}
          disabled={提交中}
          className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {提交中 ? "确认中..." : `统一确认领料（${项列表.length} 项）`}
        </button>
      </div>
    </div>
  );
}

/* 待领料看板：左边三级列表点选，右边篮子统一确认（库管核对后一次开单） */
export function PendingPickBoard({
  组列表,
  员工列表,
}: {
  组列表: 待领工单组[];
  员工列表: 员工选项[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [搜索词, 设搜索词] = useState("");
  const 防抖词 = useDebounce(搜索词, 300);
  const [当前页, 设当前页] = useState(1);
  const [已选, 设已选] = useState<Record<string, 篮子项>>({});
  const [领料人id, 设领料人id] = useState("");
  const [领料人搜索, 设领料人搜索] = useState("");
  const [备注, 设备注] = useState("");
  const [提交中, 设提交中] = useState(false);
  const [抽屉打开, 设抽屉打开] = useState(false);

  /* 搜索变化回到第一页 */
  useEffect(() => {
    设当前页(1);
  }, [防抖词]);

  /* 前端搜索过滤（与服务端旧口径一致：工单号/车牌/车主/电话/车型） */
  const 过滤后组 = useMemo(() => {
    const 关键词 = 防抖词.trim().toLowerCase();
    if (!关键词) return 组列表;
    return 组列表.filter(
      (组) =>
        组.工单号.toLowerCase().includes(关键词) ||
        组.车牌.toLowerCase().includes(关键词) ||
        组.客户.toLowerCase().includes(关键词) ||
        组.车主电话.toLowerCase().includes(关键词) ||
        组.车型信息.toLowerCase().includes(关键词)
    );
  }, [组列表, 防抖词]);

  /* 前端分页：按分支行 50 条/页，页内再按工单分组（篮子 state 不随翻页丢失） */
  const { 页内组, 总条数, 总页数, 有效页 } = useMemo(() => {
    const 所有行: { 组: 待领工单组; 行: 待领行 }[] = [];
    for (const 组 of 过滤后组) {
      for (const 行 of 组.行列表) {
        所有行.push({ 组, 行 });
      }
    }
    const 总条数 = 所有行.length;
    const 总页数 = Math.max(1, Math.ceil(总条数 / 每页分支数));
    const 有效页 = Math.min(当前页, 总页数);
    const 页内行 = 所有行.slice((有效页 - 1) * 每页分支数, 有效页 * 每页分支数);
    const 组Map = new Map<string, 待领工单组>();
    for (const { 组, 行 } of 页内行) {
      const 已有 = 组Map.get(组.工单id);
      if (已有) {
        已有.行列表.push(行);
      } else {
        组Map.set(组.工单id, { ...组, 行列表: [行] });
      }
    }
    return { 页内组: [...组Map.values()], 总条数, 总页数, 有效页 };
  }, [过滤后组, 当前页]);

  function 加入篮子(行: 待领行, 组: 待领工单组) {
    设已选((prev) => ({
      ...prev,
      [行.id]: {
        分支id: 行.id,
        名称: 行.名称,
        unit: 行.unit,
        类型: 行.可领 ? "normal" : "direct",
        数量: String(行.需求数量 - 行.已领),
        剩余需领: 行.需求数量 - 行.已领,
        工单id: 组.工单id,
        工单号: 组.工单号,
        车牌: 组.车牌,
      },
    }));
  }

  function 移出篮子(分支id: string) {
    设已选((prev) => {
      const next = { ...prev };
      delete next[分支id];
      return next;
    });
  }

  function 改数量(分支id: string, 值: string) {
    设已选((prev) => {
      const 项 = prev[分支id];
      if (!项) return prev;
      return { ...prev, [分支id]: { ...项, 数量: 值 } };
    });
  }

  const 已选数量 = Object.keys(已选).length;

  async function 提交统一确认() {
    const 项列表 = Object.values(已选);
    if (项列表.length === 0 || 提交中) return;
    for (const 项 of 项列表) {
      const n = parseInt(项.数量);
      if (!Number.isInteger(n) || n <= 0) {
        showToast(`「${项.名称}」数量必须是大于 0 的整数`, "warning");
        return;
      }
      if (n > 项.剩余需领) {
        showToast(`「${项.名称}」剩余需领 ${项.剩余需领} 件，不能超领`, "warning");
        return;
      }
    }
    if (!领料人id) {
      showToast("请选择领料人", "warning");
      return;
    }
    const 领料人姓名 = 员工列表.find((p) => p.id === 领料人id)?.full_name || "";

    /* 按工单分组：有库存的走普通领料（FIFO 自动分配批次），待入库的走急件直领 */
    const 组Map = new Map<string, 统一领料工单组>();
    for (const 项 of 项列表) {
      let g = 组Map.get(项.工单id);
      if (!g) {
        g = { 工单id: 项.工单id, 普通: [], 直领: [] };
        组Map.set(项.工单id, g);
      }
      const 明细 = { work_order_item_part_id: 项.分支id, quantity: parseInt(项.数量) };
      if (项.类型 === "normal") {
        g.普通.push(明细);
      } else {
        g.直领.push(明细);
      }
    }

    /* 敏感操作二次确认 */
    if (!confirm(`统一确认领料：共 ${项列表.length} 个配件、${组Map.size} 个工单。\n确认后立即扣库存 / 登记急件直领，是否继续？`)) {
      return;
    }

    设提交中(true);
    try {
      const r = await 统一确认领料([...组Map.values()], 领料人姓名, 备注);
      if (!r.success) {
        showToast("领料失败: " + (r.error || "未知错误"), "error");
        return;
      }

      /* 逐工单处理结果：成功的项移出篮子，失败的保留并提示 */
      const 成功单号: string[] = [];
      const 失败消息: string[] = [];
      const 成功分支ids = new Set<string>();
      const 车牌By工单 = new Map(项列表.map((x) => [x.工单id, x.车牌]));
      for (const 单组 of r.结果 || []) {
        const 车牌 = 车牌By工单.get(单组.工单id) || "";
        if (单组.普通单号) {
          成功单号.push(单组.普通单号);
          项列表
            .filter((x) => x.工单id === 单组.工单id && x.类型 === "normal")
            .forEach((x) => 成功分支ids.add(x.分支id));
        }
        if (单组.普通错误) {
          失败消息.push(`${车牌} 普通领料：${单组.普通错误}`);
        }
        if (单组.直领单号) {
          成功单号.push(单组.直领单号);
          项列表
            .filter((x) => x.工单id === 单组.工单id && x.类型 === "direct")
            .forEach((x) => 成功分支ids.add(x.分支id));
        }
        if (单组.直领错误) {
          失败消息.push(`${车牌} 急件直领：${单组.直领错误}`);
        }
      }

      设已选((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([id]) => !成功分支ids.has(id)))
      );

      if (失败消息.length > 0) {
        alert("以下项目领料失败（已保留在待确认区）：\n\n" + 失败消息.join("\n"));
        if (成功单号.length > 0) {
          showToast(`部分成功：已开 ${成功单号.length} 张单，${失败消息.length} 项失败`, "warning");
        }
      } else {
        showToast(`领料成功，共开 ${成功单号.length} 张领料单`, "success");
        设备注("");
      }
      设抽屉打开(false);
      router.refresh();
    } catch (err: unknown) {
      showToast("领料失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      设提交中(false);
    }
  }

  const 篮子面板属性 = {
    已选,
    on改数量: 改数量,
    on移出: 移出篮子,
    员工列表,
    领料人id,
    设领料人id,
    领料人搜索,
    设领料人搜索,
    备注,
    设备注,
    提交中,
    on提交: 提交统一确认,
    on清空: () => 设已选({}),
  };

  return (
    <div>
      {/* 搜索框（前端过滤，不刷新页面，篮子不丢） */}
      <div className="mb-4">
        <input
          type="text"
          value={搜索词}
          onChange={(e) => 设搜索词(e.target.value)}
          placeholder="搜索工单号 / 车牌 / 厂家品牌车型 / 车主姓名电话"
          className="w-full max-w-xl px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
        />
      </div>

      <div className="flex gap-4 items-start">
        {/* 左栏：待领三级列表 */}
        <div className="flex-1 min-w-0 space-y-4 pb-20 md:pb-0">
          {页内组.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
              {防抖词.trim()
                ? `没有找到匹配「${防抖词.trim()}」的待领料配件`
                : "暂无待领料配件（配件有库存或到货进入待入库后会出现在这里）"}
            </div>
          ) : (
            页内组.map((组) => (
              <待领工单卡片
                key={组.工单id}
                组={组}
                已选={已选}
                on加入={加入篮子}
                on移出={移出篮子}
              />
            ))
          )}

          {/* 前端分页 */}
          {总页数 > 1 && (
            <div className="flex items-center justify-between px-2">
              <span className="text-xs text-gray-500">
                共 {总条数} 条，第 {有效页}/{总页数} 页
              </span>
              <div className="flex items-center gap-2">
                {有效页 > 1 && (
                  <button
                    type="button"
                    onClick={() => 设当前页(有效页 - 1)}
                    className="px-3 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50"
                  >
                    上一页
                  </button>
                )}
                {有效页 < 总页数 && (
                  <button
                    type="button"
                    onClick={() => 设当前页(有效页 + 1)}
                    className="px-3 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50"
                  >
                    下一页
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 右栏：待确认篮子（PC sticky 侧栏） */}
        <div className="hidden md:block w-96 shrink-0 sticky top-4">
          <div className="bg-white rounded-xl border border-gray-200 max-h-[calc(100vh-8rem)] flex flex-col">
            <篮子面板 {...篮子面板属性} />
          </div>
        </div>
      </div>

      {/* 移动端：底部固定条 */}
      {已选数量 > 0 && (
        <div className="md:hidden fixed bottom-0 inset-x-0 z-[110] bg-white border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={() => 设抽屉打开(true)}
            className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg"
          >
            待确认领料（{已选数量} 项）→
          </button>
        </div>
      )}

      {/* 移动端：全屏抽屉 */}
      {抽屉打开 && (
        <div className="md:hidden fixed inset-0 z-[120] bg-white flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <span className="text-base font-bold text-gray-900">待确认领料</span>
            <button
              type="button"
              onClick={() => 设抽屉打开(false)}
              className="text-sm text-gray-500 px-2 py-1"
            >
              关闭
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <篮子面板 {...篮子面板属性} />
          </div>
        </div>
      )}
    </div>
  );
}
