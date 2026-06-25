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

/** 标记：某条配件分支是"自己刚改的" */
export function 标记本地编辑配件(分支id: string): void {
  if (!分支id) return;
  最近本地编辑.set(分支id, Date.now());
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
