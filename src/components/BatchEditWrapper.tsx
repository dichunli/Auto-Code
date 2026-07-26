"use client";

import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { BatchEditModal } from "./BatchEditModal";

interface BatchItem {
  id: string;
  quantity: number;
  unit_price: number | null;
  status: string;
  expected_delivery: string | null;
}

interface ItemPart {
  id: string;
  item_id: string;
  part_id: string;
  quantity: number;
  unit_price: number | null;
  status: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface LogisticsCompany {
  id: string;
  name: string;
}

interface Props {
  orderId: string;
  items: BatchItem[];
  itemParts: ItemPart[];
  suppliers: Supplier[];
  logisticsCompanies: LogisticsCompany[];
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
          items={items as unknown as ComponentProps<typeof BatchEditModal>["items"]}
          itemParts={itemParts as unknown as ComponentProps<typeof BatchEditModal>["itemParts"]}
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
