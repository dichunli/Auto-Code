/* ========== APP 原生水印相机桥接 ========== */

interface 水印相机结果 {
  image?: string;
  cancelled?: boolean;
  error?: string;
}

/**
 * 启动 APP 原生水印相机
 * @param 水印文字 可选，不传则使用当前时间
 * @returns 带水印的图片 Base64（不含 data URL 前缀）
 */
export function 启动原生水印相机(水印文字?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = window as Record<string, unknown>;
    const bridge = w.AndroidWatermarkCamera as
      | { startCapture: (text: string) => void }
      | undefined;

    if (!bridge) {
      reject(new Error("当前环境不支持原生水印相机"));
      return;
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as 水印相机结果;
      window.removeEventListener("nativeWatermarkCameraResult", handler);

      if (detail.cancelled) {
        reject(new Error("cancelled"));
        return;
      }
      if (detail.error) {
        reject(new Error(detail.error));
        return;
      }
      if (detail.image) {
        resolve(detail.image);
        return;
      }
      reject(new Error("拍照失败"));
    };

    window.addEventListener("nativeWatermarkCameraResult", handler);

    try {
      bridge.startCapture(水印文字 || "");
    } catch (err: unknown) {
      window.removeEventListener("nativeWatermarkCameraResult", handler);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
