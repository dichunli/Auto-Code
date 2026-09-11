/* ============================================================
 * listUpdate — 列表局部更新工具（2026-09-12 采购管理局部刷新改造）
 *
 * 用途：列表页修改某条数据后，不再整表重新查询，而是用这两个
 * 不可变更新函数只 patch 被改的那一条。配合各列表 useMemo
 * 派生的分组/计数，界面自动只重渲染变化的行。
 * ============================================================ */

/** 扁平列表：按 id patch 单条（patch 为对象或函数），id 不存在时原样返回 */
export function 更新列表项<T extends { id: string }>(
  列表: T[],
  id: string,
  patch: Partial<T> | ((行: T) => T)
): T[] {
  return 列表.map((行) => {
    if (行.id !== id) return 行;
    return typeof patch === "function" ? patch(行) : { ...行, ...patch };
  });
}

/** 扁平列表：按 id 集移除（条目流转到其它 TAB 时用） */
export function 移除列表项<T extends { id: string }>(
  列表: T[],
  ids: ReadonlySet<string> | string[]
): T[] {
  const 集 = ids instanceof Set ? ids : new Set(ids);
  return 列表.filter((行) => !集.has(行.id));
}
