import { Suspense } from "react";
import PartForm from "./PartForm";

export default function NewPartPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">加载中...</div>}>
      <PartForm />
    </Suspense>
  );
}
