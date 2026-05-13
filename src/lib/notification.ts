/** 请求浏览器桌面通知权限 */
export function requestNotificationPermission() {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) {
    console.log("当前浏览器不支持桌面通知");
    return;
  }
  if (Notification.permission === "default") {
    Notification.requestPermission().then((permission) => {
      console.log("桌面通知权限:", permission);
    });
  }
}

/** 发送浏览器桌面通知 */
export function sendBrowserNotification(title: string, body?: string) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    new Notification(title, {
      body,
      icon: "/favicon.ico",
    });
  } catch (e) {
    console.error("发送桌面通知失败:", e);
  }
}
