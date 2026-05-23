"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import RequirementBatchModal from "./RequirementBatchModal";

interface Props {
  orderId: string;
  autoOpen?: boolean;
}

export default function AddRequirementButton({ orderId, autoOpen }: Props) {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (autoOpen || searchParams.get("newReq") === "1") {
      setOpen(true);
    }
  }, [autoOpen, searchParams]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-blue-600 hover:text-blue-700"
      >
        +需求
      </button>
      <RequirementBatchModal open={open} onClose={() => setOpen(false)} orderId={orderId} />
    </>
  );
}
