"use client";

import { useEffect, useState } from "react";

export function BrowserNotificationToggle() {
  const [permission, setPermission] = useState<NotificationPermission | "unknown">("unknown");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  async function handleEnable() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      alert("当前浏览器不支持桌面通知");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      new Notification("通知已开启", {
        body: "当有采购状态变动时，您将收到桌面提醒",
      });
    } else if (result === "denied") {
      alert("通知权限被拒绝。如需开启，请点击地址栏左侧的锁形图标，将通知权限改为「允许」。");
    }
  }

  function handleTest() {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification("测试通知", {
        body: "这是一条测试消息，说明通知功能正常工作",
      });
    }
  }

  if (permission === "granted") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-green-600 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
          </svg>
          通知已开启
        </span>
        <button
          onClick={handleTest}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          测试一下
        </button>
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <span className="text-xs text-red-500 flex items-center gap-1" title="请检查浏览器地址栏的通知权限设置">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
        </svg>
        通知被阻止
      </span>
    );
  }

  return (
    <button
      onClick={handleEnable}
      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-colors"
    >
      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
      </svg>
      开启桌面通知
    </button>
  );
}
