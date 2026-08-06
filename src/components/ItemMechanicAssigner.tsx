"use client";

import { useState } from "react";
import { AssignMechanicModal } from "./AssignMechanicModal";

interface Profile {
  id: string;
  /* 可空：数据源 员工档案.full_name 本身可选 */
  full_name?: string | null;
}

interface MechanicGroup {
  id: string;
  name: string;
  /* full_name 可空：数据源 技师组成员.profiles.full_name 本身可选 */
  members: { mechanic_id: string; profiles?: { full_name?: string | null } | null }[];
}

interface ExistingMechanic {
  mechanic_id: string;
  share_pct: number;
  profiles?: { full_name: string } | null;
}

interface Props {
  itemId: string;
  profiles: Profile[];
  mechanicGroups: MechanicGroup[];
  existingMechanics: ExistingMechanic[];
  /* 只读（保养单未进编辑模式 / 工单已锁定）：仅展示施工人，不可打开派工弹窗 */
  disabled?: boolean;
}

export function ItemMechanicAssigner({ itemId, profiles, mechanicGroups, existingMechanics, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  // 本地保存当前施工人列表，保存成功后只更新这里、不刷新整页（性能优化）
  const [mechanics, setMechanics] = useState<ExistingMechanic[]>(existingMechanics);

  const names = mechanics.length > 0
    ? mechanics.map((m) => m.profiles?.full_name || "-").join(", ")
    : "未分配";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`px-1.5 py-0.5 border border-gray-200 rounded text-[10px] bg-white ${disabled ? "cursor-default text-gray-500" : "hover:bg-gray-50 cursor-pointer"}`}
      >
        施工人: {names}
      </button>
      <AssignMechanicModal
        open={open}
        itemId={itemId}
        profiles={profiles}
        mechanicGroups={mechanicGroups}
        existingMechanics={mechanics}
        onClose={() => setOpen(false)}
        onSaved={(newMechanics) => {
          setMechanics(newMechanics);
          /* 广播：状态徽章（待派工→待施工）和计时按钮权限立即刷新，不整页刷新 */
          window.dispatchEvent(new CustomEvent("wo-item-update", { detail: { itemId } }));
        }}
      />
    </>
  );
}
