"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddWorkOrderItemPartModal } from "./AddWorkOrderItemPartModal";

interface Props {
  itemId: string;
  serviceNameId?: string | null;
  itemName: string;
}

export default function AddItemPartButton({ itemId, serviceNameId, itemName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
