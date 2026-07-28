/* 工单详情标签的本地存储工具（WorkOrderTabBar / WorkOrdersContent 共用） */

export const 工单标签存储键 = "wo_open_tabs";

/* 从本地存储读已打开的工单标签（仅客户端可用；服务端/异常时返回空数组） */
export function 读本地工单标签(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(工单标签存储键) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}
