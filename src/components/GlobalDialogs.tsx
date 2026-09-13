"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* ═══ 全局阻塞式弹窗（替代必须看完的原生 alert 长文 + prompt 输入） ═══
 * 用途：弹窗治理（2026-09-13）。两个命令式 API，任何位置可调用（不经过 Hook）：
 *   await 全局提示("以下项目操作失败：...")   —— 只有"确定"，用户看完才继续
 *   const 值 = await 全局输入("请输入原因：")  —— 返回输入串；取消返回 null
 * 轻量通知（几秒可消失）请用 @/lib/globalToast 的 toast()，不要用这里。 */

interface 提示选项 {
  title?: string;
  message: string;
  confirmText?: string;
}

interface 输入选项 {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
}

type 队列项 =
  | { kind: "提示"; 选项: 提示选项; resolve: () => void }
  | { kind: "输入"; 选项: 输入选项; resolve: (值: string | null) => void };

let 已注册派发: ((项: 队列项) => void) | null = null;

/* 阻塞式提示：用户点"确定"后 Promise 才返回（语义与原生 alert 一致） */
export function 全局提示(参数: string | 提示选项): Promise<void> {
  const 选项 = typeof 参数 === "string" ? { message: 参数 } : 参数;
  return new Promise<void>((resolve) => {
    if (已注册派发) {
      已注册派发({ kind: "提示", 选项, resolve });
    } else {
      console.warn("[全局提示] Provider 未挂载:", 选项.message);
      resolve();
    }
  });
}

/* 输入弹窗：确定返回输入内容（trim 后可为空串），取消/遮罩返回 null */
export function 全局输入(参数: string | 输入选项): Promise<string | null> {
  const 选项 = typeof 参数 === "string" ? { message: 参数 } : 参数;
  return new Promise<string | null>((resolve) => {
    if (已注册派发) {
      已注册派发({ kind: "输入", 选项, resolve });
    } else {
      console.warn("[全局输入] Provider 未挂载:", 选项.message);
      resolve(null);
    }
  });
}

export function GlobalDialogsProvider({ children }: { children: React.ReactNode }) {
  const [当前, 设置当前] = useState<队列项 | null>(null);
  const [输入值, 设置输入值] = useState("");
  /* ref 当单一事实来源：避免在 setState updater 里做副作用（StrictMode 会双跑） */
  const 当前Ref = useRef<队列项 | null>(null);
  const 队列Ref = useRef<队列项[]>([]);

  const 切换当前 = useCallback((项: 队列项 | null) => {
    当前Ref.current = 项;
    if (项?.kind === "输入") 设置输入值(项.选项.defaultValue || "");
    设置当前(项);
  }, []);

  /* 并发调用排队：一个关闭再出下一个 */
  const 派发 = useCallback(
    (项: 队列项) => {
      if (当前Ref.current) {
        队列Ref.current.push(项);
        return;
      }
      切换当前(项);
    },
    [切换当前]
  );

  useEffect(() => {
    已注册派发 = 派发;
    return () => {
      if (已注册派发 === 派发) 已注册派发 = null;
    };
  }, [派发]);

  const 收尾并出下一个 = useCallback(() => {
    切换当前(队列Ref.current.shift() || null);
  }, [切换当前]);

  const 关闭 = useCallback(() => {
    const 项 = 当前Ref.current;
    if (!项) return;
    if (项.kind === "提示") 项.resolve();
    else 项.resolve(null);
    收尾并出下一个();
  }, [收尾并出下一个]);

  const 确定 = useCallback(() => {
    const 项 = 当前Ref.current;
    if (!项) return;
    if (项.kind === "提示") 项.resolve();
    else 项.resolve(输入值.trim());
    收尾并出下一个();
  }, [输入值, 收尾并出下一个]);

  const 弹窗 =
    当前 && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4"
            onClick={关闭}
          >
            <div
              className="bg-white rounded-xl shadow-2xl w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-4 pb-2">
                <h3 className="text-base font-semibold text-gray-900">
                  {当前.选项.title ?? (当前.kind === "输入" ? "请输入" : "提示")}
                </h3>
              </div>
              <div className="px-5 pb-4">
                <p className="text-sm text-gray-600 whitespace-pre-line">{当前.选项.message}</p>
                {当前.kind === "输入" && (
                  <input
                    autoFocus
                    className="mt-3 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={当前.选项.placeholder || ""}
                    value={输入值}
                    onChange={(e) => 设置输入值(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") 确定();
                    }}
                  />
                )}
              </div>
              <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
                {当前.kind === "输入" && (
                  <button
                    type="button"
                    onClick={关闭}
                    className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                )}
                <button
                  type="button"
                  autoFocus={当前.kind === "提示"}
                  onClick={确定}
                  className="px-4 py-2 text-sm text-white rounded-lg bg-blue-600 hover:bg-blue-700"
                >
                  {当前.选项.confirmText ?? "确定"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {children}
      {弹窗}
    </>
  );
}
