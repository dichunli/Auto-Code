/* ============================================================
   字符串标准化
   防止忘记trim、忘记空转NULL
   ============================================================ */

/* 标准化字符串：trim，空值转NULL */
export function 标准化字符串(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str === "" ? null : str;
}

/* 标准化字符串并转大写（用于VIN、车牌号、OE号等） */
export function 标准化大写(value: unknown): string | null {
  const normalized = 标准化字符串(value);
  return normalized === null ? null : normalized.toUpperCase();
}

/* 标准化必填字符串：trim后如果为空抛出错误 */
export function 标准化必填字符串(value: unknown, 字段名: string): string {
  const str = 标准化字符串(value);
  if (str === null) {
    throw new Error(`${字段名}不能为空`);
  }
  return str;
}
