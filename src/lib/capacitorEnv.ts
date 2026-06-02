/* ========== Capacitor APP 环境相关工具函数 ========== */

/**
 * 检测是否在 Capacitor APP 环境中（WebView）
 */
export function 是Capacitor环境(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Record<string, unknown>;
  if (!!w.Capacitor) return true;
  if (!!w.CapacitorIsNative) return true;
  if (!!w.Ionic) return true;
  return false;
}

/**
 * 获取当前环境类型
 */
export function 获取当前环境(): "APP" | "浏览器" | "服务端" {
  if (typeof window === "undefined") return "服务端";
  if (是Capacitor环境()) return "APP";
  return "浏览器";
}

/**
 * 在 APP 中打开系统设置页面的应用详情页
 * 非 APP 环境则弹出 alert 提示
 */
export function 打开APP设置(): void {
  if (!是Capacitor环境()) {
    alert("请手动前往手机设置 → 应用 → 汽修管家 → 权限 → 相机，开启相机权限");
    return;
  }

  try {
    const w = window as Record<string, unknown>;
    if (w.AndroidApp) {
      (w.AndroidApp as { openAppSettings: () => void }).openAppSettings();
      return;
    }
  } catch { /* 忽略 */ }

  alert("请手动前往手机设置 → 应用 → 汽修管家 → 权限 → 相机，开启相机权限");
}
