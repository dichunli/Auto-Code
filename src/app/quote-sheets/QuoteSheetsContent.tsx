"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 作废询价单, 采用询价单, type 询价单列表项 } from "../quote/actions";
import { copyText } from "@/lib/copyText";

/* 询价单列表（客户端交互部分）：复制链接 / 采用锁死 / 作废 */

const 状态样式: Record<string, { text: string; className: string }> = {
  open: { text: "待报价", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  submitted: { text: "已报价", className: "bg-green-50 text-green-700 border-green-200" },
  adopted: { text: "已采用", className: "bg-blue-50 text-blue-700 border-blue-200" },
  cancelled: { text: "已作废", className: "bg-gray-50 text-gray-400 border-gray-200" },
};

function 格式化时间(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function QuoteSheetsContent({ 初始列表, 当前时间戳 }: { 初始列表: 询价单列表项[]; 当前时间戳: number }) {
  const router = useRouter();
  const [操作中, set操作中] = useState<string | null>(null);
  const [复制的id, set复制的id] = useState<string | null>(null);

  function 已过期(s: 询价单列表项) {
    /* 当前时间由服务端传入：渲染期不调 Date.now()（react-hooks 纯度规则） */
    return new Date(s.expires_at).getTime() < 当前时间戳;
  }

  async function 复制链接(s: 询价单列表项) {
    const 链接 = `${window.location.origin}/quote/${s.token}`;
    /* copyText 内部已带 execCommand 老式兜底，http 页面也能复制成功 */
    if (await copyText(链接)) {
      set复制的id(s.id);
      setTimeout(() => set复制的id(null), 2000);
      return;
    }
    alert("自动复制失败，请手动复制：\n" + 链接);
  }

  async function 采用(s: 询价单列表项) {
    if (!confirm(`确定采用「${s.supplier_name}」的报价吗？\n采用后供应商不能再修改。`)) return;
    set操作中(s.id);
    try {
      const 结果 = await 采用询价单(s.id);
      set操作中(null);
      if (!结果.success) {
        alert("操作失败: " + (结果.error || "未知错误"));
        return;
      }
      router.refresh();
    } catch (err: unknown) {
      set操作中(null);
      alert("操作失败: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function 作废(s: 询价单列表项) {
    if (!confirm(`确定作废发给「${s.supplier_name}」的询价单吗？\n作废后链接立即失效。`)) return;
    set操作中(s.id);
    try {
      const 结果 = await 作废询价单(s.id);
      set操作中(null);
      if (!结果.success) {
        alert("操作失败: " + (结果.error || "未知错误"));
        return;
      }
      router.refresh();
    } catch (err: unknown) {
      set操作中(null);
      alert("操作失败: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  if (初始列表.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
        还没有询价单。到「待询价」页勾选配件行，点「生成询价链接」即可发给供应商报价。
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-500">供应商</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">配件数</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">创建时间</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">有效期至</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {初始列表.map((s) => {
            const 过期 = 已过期(s);
            const 样式 = 状态样式[s.status] || 状态样式.open!;
            const 链接可用 = (s.status === "open" || s.status === "submitted") && !过期;
            return (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{s.supplier_name}</td>
                <td className="px-4 py-3 text-gray-600">
                  {s.已填价数 > 0 ? (
                    <span>
                      <span className="text-green-600 font-medium">{s.已填价数}</span>
                      <span className="text-gray-400"> / {s.条目数} 已填价</span>
                    </span>
                  ) : (
                    <span className="text-gray-400">{s.条目数} 条</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 text-xs rounded border ${样式.className}`}>
                    {s.status === "open" && 过期 ? "已过期" : 样式.text}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{格式化时间(s.created_at)}</td>
                <td className={`px-4 py-3 ${过期 && s.status === "open" ? "text-red-500" : "text-gray-500"}`}>
                  {格式化时间(s.expires_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {链接可用 && (
                      <button
                        type="button"
                        onClick={() => 复制链接(s)}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        {复制的id === s.id ? "已复制 ✓" : "复制链接"}
                      </button>
                    )}
                    {s.status === "submitted" && (
                      <button
                        type="button"
                        onClick={() => 采用(s)}
                        disabled={操作中 === s.id}
                        className="text-xs text-green-600 hover:text-green-700 disabled:opacity-50"
                      >
                        采用
                      </button>
                    )}
                    {(s.status === "open" || s.status === "submitted") && (
                      <button
                        type="button"
                        onClick={() => 作废(s)}
                        disabled={操作中 === s.id}
                        className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
                      >
                        作废
                      </button>
                    )}
                    {!链接可用 && s.status !== "submitted" && s.status !== "open" && (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
