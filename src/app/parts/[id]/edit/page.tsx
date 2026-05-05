import PartForm from "../../new/PartForm";

export default async function PartEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartForm editId={id} />;
}
