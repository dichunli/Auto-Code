/* ========== Android 原生 VIN 拍照桥接 ========== */

declare global {
  interface Window {
    AndroidVinCapture?: {
      startCapture: () => void;
    };
  }
}

/**
 * 原生 VIN 拍照结果
 */
export interface 原生VIN拍照结果 {
  image?: string;
  error?: string;
  cancelled?: boolean;
}

/**
 * 启动 Android 原生 VIN 拍照
 * @returns Promise，解析为拍照结果（image 为 base64 字符串，不含 data:image 前缀）
 */
export function 启动原生VIN拍照(): Promise<原生VIN拍照结果> {
  return new Promise((resolve) => {
    if (!window.AndroidVinCapture) {
      resolve({ error: "原生VIN拍照不可用" });
      return;
    }

    const 事件名 = "nativeVinCaptureResult";

    const 监听器 = (event: Event) => {
      window.removeEventListener(事件名, 监听器);

      const customEvent = event as CustomEvent<Record<string, unknown>>;
      const detail = customEvent.detail;

      if (detail && typeof detail.image === "string" && detail.image.length > 0) {
        resolve({ image: detail.image });
      } else if (detail && detail.cancelled === true) {
        resolve({ cancelled: true });
      } else {
        resolve({ error: typeof detail?.error === "string" ? detail.error : "拍照失败" });
      }
    };

    window.addEventListener(事件名, 监听器);
    window.AndroidVinCapture.startCapture();
  });
}
