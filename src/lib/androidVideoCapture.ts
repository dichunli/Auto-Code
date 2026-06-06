/* ========== Android 原生录像桥接 ========== */

import { Capacitor } from "@capacitor/core";

declare global {
  interface Window {
    AndroidVideoCapture?: {
      startCapture: () => void;
    };
  }
}

/**
 * 原生录像结果
 */
export interface 原生录像结果 {
  filePath?: string;
  error?: string;
  cancelled?: boolean;
}

/**
 * 启动 Android 原生录像
 * @returns Promise，解析为录像结果（filePath 为本地绝对路径）
 */
export function 启动原生录像(): Promise<原生录像结果> {
  return new Promise((resolve) => {
    if (!window.AndroidVideoCapture) {
      resolve({ error: "原生录像不可用" });
      return;
    }

    const 事件名 = "nativeVideoCaptureResult";

    const 监听器 = (event: Event) => {
      window.removeEventListener(事件名, 监听器);

      const customEvent = event as CustomEvent<Record<string, unknown>>;
      const detail = customEvent.detail;

      if (detail && typeof detail.filePath === "string" && detail.filePath.length > 0) {
        resolve({ filePath: detail.filePath });
      } else if (detail && detail.cancelled === true) {
        resolve({ cancelled: true });
      } else {
        resolve({ error: typeof detail?.error === "string" ? detail.error : "录像失败" });
      }
    };

    window.addEventListener(事件名, 监听器);
    window.AndroidVideoCapture.startCapture();
  });
}

/**
 * 将 Android 本地文件路径转为 WebView 可访问的 URL
 */
export function 本地文件路径转URL(filePath: string): string {
  return Capacitor.convertFileSrc(filePath);
}
