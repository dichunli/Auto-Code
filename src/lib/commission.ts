// 提成计算工具函数
// 支持 revenue_pct（营收百分比）、profit_pct（利润百分比）、fixed（固定金额）三种类型

export interface CommissionData {
  type: string | null;
  value: number | null;
}

export interface CommissionSet {
  sales?: CommissionData;
  diagnosis?: CommissionData;
  repair?: CommissionData;
  qc?: CommissionData;
  picking?: CommissionData;
}

/** 根据类型和数值计算提成金额 */
export function calculateCommission(
  commissionType: string | null | undefined,
  commissionValue: number | null | undefined,
  revenue: number,
  cost: number = 0
): number {
  if (!commissionType || commissionValue == null) return 0;
  switch (commissionType) {
    case "revenue_pct":
      return Math.round(revenue * (commissionValue / 100) * 100) / 100;
    case "profit_pct":
      const profit = Math.max(0, revenue - cost);
      return Math.round(profit * (commissionValue / 100) * 100) / 100;
    case "fixed":
      return commissionValue;
    default:
      return 0;
  }
}

/** 从对象中提取 commission 数据 */
export function extractCommission(
  obj: any,
  prefix: string
): CommissionData | undefined {
  if (!obj) return undefined;
  const type = obj[`${prefix}_commission_type`];
  const value = obj[`${prefix}_commission_value`];
  if (type && value != null) {
    return { type, value };
  }
  return undefined;
}

/** 计算维修项目的各项提成 */
export function calculateItemCommission(
  item: any,
  serviceItem: any,
  serviceName: any,
  category: any,
  revenue: number,
  cost: number = 0
): { diagnosis: number; repair: number; sales: number; qc: number } {
  // 查找优先级：service_item → service_name → category
  const getCommission = (prefix: string): number => {
    const data =
      extractCommission(serviceItem, prefix) ||
      extractCommission(serviceName, prefix) ||
      extractCommission(category, prefix);
    if (data) {
      return calculateCommission(data.type, data.value, revenue, cost);
    }
    return 0;
  };

  return {
    diagnosis: getCommission("diagnosis"),
    repair: getCommission("repair"),
    sales: getCommission("sales"),
    qc: getCommission("qc"),
  };
}

/** 计算配件的各项提成 */
export function calculatePartCommission(
  part: any,
  partName: any,
  revenue: number,
  cost: number = 0
): { sales: number; repair: number; diagnosis: number; qc: number; picking: number } {
  // 查找优先级：part → part_name
  const getCommission = (prefix: string): number => {
    const data =
      extractCommission(part, prefix) ||
      extractCommission(partName, prefix);
    if (data) {
      return calculateCommission(data.type, data.value, revenue, cost);
    }
    return 0;
  };

  return {
    sales: getCommission("sales"),
    repair: getCommission("repair"),
    diagnosis: getCommission("diagnosis"),
    qc: getCommission("qc"),
    picking: getCommission("picking"),
  };
}

/** 计算派单/领单提成 */
export function calculateDispatchClaimCommission(
  commissionType: string | null | undefined,
  commissionValue: number | null | undefined,
  revenue: number
): number {
  if (!commissionType || commissionValue == null) return 0;
  switch (commissionType) {
    case "revenue_pct":
      return Math.round(revenue * (commissionValue / 100) * 100) / 100;
    case "profit_pct":
      return Math.round(revenue * (commissionValue / 100) * 100) / 100;
    case "fixed":
      return commissionValue;
    default:
      return 0;
  }
}

/** 查找派单/领单提成（优先级：service_item → service_name → category） */
export function getDispatchClaimCommission(
  obj: any,
  prefix: string,
  revenue: number
): number {
  const data = extractCommission(obj, prefix);
  if (data) {
    return calculateDispatchClaimCommission(data.type, data.value, revenue);
  }
  return 0;
}

/** 格式化提成显示文本 */
export function formatCommission(
  commissionType: string | null | undefined,
  commissionValue: number | null | undefined
): string {
  if (!commissionType || commissionValue == null) return "";
  switch (commissionType) {
    case "revenue_pct":
      return `营收${commissionValue}%`;
    case "profit_pct":
      return `利润${commissionValue}%`;
    case "fixed":
      return `${commissionValue}元`;
    default:
      return "";
  }
}
