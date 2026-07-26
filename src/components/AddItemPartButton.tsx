"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddWorkOrderItemPartModal } from "./AddWorkOrderItemPartModal";

interface Props {
  itemId: string;
  serviceItemId?: string | null;
  itemName: string;
  vehicleModelId?: number | null;
  vin?: string | null;
}

export default function AddItemPartButton({ itemId, serviceItemId, itemName, vehicleModelId, vin }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-green-600 hover:text-green-700 font-medium"
      >
        + 添加配件
      </button>
      {open && (
        <AddWorkOrderItemPartModal
          open={open}
          itemId={itemId}
          serviceItemId={serviceItemId}
          itemName={itemName}
          vehicleModelId={vehicleModelId}
          vin={vin}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
