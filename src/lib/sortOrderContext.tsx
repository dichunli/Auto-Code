"use client";

import { createContext, useContext } from "react";

/* 拖拽排序状态共享：
 * SortableList 把当前排序 id 列表通过 Context 提供给子树，
 * 序号组件从 Context 读自己的位置——拖拽后 orderedIds 变化，
 * 序号自动重算，无需整页刷新。
 * 两层：项目级（work_order_items）+ 配件级（work_order_item_parts）。 */
export const ItemLevelSortContext = createContext<string[]>([]);
export const PartLevelSortContext = createContext<string[]>([]);

/** 项目在项目级排序列表中的位置（1 起），找不到返回 1 */
export function useItemPosition(itemId: string): number {
  const ids = useContext(ItemLevelSortContext);
  const idx = ids.indexOf(itemId);
  return idx >= 0 ? idx + 1 : 1;
}

/** 配件组在配件级排序列表中的位置（1 起），找不到返回 1 */
export function usePartPosition(repId: string): number {
  const ids = useContext(PartLevelSortContext);
  const idx = ids.indexOf(repId);
  return idx >= 0 ? idx + 1 : 1;
}
