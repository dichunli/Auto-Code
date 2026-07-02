"use client";

import { useState } from "react";
import { AssignMechanicModal } from "./AssignMechanicModal";

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
  profiles: Profile[];
  mechanicGroups: MechanicGroup[];
  existingMechanics: ExistingMechanic[];
}

export function ItemMechanicAssigner({ itemId, profiles, mechanicGroups, existingMechanics }: Props) {
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
        className="px-1.5 py-0.5 border border-gray-200 rounded text-[10px] bg-white hover:bg-gray-50 cursor-pointer"
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
        onSaved={(newMechanics) => setMechanics(newMechanics)}
      />
    </>
  );
}
