/* ========== Android 原生条码扫描桥接 ========== */

declare global {
  interface Window {
    AndroidBarcodeScanner?: {
      startScan: (formatsJson: string) => void;
    };
  }
}

/**
 * 原生扫码结果
 * - barcode: 识别到的条码内容
 * - cancelled: 用户取消扫描
 */
export interface 原生扫码结果 {
  barcode?: string;
  cancelled?: boolean;
}

/**
 * 启动 Android 原生条码扫描
 * @param 格式列表 条码格式名称列表，如 ["Code128", "QrCode"]
 * @returns Promise，解析为扫码结果
 */
export function 启动原生扫码(格式列表: string[]): Promise<原生扫码结果> {
  return new Promise((resolve) => {
    if (!window.AndroidBarcodeScanner) {
      resolve({ cancelled: true });
      return;
    }

    const 事件名 = "nativeBarcodeResult";

    const 监听器 = (event: Event) => {
      window.removeEventListener(事件名, 监听器);

      const customEvent = event as CustomEvent<Record<string, unknown>>;
      const detail = customEvent.detail;

      if (detail && typeof detail.barcode === "string" && detail.barcode.length > 0) {
        resolve({ barcode: detail.barcode });
      } else {
        resolve({ cancelled: true });
      }
    };

    window.addEventListener(事件名, 监听器);
    window.AndroidBarcodeScanner.startScan(JSON.stringify(格式列表));
  });
}
