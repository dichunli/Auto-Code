"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PartWorkflowStatus,
  WORKFLOW_STATUS_LABELS,
  WORKFLOW_STATUS_COLORS,
} from "@/lib/partWorkflow";
import { PickingModal } from "./PickingModal";
import { PartReturnModal } from "./PartReturnModal";
import { SupplierReturnModal } from "./SupplierReturnModal";

interface Props {
  status: PartWorkflowStatus;
  partName: string;
  workOrderItemPartId: string;
  partId: string | null;
  quantity: number;
  pickedQty: number;
  returnQty: number;
  suppliers: { id: string; name: string }[];
  logisticsCompanies: { id: string; name: string }[];
  locked?: boolean;
}

export function PartWorkflowActions({
  status,
  partName,
  workOrderItemPartId,
  partId,
  quantity,
  pickedQty,
  returnQty,
  suppliers,
  logisticsCompanies,
  locked = false,
}: Props) {
  const router = useRouter();
  const [showPicking, setShowPicking] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [showSupplierReturn, setShowSupplierReturn] = useState(false);

  const canPick = status === "pending_picking";
  const canReturn = status === "picked" && pickedQty > 0;
  const canSupplierReturn = returnQty > 0;

  function refresh() {
    router.refresh();
  }

  return (
    <>
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border ${WORKFLOW_STATUS_COLORS[status]}`}
      >
        {WORKFLOW_STATUS_LABELS[status]}
      </span>

      {!locked && canPick && (
        <button
          type="button"
          onClick={() => setShowPicking(true)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200"
        >
          领料
        </button>
      )}

      {!locked && canReturn && (
        <button
          type="button"
          onClick={() => setShowReturn(true)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
        >
          退库
        </button>
      )}

      {!locked && canSupplierReturn && (
        <button
          type="button"
          onClick={() => setShowSupplierReturn(true)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200"
        >
          退货给供应商
        </button>
      )}

      <PickingModal
        open={showPicking}
        partId={partId}
        partName={partName}
        workOrderItemPartId={workOrderItemPartId}
        quantityNeeded={quantity - pickedQty}
        onClose={() => setShowPicking(false)}
        onSuccess={refresh}
      />

      <PartReturnModal
        open={showReturn}
        partName={partName}
        workOrderItemPartId={workOrderItemPartId}
        onClose={() => setShowReturn(false)}
        onSuccess={refresh}
      />

      <SupplierReturnModal
        open={showSupplierReturn}
        partName={partName}
        workOrderItemPartId={workOrderItemPartId}
        maxQty={returnQty}
        suppliers={suppliers}
        logisticsCompanies={logisticsCompanies}
        onClose={() => setShowSupplierReturn(false)}
        onSuccess={refresh}
      />
    </>
  );
}
