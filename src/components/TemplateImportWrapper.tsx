"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TemplateImportModal } from "./TemplateImportModal";

interface Props {
  vehicleId: string;
  orderId: string;
}

export function TemplateImportWrapper({ vehicleId, orderId }: Props) {
  const router = useRouter();
  const [show, setShow] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShow(true)}
        className="text-sm text-green-600 hover:text-green-700 font-medium"
      >
        导入保养模板
      </button>
      {show && (
        <TemplateImportModal
          vehicleId={vehicleId}
          orderId={orderId}
          onClose={() => setShow(false)}
          onSuccess={() => {
            setShow(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
