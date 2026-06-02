/* ============================================================
   三滤类型判断
   从配件名称中提取机油滤/空气滤/空调滤类型
   ============================================================ */

export type 三滤类型 = "oil" | "air" | "cabin";

/* 从配件名称判断三滤类型 */
export function 判断三滤类型(name: string): 三滤类型 | null {
  const n = name.toLowerCase();
  /* 机油滤 */
  if ((n.includes("机油") || n.includes("oil") || n.includes("öl")) && (n.includes("滤") || n.includes("filter"))) {
    return "oil";
  }
  /* 空气滤 */
  if ((n.includes("空气") || n.includes("air") || n.includes("luft")) && (n.includes("滤") || n.includes("filter"))) {
    return "air";
  }
  /* 空调滤 / 花粉滤 / 粉尘滤 */
  if ((n.includes("空调") || n.includes("cabin") || n.includes("花粉") || n.includes("pollen") || n.includes("粉尘") || n.includes("dust") || n.includes("innenraum")) && (n.includes("滤") || n.includes("filter"))) {
    return "cabin";
  }
  return null;
}

/* 三滤类型转中文名称 */
export function 三滤类型名称(type: 三滤类型): string {
  const map: Record<三滤类型, string> = {
    oil: "机油滤",
    air: "空气滤",
    cabin: "空调滤",
  };
  return map[type];
}

/* 三滤类型转全称 */
export function 三滤类型全称(type: 三滤类型): string {
  const map: Record<三滤类型, string> = {
    oil: "机油滤清器",
    air: "空气滤清器",
    cabin: "空调滤清器",
  };
  return map[type];
}

/* 精准匹配三滤名称（用于Excel导入等严格场景） */
export function 精准三滤类型(name: string): 三滤类型 | null {
  const n = name.trim();
  if (n === "机油滤" || n === "机油滤清器") return "oil";
  if (n === "空气滤" || n === "空气滤清器") return "air";
  if (n === "空调滤" || n === "空调滤清器") return "cabin";
  return null;
}
