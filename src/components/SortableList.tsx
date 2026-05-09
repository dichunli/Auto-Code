"use client";

import { Children, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface Props {
  ids: string[];
  groupKey: string;
  tableName: "work_order_items" | "work_order_item_parts";
  extraIdMap?: Record<string, string[]>; // 用于配件组：key=groupId, value=该组下所有分支id
  children: React.ReactNode;
}

export default function SortableList({ ids, groupKey, tableName, extraIdMap, children }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [orderedIds, setOrderedIds] = useState<string[]>(ids);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

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

    // 逐个更新（upsert 会要求补全所有 not-null 字段，改用 update）
    const entries = Object.entries(updateMap);
    let hasError = false;
    for (const [updateId, sort_order] of entries) {
      const { error } = await supabase
        .from(tableName)
        .update({ sort_order })
        .eq("id", updateId);
      if (error) {
        hasError = true;
        console.error("排序保存失败:", error);
      }
    }
    if (hasError) {
      alert("排序保存失败，请检查网络或刷新后重试");
    }

    router.refresh();
  }

  return (
    <div className="space-y-2">
      {orderedIds.map((id) => {
        const childIndex = ids.indexOf(id);
        const child = childArray[childIndex];
        const isDragging = draggingId === id;
        const isOver = dragOverId === id;
        return (
          <div
            key={id}
            draggable
            onDragStart={(e) => {
              setDraggingId(id);
              e.dataTransfer.effectAllowed = "move";
              // Firefox 需要设置 dataTransfer 数据
              e.dataTransfer.setData("text/plain", id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDragOverId(null);
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
                className="mt-0.5 cursor-move text-gray-300 hover:text-gray-500 select-none shrink-0"
                title="拖动排序"
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
  );
}
