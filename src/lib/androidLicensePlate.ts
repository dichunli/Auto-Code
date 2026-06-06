/* ========== Android 原生车牌识别桥接 ========== */

declare global {
  interface Window {
    AndroidLicensePlateRecognizer?: {
      startRecognize: () => void;
    };
  }
}

/**
 * 原生车牌识别结果
 */
export interface 原生车牌结果 {
  plate?: string;
  error?: string;
  cancelled?: boolean;
}

/**
 * 启动 Android 原生车牌识别
 * @returns Promise，解析为车牌识别结果
 */
export function 启动原生车牌识别(): Promise<原生车牌结果> {
  return new Promise((resolve) => {
    if (!window.AndroidLicensePlateRecognizer) {
      resolve({ error: "原生车牌识别不可用" });
      return;
    }

    const 事件名 = "nativeLicensePlateResult";

    const 监听器 = (event: Event) => {
      window.removeEventListener(事件名, 监听器);

      const customEvent = event as CustomEvent<Record<string, unknown>>;
      const detail = customEvent.detail;

      if (detail && typeof detail.plate === "string" && detail.plate.length > 0) {
        resolve({ plate: detail.plate });
      } else if (detail && detail.cancelled === true) {
        resolve({ cancelled: true });
      } else {
        resolve({ error: typeof detail?.error === "string" ? detail.error : "识别失败" });
      }
    };

    window.addEventListener(事件名, 监听器);
    window.AndroidLicensePlateRecognizer.startRecognize();
  });
}

/**
 * 检测当前是否有网络连接
 */
export function 有网络(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}
