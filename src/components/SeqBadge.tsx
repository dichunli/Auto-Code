"use client";

import { useItemPosition } from "@/lib/sortOrderContext";

interface Props {
  itemId: string;
  前缀: string | number;
}

/* 项目序号显示（拖拽即时重排）：
 * 从项目级排序 Context 读自己当前位置，拖拽后立即重算，无需整页刷新。 */
export default function SeqBadge({ itemId, 前缀 }: Props) {
  const 位置 = useItemPosition(itemId);
  return <span className="text-xs text-gray-400 font-mono">{前缀}.{位置}</span>;
}
