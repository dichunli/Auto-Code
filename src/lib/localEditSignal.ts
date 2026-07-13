/**
 * 本地编辑信号（工单配件实时同步用）
 *
 * 作用：区分"自己刚改的配件" vs "别人改的配件"。
 * 自己改动时已做局部更新，无需再被实时同步刷整页；
 * 别人的改动仍照常刷新，保住多人协作。
 *
 * 按"具体配件分支ID"精确判断，别人改别的配件不受影响。
 */

// 配件分支ID -> 自己最近改动的时间戳
const 最近本地编辑 = new Map<string, number>();

// 默认有效窗口（毫秒）：覆盖写库 + 远程实时推送回来的延迟
const 默认窗口 = 5000;

// 本机"最近任意操作"的时间戳：任何本地改动都会更新它。
// 用于抑制"自己操作引起的连锁更新"(如改配件触发数据库重算工单合计)误弹刷新提示。
let 最近本机操作时间 = 0;
export function 标记本机操作(): void { 最近本机操作时间 = Date.now(); }
export function 是否本机最近操作(窗口毫秒: number = 6000): boolean {
  return 最近本机操作时间 > 0 && Date.now() - 最近本机操作时间 <= 窗口毫秒;
}

/** 标记：某条配件分支是"自己刚改的" */
export function 标记本地编辑配件(分支id: string): void {
  if (!分支id) return;
  最近本地编辑.set(分支id, Date.now());
  标记本机操作();
}

/** 判断：某条配件分支是否是"自己刚改的"（在有效窗口内） */
export function 是否自己刚改的配件(分支id: string, 窗口毫秒: number = 默认窗口): boolean {
  if (!分支id) return false;
  const t = 最近本地编辑.get(分支id);
  if (!t) return false;
  if (Date.now() - t > 窗口毫秒) {
    最近本地编辑.delete(分支id);
    return false;
  }
  return true;
}

// 项目ID -> 自己最近"结构性改动"(加/删分支等需自己刷新)的时间戳
const 最近本地结构编辑 = new Map<string, number>();

/**
 * 标记：某个维修项目刚被自己"结构性改动"(加/删分支、删组、换名等)。
 * 这类操作自己会 router.refresh 拉到最新(含别人的改动)，
 * 所以实时同步无需再为这次改动重复刷整页。
 */
export function 标记本地结构编辑(项目id: string): void {
  if (!项目id) return;
  最近本地结构编辑.set(项目id, Date.now());
  标记本机操作();
}

/** 判断：某个项目是否刚被自己结构性改动(在有效窗口内) */
export function 是否自己刚结构改动的项目(项目id: string, 窗口毫秒: number = 默认窗口): boolean {
  if (!项目id) return false;
  const t = 最近本地结构编辑.get(项目id);
  if (!t) return false;
  if (Date.now() - t > 窗口毫秒) {
    最近本地结构编辑.delete(项目id);
    return false;
  }
  return true;
}
