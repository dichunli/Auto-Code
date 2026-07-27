"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* 居中确认弹窗 Hook：替代浏览器原生 confirm()（原生弹窗固定在页面顶部，位置无法修改）。
 * 用法：
 *   const { 请求确认, 确认弹窗 } = useConfirm();
 *   if (!(await 请求确认("确定删除吗？"))) return;
 *   ...
 *   return (<> ...{确认弹窗} </>);
 * 点"确定"返回 true，点"取消"/遮罩/右上角×返回 false。 */
interface 确认选项 {
  /* 标题，默认"操作确认" */
  title?: string;
  /* 提示内容 */
  message: string;
  /* 确定按钮文字，默认"确定" */
  confirmText?: string;
  /* 取消按钮文字，默认"取消" */
  cancelText?: string;
  /* 危险操作（删除类）确定按钮用红色，默认 true */
  danger?: boolean;
}

export function useConfirm() {
  const [选项, 设置选项] = useState<确认选项 | null>(null);
  /* 保存当前 Promise 的 resolve，点按钮时带回结果 */
  const resolveRef = useRef<((结果: boolean) => void) | null>(null);

  const 请求确认 = useCallback((参数: string | 确认选项) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      设置选项(typeof 参数 === "string" ? { message: 参数 } : 参数);
    });
  }, []);

  const 关闭 = useCallback((结果: boolean) => {
    resolveRef.current?.(结果);
    resolveRef.current = null;
    设置选项(null);
  }, []);

  /* 用 Portal 渲染到 body：不受父级弹窗/容器的层级上下文影响，保证永远盖在最上层 */
  const 确认弹窗: ReactNode =
    选项 && typeof document !== "undefined"
      ? createPortal(
          /* z-[120]：要盖在页面里其它弹窗（一般 z-50）之上 */
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4"
            onClick={() => 关闭(false)}
          >
            <div
              className="bg-white rounded-xl shadow-2xl w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-4 pb-2">
                <h3 className="text-base font-semibold text-gray-900">
                  {选项.title ?? "操作确认"}
                </h3>
              </div>
              <div className="px-5 pb-4">
                <p className="text-sm text-gray-600 whitespace-pre-line">{选项.message}</p>
              </div>
              <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => 关闭(false)}
                  className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  {选项.cancelText ?? "取消"}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => 关闭(true)}
                  className={`px-4 py-2 text-sm text-white rounded-lg ${
                    (选项.danger ?? true)
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {选项.confirmText ?? "确定"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return { 请求确认, 确认弹窗 };
}
