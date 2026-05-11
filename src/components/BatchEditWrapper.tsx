"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BatchEditModal } from "./BatchEditModal";

interface Props {
  orderId: string;
  items: any[];
  itemParts: any[];
  suppliers: any[];
  logisticsCompanies: any[];
}

export function BatchEditWrapper({ orderId, items, itemParts, suppliers, logisticsCompanies }: Props) {
  const router = useRouter();
  const [show, setShow] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShow(true)}
        className="text-sm text-gray-600 hover:text-gray-900 font-medium"
      >
        批量修改
      </button>
      {show && (
        <BatchEditModal
          orderId={orderId}
          items={items}
          itemParts={itemParts}
          suppliers={suppliers}
          logisticsCompanies={logisticsCompanies}
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
