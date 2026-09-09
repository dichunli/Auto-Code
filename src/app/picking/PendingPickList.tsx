import Link from "next/link";
import { DirectPickButton, type 员工选项 } from "./DirectPickButton";

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
  库存: number;
  申领数: number;
  /* true=有库存可立即领；false=已进入待入库流程但未入账（一期只读展示） */
  可领: boolean;
}

/* 按工单分组的待领料卡片 */
export interface 待领工单组 {
  工单id: string;
  工单号: string;
  车牌: string;
  客户: string;
  行列表: 待领行[];
}

interface Props {
  组列表: 待领工单组[];
  当前页: number;
  总条数: number;
  每页: number;
  /* 在职员工列表（直领弹窗点选领料人用） */
  员工列表: 员工选项[];
  /* 当前搜索词（分页链接要带上，防止翻页丢搜索） */
  搜索词: string;
}

/* 待领料列表：服务端渲染（纯展示 + 跳开单页链接 + 直领按钮） */
export function PendingPickList({ 组列表, 当前页, 总条数, 每页, 员工列表, 搜索词 }: Props) {
  const 总页数 = Math.ceil(总条数 / 每页) || 1;
  /* 分页链接带上搜索词 */
  const 搜索参数 = 搜索词 ? `&q=${encodeURIComponent(搜索词)}` : "";

  if (组列表.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        {搜索词
          ? `没有找到匹配「${搜索词}」的待领料配件`
          : "暂无待领料配件（配件有库存或到货进入待入库后会出现在这里）"}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {组列表.map((组) => (
        <div key={组.工单id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* 工单卡片头：单号 + 车牌/客户 + 去领料 */}
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href={`/work-orders/${组.工单id}`}
                className="font-medium text-blue-600 hover:text-blue-700"
              >
                {组.工单号}
              </Link>
              <span className="text-sm text-gray-500 truncate">
                {组.车牌} · {组.客户}
              </span>
            </div>
            <Link
              href={`/picking-orders/new?work_order_id=${组.工单id}`}
              className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
            >
              去领料
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-5 py-2 font-medium">配件</th>
                  <th className="px-3 py-2 font-medium">所属项目</th>
                  <th className="px-3 py-2 font-medium text-right">需求</th>
                  <th className="px-3 py-2 font-medium text-right">已领</th>
                  <th className="px-3 py-2 font-medium text-right">库存</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {组.行列表.map((行) => (
                  <tr key={行.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">
                        {行.名称}
                        {行.申领数 > 0 && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                            已申领×{行.申领数}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {[行.brand, 行.specification].filter(Boolean).join(" / ")}
                        {行.part_number && ` · ${行.part_number}`}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-gray-500 text-xs">{行.项目名}</td>
                    <td className="px-3 py-3 text-right text-gray-900">
                      {行.需求数量} {行.unit}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-600">{行.已领}</td>
                    <td className="px-3 py-3 text-right text-gray-600">{行.库存}</td>
                    <td className="px-3 py-3">
                      {行.可领 ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                          有库存可领
                        </span>
                      ) : (
                        /* 待入库未入账：急件直领（登记后不动库存，确认入库时即入即出） */
                        <div className="flex items-center gap-1.5">
                          <DirectPickButton
                            分支id={行.id}
                            名称={行.名称}
                            剩余需领={行.需求数量 - 行.已领}
                            员工列表={员工列表}
                          />
                          <span className="text-[10px] text-gray-400">待入库</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* 分页 */}
      {总页数 > 1 && (
        <div className="flex items-center justify-between px-2">
          <span className="text-xs text-gray-500">
            共 {总条数} 条，第 {当前页}/{总页数} 页
          </span>
          <div className="flex items-center gap-2">
            {当前页 > 1 && (
              <Link
                href={`/picking?tab=pending_pick&page=${当前页 - 1}${搜索参数}`}
                className="px-3 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50"
              >
                上一页
              </Link>
            )}
            {当前页 < 总页数 && (
              <Link
                href={`/picking?tab=pending_pick&page=${当前页 + 1}${搜索参数}`}
                className="px-3 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50"
              >
                下一页
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
