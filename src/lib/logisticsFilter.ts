// 根据供应商地域过滤物流公司列表
// 业务规则：
//   - 本地（local）→ 供应商送货上门，不需要物流，返回空数组（UI 应隐藏物流选择）
//   - 哈市（harbin）→ 只显示 scopes 包含 'harbin' 的物流公司
//   - 外阜（outside）→ 只显示 scopes 包含 'outside' 的物流公司
//   - 未知 → 返回全部，保持兼容
//   scopes 是物流公司服务范围数组，一个公司可同时服务多个区域

export type SupplierRegion = "local" | "harbin" | "outside" | null | undefined;

interface LogisticsCompany {
  id: string;
  name: string;
  scopes?: string[] | null;
}

interface SupplierLite {
  id: string;
  name: string;
  region?: string | null;
}

// 通过供应商对象过滤
export function filterLogisticsByRegion<T extends LogisticsCompany>(
  companies: T[],
  region: SupplierRegion
): T[] {
  if (!region) return companies;
  if (region === "local") return [];
  if (region === "harbin") return companies.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin"));
  if (region === "outside") return companies.filter((c) => c.scopes?.includes("outside"));
  return companies;
}

// 通过供应商名称查找区域并过滤（用于很多页面通过 supplier_name 字符串关联）
export function filterLogisticsBySupplierName<T extends LogisticsCompany>(
  companies: T[],
  supplierName: string | null | undefined,
  suppliers: SupplierLite[]
): T[] {
  if (!supplierName) return companies;
  const s = suppliers.find((sp) => sp.name === supplierName);
  return filterLogisticsByRegion(companies, s?.region as SupplierRegion);
}

// 通过供应商 ID 查找区域并过滤
export function filterLogisticsBySupplierId<T extends LogisticsCompany>(
  companies: T[],
  supplierId: string | null | undefined,
  suppliers: SupplierLite[]
): T[] {
  if (!supplierId) return companies;
  const s = suppliers.find((sp) => sp.id === supplierId);
  return filterLogisticsByRegion(companies, s?.region as SupplierRegion);
}

// 判断某供应商是否需要展示物流相关字段
export function supplierNeedsLogistics(region: SupplierRegion): boolean {
  return region !== "local";
}

// 区域显示文案
export const REGION_LABELS: Record<string, string> = {
  local: "本地",
  harbin: "哈市",
  outside: "外阜",
};
