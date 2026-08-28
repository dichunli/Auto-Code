"use client";

import { Children, useEffect, useState } from "react";
import { 保存排序 } from "@/app/work-orders/actions";
import { ItemLevelSortContext, PartLevelSortContext } from "@/lib/sortOrderContext";

interface Props {
  ids: string[];
  groupKey: string;
  tableName: "work_order_items" | "work_order_item_parts";
  extraIdMap?: Record<string, string[]>; // 用于配件组：key=groupId, value=该组下所有分支id
  children: React.ReactNode;
}

export default function SortableList({ ids, tableName, extraIdMap, children }: Props) {
  const [orderedIds, setOrderedIds] = useState<string[]>(ids);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  /* 只有按住手柄才允许拖动：记录当前按住手柄的行 id。
   * 之前整行 draggable，在备注/价格等输入框上按鼠标移动也会误拖整行 */
  const [按住手柄的行id, set按住手柄的行id] = useState<string | null>(null);

  useEffect(() => {
    setOrderedIds(ids);
  }, [JSON.stringify(ids)]);

  const childArray = Children.toArray(children);

  async function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }

    const fromIndex = orderedIds.indexOf(draggingId);
    const toIndex = orderedIds.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }

    const newIds = [...orderedIds];
    newIds.splice(fromIndex, 1);
    newIds.splice(toIndex, 0, draggingId);
    setOrderedIds(newIds);
    setDraggingId(null);
    setDragOverId(null);

    // 收集所有需要更新的 id → sort_order
    const updateMap: Record<string, number> = {};
    newIds.forEach((id, index) => {
      const order = index + 1;
      updateMap[id] = order;
      // 如果是配件组，同组所有分支共享同一个 sort_order
      if (extraIdMap && extraIdMap[id]) {
        extraIdMap[id].forEach((extraId) => {
          updateMap[extraId] = order;
        });
      }
    });

    // 写库走 Server Action（upsert 会要求补全所有 not-null 字段，用 update）
    const 结果 = await 保存排序({ tableName, updates: updateMap });
    if (!结果.success) {
      console.error("排序保存失败:", 结果.error);
      alert("排序保存失败，请检查网络或刷新后重试");
      return;
    }

    /* 局部更新：行位置已在上面本地更新，无需整页刷新。
     * 轻提示告知已保存；行号文本暂不跟随（下次整页刷新自动重排）。 */
    window.dispatchEvent(
      new CustomEvent("wo-saved-pending", {
        detail: { message: "排序已保存" },
      })
    );
  }

  // 按 tableName 选择排序 Context：项目级 / 配件级，序号组件从 Context 读位置自动重排
  const Provider = tableName === "work_order_items" ? ItemLevelSortContext.Provider : PartLevelSortContext.Provider;

  return (
    <Provider value={orderedIds}>
      <div className="space-y-2">
        {orderedIds.map((id) => {
        const childIndex = ids.indexOf(id);
        const child = childArray[childIndex];
        const isDragging = draggingId === id;
        const isOver = dragOverId === id;
        return (
          <div
            key={id}
            draggable={按住手柄的行id === id}
            onDragStart={(e) => {
              setDraggingId(id);
              e.dataTransfer.effectAllowed = "move";
              // Firefox 需要设置 dataTransfer 数据
              e.dataTransfer.setData("text/plain", id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDragOverId(null);
              set按住手柄的行id(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (draggingId && draggingId !== id) {
                setDragOverId(id);
              }
            }}
            onDragLeave={() => setDragOverId((prev) => (prev === id ? null : prev))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(id);
            }}
            className={`transition-all ${isDragging ? "opacity-50" : "opacity-100"} ${isOver ? "ring-2 ring-blue-400 rounded-lg" : ""}`}
          >
            <div className="flex items-start gap-1.5">
              <div
                className="hidden md:block mt-0.5 cursor-move text-gray-300 hover:text-gray-500 select-none shrink-0"
                title="按住拖动排序"
                onMouseDown={() => set按住手柄的行id(id)}
                onMouseUp={() => set按住手柄的行id(null)}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="9" cy="6" r="1.5" />
                  <circle cx="15" cy="6" r="1.5" />
                  <circle cx="9" cy="12" r="1.5" />
                  <circle cx="15" cy="12" r="1.5" />
                  <circle cx="9" cy="18" r="1.5" />
                  <circle cx="15" cy="18" r="1.5" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">{child}</div>
            </div>
          </div>
        );
      })}
      </div>
    </Provider>
  );
}
