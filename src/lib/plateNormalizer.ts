/* ============================================================
   车牌号标准化
   防止忘记trim或toUpperCase
   ============================================================ */

/* 标准化车牌号：trim + toUpperCase */
export function 标准化车牌(车牌: string): string {
  return 车牌.trim().toUpperCase();
}

/* 校验车牌号是否为空 */
export function 车牌是否为空(车牌: string): boolean {
  return 车牌.trim() === "";
}
