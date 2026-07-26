"use client";

import { useState } from "react";
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
            /* 局部更新：广播"重查该项目配件"事件，ItemPartsLive 只重查 1 张表重新渲染配件区，
             * 不整页刷新（整页要 20 次境外查询，3~6 秒） */
            window.dispatchEvent(
              new CustomEvent("wo-parts-reload", { detail: { itemId } })
            );
          }}
        />
      )}
    </>
  );
}
