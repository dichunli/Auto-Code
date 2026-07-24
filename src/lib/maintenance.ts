/* ═════════════════════════════════════════════════════════════════
 * 保养工单核心业务逻辑（纯函数，不依赖数据库，便于单元测试）
 *
 * 保养单 = work_orders 表中 order_type='maintenance' 的记录
 * 每辆车最多一条正式保养单，用于在在修工单中快速导入复用
 * ═════════════════════════════════════════════════════════════════ */

/** 草稿单号前缀：创建保养单时先写 DRAFT- 临时单号，点"保存保养单"后才换成正式 BY- 单号。
 *  列表、导入、检查都排除该前缀，直接关窗口的残留草稿等于不存在。 */
export const 保养单草稿前缀 = "DRAFT-";

/** 判断是否未保存的保养单草稿单号 */
export function 是草稿单号(orderNo: string): boolean {
  return orderNo.startsWith(保养单草稿前缀);
}

/** 生成正式保养单单号：BY-YYYYMMDD-序号（3位补零）
 * @param 日期 8位日期字符串，如 "20260722"
 * @param 当日已有数量 当天已创建的正式保养单数量
 */
export function 生成保养单号(日期: string, 当日已有数量: number): string {
  const 序号 = String(当日已有数量 + 1).padStart(3, "0");
  return `BY-${日期}-${序号}`;
}

/** 找出待导入项目中与当前工单重复的项目名
 * @param 已有名称 当前工单已有项目名列表
 * @param 待导入名称 保养单中选中的项目名列表
 * @returns 重复的项目名（保持待导入列表中的顺序）
 */
export function 找重复项目名(已有名称: string[], 待导入名称: string[]): string[] {
  const 已有集 = new Set(已有名称);
  return 待导入名称.filter((名称) => 已有集.has(名称));
}

/** 计算需求序号顺延：导入的保养单作为需求1，已有需求全部 +1
 * @param 已有seq列表 当前工单已有需求的 seq 列表
 * @returns 每个 seq +1 后的新列表（顺序与输入一致）
 */
export function 计算需求顺延(已有seq列表: number[]): number[] {
  return 已有seq列表.map((seq) => seq + 1);
}
