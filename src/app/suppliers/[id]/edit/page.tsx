"use client";

import { use } from "react";
import SupplierForm from "../../SupplierForm";

export default function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SupplierForm editMode supplierId={id} />;
}
