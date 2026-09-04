"use client";

/* 错误日志列表 — 客户端交互组件（首屏数据由服务端传入） */

import { PageHeader } from "@/components/PageHeader";

interface 错误日志 {
  id: number;
  created_at: string;
  message: string;
  stack: string | null;
  url: string | null;
  env: string | null;
  profiles: { full_name: string } | { full_name: string }[] | null;
}

interface Props {
  initialLogs: 错误日志[];
  无权限?: boolean;
  initialAlerts?: 系统告警[];
}

interface 系统告警 {
  id: number;
  created_at: string;
  kind: string;
  message: string;
  resolved_at: string | null;
}

export default function ErrorLogsContent({ initialLogs, 无权限 = false, initialAlerts = [] }: Props) {
  if (无权限) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="错误日志" description="页面报错自动收集" />
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          只有管理员和老板可以查看错误日志
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title="错误日志" description="页面报错自动收集（同一错误每分钟最多记一次），最近 100 条" />

      {/* 系统告警（watchdog：服务挂了/磁盘满了/PM2 异常） */}
      {initialAlerts.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm font-medium text-amber-800">
            系统告警（最近 50 条）
          </div>
          <div className="divide-y divide-amber-50">
            {initialAlerts.map((a) => (
              <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className="text-xs text-gray-400 shrink-0">{new Date(a.created_at).toLocaleString("zh-CN")}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${a.resolved_at ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>
                  {a.kind}
                </span>
                <span className="text-gray-700 break-all">{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {initialLogs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
          暂无错误记录，系统运行良好
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-100">
            {initialLogs.map((log) => {
              const 操作者 = Array.isArray(log.profiles) ? log.profiles[0]?.full_name : log.profiles?.full_name;
              return (
                <div key={log.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap text-xs text-gray-400 mb-1">
                    <span>{new Date(log.created_at).toLocaleString("zh-CN")}</span>
                    {操作者 && <span className="text-gray-500">{操作者}</span>}
                    {log.env && <span className="px-1.5 py-0.5 rounded bg-gray-100">{log.env}</span>}
                    {log.url && <span className="font-mono">{log.url}</span>}
                  </div>
                  <div className="text-sm text-red-600 font-medium break-all">{log.message}</div>
                  {log.stack && (
                    <details className="mt-1">
                      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">堆栈详情</summary>
                      <pre className="mt-1 text-[11px] text-gray-500 whitespace-pre-wrap break-all bg-gray-50 rounded p-2">{log.stack}</pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
