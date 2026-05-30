"use client";

import { useState } from "react";
import ItemBatchPickerModal from "./ItemBatchPickerModal";

interface Props {
  orderId: string;
  requirementId: string;
  vehicleModelId?: number | null;
}

export default function AddRequirementItemsButton({ orderId, requirementId, vehicleModelId }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:text-blue-700"
      >
        +项目
      </button>
      <ItemBatchPickerModal
        open={open}
        onClose={() => setOpen(false)}
        orderId={orderId}
        requirementId={requirementId}
        vehicleModelId={vehicleModelId}
      />
    </>
  );
}
