/* ========== Capacitor APP 环境相关工具函数 ========== */

import { Capacitor } from "@capacitor/core";

/**
 * 检测是否在 Capacitor APP 环境中（真·原生 WebView）
 *
 * 【关键】不能用 `!!window.Capacitor` 判断！
 * 因为浏览器里只要 import 了 @capacitor/core（如 ImageUploader/VideoUploader
 * 引入的 @capacitor/camera），它就会在浏览器里创建一个 window.Capacitor「Web 垫片」，
 * 导致 `!!window.Capacitor` 在普通浏览器里也为 true → 被误判成 APP →
 * 认证读错存储位置（-app 空位置）→ 保存请求不带 token → RLS 拒绝(401/42501)。
 *
 * 正确做法：用官方 Capacitor.isNativePlatform()，它只在真正的原生 APP 里返回 true，
 * 浏览器（含 Web 垫片）返回 false。
 */
export function 是Capacitor环境(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
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
