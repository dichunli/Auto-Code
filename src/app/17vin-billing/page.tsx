"use client";

import { useState, useEffect, useCallback } from "react";
import { vin17GetBalance, type Vin17BalanceResult } from "@/lib/17vin/client";
import { 查询调用记录, type 调用记录, type 调用记录查询结果 } from "./actions";

interface 余额信息 {
  用户名: string;
  余额: string;
  备注: string;
}

export default function Vin17BillingPage() {
  const [余额, set余额] = useState<余额信息 | null>(null);
  const [余额加载中, set余额加载中] = useState(false);
  const [余额错误, set余额错误] = useState<string | null>(null);

  const [记录列表, set记录列表] = useState<调用记录[]>([]);
  const [记录总数, set记录总数] = useState(0);
  const [当前页, set当前页] = useState(1);
  const [记录加载中, set记录加载中] = useState(false);
  const [记录错误, set记录错误] = useState<string | null>(null);

  const 每页条数 = 20;
  const 总页数 = Math.ceil(记录总数 / 每页条数);

  /* 解析余额字符串，如 "余额:280.63元" → "280.63" */
  function 提取金额(余额字符串: string): string {
    const match = 余额字符串.match(/[\d.]+/);
    return match ? match[0] : "0";
  }

  /* 查询余额 */
  const 查询余额 = useCallback(async () => {
    set余额加载中(true);
    set余额错误(null);
    try {
      const res: Vin17BalanceResult = await vin17GetBalance();
      if (res.code === 1 && res.data && res.data.length > 0) {
        const item = res.data[0];
        set余额({
          用户名: item.Username || "-",
          余额: item.Count || "余额:0元",
          备注: item.Remark || "-",
        });
      } else {
        set余额错误(res.msg || "查询余额失败");
      }
    } catch (err: unknown) {
      set余额错误(err instanceof Error ? err.message : "查询余额出错");
    } finally {
      set余额加载中(false);
    }
  }, []);

  /* 查询调用记录 */
  const 加载调用记录 = useCallback(async (页码: number) => {
    set记录加载中(true);
    set记录错误(null);
    try {
      const result: 调用记录查询结果 = await 查询调用记录(页码, 每页条数);
      if (result.success && result.data) {
        set记录列表(result.data);
        set记录总数(result.total || 0);
      } else {
        set记录错误(result.error || "查询失败");
      }
    } catch (err: unknown) {
      set记录错误(err instanceof Error ? err.message : "查询出错");
    } finally {
      set记录加载中(false);
    }
  }, []);

  /* 初始加载 */
  useEffect(() => {
    查询余额();
    加载调用记录(1);
  }, [查询余额, 加载调用记录]);

  /* 页码变化时重新加载 */
  useEffect(() => {
    加载调用记录(当前页);
  }, [当前页, 加载调用记录]);

  /* 接口类型中文映射 */
  function 接口类型中文(类型: string): string {
    const 映射: Record<string, string> = {
      myapicount: "余额查询",
      vin_decode: "VIN解码",
      cata1: "一级目录",
      cata2: "二级目录",
      cata3: "三级目录",
      cata4: "四级目录",
      part: "配件列表",
      search_part_number: "配件号搜索",
      vin_ocr: "VIN识别",
      vin_ocr_and_vin_decode: "VIN识别+解码",
      get_modellist_from_part_number_and_group_id: "配件适用车型",
      aftermarket_vin: "VIN查保养件",
      unknown: "未知",
    };
    return 映射[类型] || 类型;
  }

  /* 简化请求参数显示 */
  function 简化参数(参数: Record<string, unknown>): string {
    const 列表: string[] = [];
    Object.entries(参数).forEach(([key, value]) => {
      if (key === "action") return;
      const 显示值 = String(value).length > 30 ? String(value).slice(0, 30) + "..." : String(value);
      列表.push(`${key}=${显示值}`);
    });
    return 列表.join(", ") || "-";
  }

  /* 格式化时间 */
  function 格式化时间(时间字符串: string): string {
    const date = new Date(时间字符串);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* 标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">17VIN 账户管理</h1>
        <p className="text-sm text-gray-500 mt-1">查询账户余额和API调用记录</p>
      </div>

      {/* 余额卡片 */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-500 rounded-xl p-6 text-white mb-8 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-100 text-sm mb-1">17VIN 账户余额</p>
            <div className="flex items-baseline gap-2">
              {余额加载中 ? (
                <span className="text-3xl font-bold">查询中...</span>
              ) : 余额错误 ? (
                <span className="text-lg">{余额错误}</span>
              ) : 余额 ? (
                <>
                  <span className="text-4xl font-bold">{提取金额(余额.余额)}</span>
                  <span className="text-lg text-blue-100">元</span>
                </>
              ) : (
                <span className="text-3xl font-bold">-</span>
              )}
            </div>
            {余额 && !余额错误 && !余额加载中 && (
              <div className="mt-2 text-sm text-blue-100">
                <span>用户: {余额.用户名}</span>
                {余额.备注 !== "-" && <span className="ml-4">备注: {余额.备注}</span>}
              </div>
            )}
          </div>
          <button
            onClick={查询余额}
            disabled={余额加载中}
            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {余额加载中 ? "刷新中..." : "刷新余额"}
          </button>
        </div>
      </div>

      {/* 调用记录 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">API 调用记录</h2>
          <span className="text-sm text-gray-500">
            共 {记录总数} 条记录
          </span>
        </div>

        {记录错误 ? (
          <div className="p-8 text-center text-red-500">{记录错误}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      时间
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      接口类型
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      请求参数
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      状态
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      结果
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {记录加载中 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                        加载中...
                      </td>
                    </tr>
                  ) : 记录列表.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                        暂无调用记录
                      </td>
                    </tr>
                  ) : (
                    记录列表.map((记录) => (
                      <tr key={记录.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                          {格式化时间(记录.创建时间)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700">
                            {接口类型中文(记录.接口类型)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                          {简化参数(记录.请求参数)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-sm font-medium ${
                              记录.响应状态 && 记录.响应状态 < 400
                                ? "text-gray-900"
                                : "text-red-600"
                            }`}
                          >
                            {记录.响应状态 || "-"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {记录.是否成功 ? (
                            <span className="inline-flex items-center text-xs font-medium text-green-700">
                              <svg className="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              成功
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-xs font-medium text-red-600">
                              <svg className="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                              </svg>
                              失败
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {总页数 > 1 && (
              <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
                <button
                  onClick={() => set当前页((p) => Math.max(1, p - 1))}
                  disabled={当前页 === 1 || 记录加载中}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <span className="text-sm text-gray-600">
                  第 {当前页} / {总页数} 页
                </span>
                <button
                  onClick={() => set当前页((p) => Math.min(总页数, p + 1))}
                  disabled={当前页 === 总页数 || 记录加载中}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
