/* ═══ 全局命令式轻提示桥 ═══
 * 用途：替代浏览器原生 alert() 的大规模改造（2026-09-13 弹窗治理）。
 * 原来的 alert(x) 只需换成 toast(x, "error")，不需要在 200+ 个组件里
 * 逐个插 useToast Hook——Hook 只能用在组件里，这个函数哪里都能调。
 *
 * 原理：PC 端 ToastProvider / 手机端 MobileToastProvider 挂载时各注册一次
 * 回调进来；同一时刻只有一个布局的 Provider 在活动，谁挂载用谁。 */

export type Toast类型 = "success" | "error" | "warning";

let 已注册回调: ((message: string, type?: Toast类型) => void) | null = null;

/* 供 Provider 挂载时调用，返回卸载时的注销函数 */
export function 注册全局Toast(回调: (message: string, type?: Toast类型) => void): () => void {
  已注册回调 = 回调;
  return () => {
    if (已注册回调 === 回调) 已注册回调 = null;
  };
}

/* 全局轻提示：与 useToast 的 showToast 同一渲染通道 */
export function toast(message: string, type: Toast类型 = "success"): void {
  if (已注册回调) {
    已注册回调(message, type);
  } else {
    /* AppShell（PC）和 m/layout（手机）都挂了 Provider，正常不会走到这；
       兜底只在控制台留痕，不丢消息内容 */
    console.warn("[toast] Provider 未挂载:", type, message);
  }
}
