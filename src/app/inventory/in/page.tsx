import { Suspense } from "react";
import InventoryInForm from "./InventoryInForm";

export default function InventoryInPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">加载中...</div>}>
      <InventoryInForm />
    </Suspense>
  );
}
