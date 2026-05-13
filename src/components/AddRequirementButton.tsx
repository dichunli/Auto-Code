"use client";

import { useState } from "react";
import RequirementBatchModal from "./RequirementBatchModal";

interface Props {
  orderId: string;
}

export default function AddRequirementButton({ orderId }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-blue-600 hover:text-blue-700"
      >
        + 添加客户需求
      </button>
      <RequirementBatchModal open={open} onClose={() => setOpen(false)} orderId={orderId} />
    </>
  );
}
