/* ========== APP 原生水印录像机桥接 ========== */

interface 水印录像结果 {
  filePath?: string;
  cancelled?: boolean;
  error?: string;
}

/**
 * 启动 APP 原生水印录像机
 * @param 水印文字 可选，不传则使用当前时间
 * @returns 带水印的视频本地绝对路径
 */
export function 启动原生水印录像机(水印文字?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = window as Record<string, unknown>;
    const bridge = w.AndroidWatermarkVideo as
      | { startCapture: (text: string) => void }
      | undefined;

    if (!bridge) {
      reject(new Error("当前环境不支持原生水印录像机"));
      return;
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as 水印录像结果;
      window.removeEventListener("nativeWatermarkVideoResult", handler);

      if (detail.cancelled) {
        reject(new Error("cancelled"));
        return;
      }
      if (detail.error) {
        reject(new Error(detail.error));
        return;
      }
      if (detail.filePath) {
        resolve(detail.filePath);
        return;
      }
      reject(new Error("录像失败"));
    };

    window.addEventListener("nativeWatermarkVideoResult", handler);

    try {
      bridge.startCapture(水印文字 || "");
    } catch (err: unknown) {
      window.removeEventListener("nativeWatermarkVideoResult", handler);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
