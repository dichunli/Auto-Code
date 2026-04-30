import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function VehicleTemplatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("*, customers(name, phone)")
    .eq("id", id)
    .single();

  if (!vehicle) notFound();

  const { data: templates } = await supabase
    .from("vehicle_maintenance_templates")
    .select("*, vehicle_maintenance_template_items(id)")
    .eq("vehicle_id", id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title={`${vehicle.plate_number} 保养模板`}
        description={`${vehicle.brand} ${vehicle.model} · ${vehicle.customers?.name}`}
        action={{ href: `/vehicles/${id}/templates/new`, label: "新建模板" }}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm text-gray-500">共 {templates?.length || 0} 个模板</span>
        </div>
        <div className="divide-y divide-gray-100">
          {templates?.map((t: any) => (
            <div key={t.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
              <div className="flex-1">
                <div className="font-medium text-gray-900">{t.name}</div>
                <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-3">
                  {t.previous_cost !== null && (
                    <span>往期收费: {formatCurrency(t.previous_cost)}</span>
                  )}
                  <span>项目数: {t.vehicle_maintenance_template_items?.length || 0}</span>
                  <span>创建于 {formatDate(t.created_at)}</span>
                </div>
                {t.customer_notes && (
                  <div className="text-xs text-gray-400 mt-1">客户嘱咐: {t.customer_notes}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/vehicles/${id}/templates/new?copy=${t.id}`}
                  className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                >
                  复制
                </Link>
              </div>
            </div>
          ))}
          {(!templates || templates.length === 0) && (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">
              暂无保养模板，
              <Link href={`/vehicles/${id}/templates/new`} className="text-blue-600 hover:text-blue-700">新建一个</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
