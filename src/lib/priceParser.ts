/* ============================================================
   价格/金额解析
   防止浮点数精度问题，统一处理字符串↔number转换
   ============================================================ */

/* 解析价格字符串为number，空值返回NULL */
export function 解析价格(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = parseFloat(String(value).trim());
  if (isNaN(num)) return null;
  /* 保留2位小数，避免浮点数精度问题 */
  return Math.round(num * 100) / 100;
}

/* 解析数量字符串为number */
export function 解析数量(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = parseFloat(String(value).trim());
  if (isNaN(num)) return null;
  return num;
}

/* 金额加法：避免浮点数精度问题（先转整数分再计算） */
export function 金额加(a: number, b: number): number {
  return Math.round(a * 100 + b * 100) / 100;
}

/* 金额减法 */
export function 金额减(a: number, b: number): number {
  return Math.round(a * 100 - b * 100) / 100;
}

/* 金额乘法 */
export function 金额乘(a: number, b: number): number {
  return Math.round(a * 100 * b) / 100;
}

/* 格式化金额显示（保留2位小数） */
export function 格式化金额(value: number): string {
  return value.toFixed(2);
}
