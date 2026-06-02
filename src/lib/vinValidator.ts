/* ============================================================
   VIN码校验与标准化
   防止正则写错、忘记trim或toUpperCase
   ============================================================ */

const VIN正则 = /^[A-HJ-NPR-Z0-9]{17}$/;

/* 校验VIN码格式，返回标准化后的VIN（trim + toUpperCase） */
export function 校验VIN(vin: string): { 合法: boolean; 标准化值: string; 错误?: string } {
  const normalized = vin.trim().toUpperCase();
  if (normalized.length !== 17) {
    return { 合法: false, 标准化值: normalized, 错误: "VIN码必须为17位" };
  }
  if (!VIN正则.test(normalized)) {
    return { 合法: false, 标准化值: normalized, 错误: "VIN码包含非法字符" };
  }
  return { 合法: true, 标准化值: normalized };
}

/* 快速判断VIN是否合法 */
export function 是合法VIN(vin: string): boolean {
  return 校验VIN(vin).合法;
}

/* 标准化VIN（不校验，只做trim+toUpperCase） */
export function 标准化VIN(vin: string): string {
  return vin.trim().toUpperCase();
}
