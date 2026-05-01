import { Suspense } from "react";
import NewMemberForm from "./NewMemberForm";

export default function NewMemberPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto p-6 text-sm text-gray-500">加载中...</div>}>
      <NewMemberForm />
    </Suspense>
  );
}
