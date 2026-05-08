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
}

export function ItemPersonSelectors({ itemId, submitterId, inspectorId, profiles, mechanicGroups, existingMechanics }: Props) {
  const [openInspector, setOpenInspector] = useState(false);

  const inspectorName = profiles.find((p) => p.id === inspectorId)?.full_name || "未分配";

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
      />
      <button
        type="button"
        onClick={() => setOpenInspector(true)}
        className="px-1 py-0.5 border border-gray-200 rounded text-[10px] bg-white hover:bg-gray-50 cursor-pointer"
      >
        质检人: {inspectorName}
      </button>
      <AssignInspectorModal
        open={openInspector}
        itemId={itemId}
        profiles={profiles}
        inspectorId={inspectorId}
        onClose={() => setOpenInspector(false)}
      />
    </div>
  );
}
