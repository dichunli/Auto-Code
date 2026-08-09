"use client";

import { useState } from "react";
import { ItemMechanicAssigner } from "./ItemMechanicAssigner";
import { AssignInspectorModal } from "./AssignInspectorModal";

interface Profile {
  id: string;
  full_name: string;
}

interface MechanicGroup {
  id: string;
  name: string;
  members: { mechanic_id: string; profiles?: { full_name: string } | null }[];
}

interface ExistingMechanic {
  mechanic_id: string;
  share_pct: number;
  profiles?: { full_name: string } | null;
}

interface Props {
  itemId: string;
  submitterId?: string | null;
  mechanicId?: string | null;
  inspectorId?: string | null;
  profiles: Profile[];
  mechanicGroups?: MechanicGroup[];
  existingMechanics?: ExistingMechanic[];
  /* 只读（保养单未进编辑模式 / 工单已锁定）：施工人/质检人仅展示，不可修改 */
  disabled?: boolean;
}

export function ItemPersonSelectors({ itemId, submitterId, inspectorId, profiles, mechanicGroups, existingMechanics, disabled = false }: Props) {
  const [openInspector, setOpenInspector] = useState(false);
  // 本地保存当前质检人ID，保存成功后只更新这里、不刷新整页（性能优化）
  const [currentInspectorId, setCurrentInspectorId] = useState<string | null>(inspectorId ?? null);

  const inspectorName = profiles.find((p) => p.id === currentInspectorId)?.full_name || "未分配";

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <div className="px-1.5 py-0.5 text-[10px] text-gray-600 bg-gray-50 rounded border border-gray-100">
        提交人: {profiles.find((p) => p.id === submitterId)?.full_name || "-"}
      </div>
      <ItemMechanicAssigner
        itemId={itemId}
        profiles={profiles}
        mechanicGroups={mechanicGroups || []}
        existingMechanics={existingMechanics || []}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => setOpenInspector(true)}
        disabled={disabled}
        className={`px-1 py-0.5 border border-gray-200 rounded text-[10px] bg-white ${disabled ? "cursor-default text-gray-500" : "hover:bg-gray-50 cursor-pointer"}`}
      >
        质检人: {inspectorName}
      </button>
      <AssignInspectorModal
        open={openInspector}
        itemId={itemId}
        profiles={profiles}
        inspectorId={currentInspectorId}
        onClose={() => setOpenInspector(false)}
        onSaved={(newId) => {
          setCurrentInspectorId(newId);
          /* 广播：质检按钮（ItemQcActions）可见性立即刷新 */
          window.dispatchEvent(new CustomEvent("wo-item-update", { detail: { itemId } }));
        }}
      />
    </div>
  );
}
