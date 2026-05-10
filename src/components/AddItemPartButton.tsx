"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddWorkOrderItemPartModal } from "./AddWorkOrderItemPartModal";

interface Props {
  itemId: string;
  serviceNameId?: string | null;
  itemName: string;
  vehicleModelId?: string | null;
}

export default function AddItemPartButton({ itemId, serviceNameId, itemName, vehicleModelId }: Props) {
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
          serviceNameId={serviceNameId}
          itemName={itemName}
          vehicleModelId={vehicleModelId}
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
