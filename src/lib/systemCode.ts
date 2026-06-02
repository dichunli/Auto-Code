/* ============================================================
   系统码生成
   防止格式不统一、序号计算出错
   ============================================================ */

/* 生成配件系统码：格式 PJYYYYMMDD001 */
export function 生成配件系统码(日期?: Date): string {
  const d = 日期 || new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
  return `PJ${dateStr}`;
}

/* 生成配件系统码前缀（用于查当天已有编码） */
export function 配件系统码前缀(日期?: Date): string {
  const d = 日期 || new Date();
  return `PJ${d.toISOString().slice(0, 10).replace(/-/g, "")}`;
}

/* 生成完整系统码（带序号） */
export function 生成完整系统码(前缀: string, 序号: number): string {
  return `${前缀}${String(序号).padStart(3, "0")}`;
}

/* 从已有系统码中提取序号
   格式：前缀(字母) + 日期(8位) + 序号(3位)，带序号的总长度至少11位 */
export function 提取系统码序号(系统码: string): number {
  if (系统码.length < 11) return 0;
  const suffix = 系统码.slice(-3);
  const num = parseInt(suffix, 10);
  return isNaN(num) ? 0 : num;
}
