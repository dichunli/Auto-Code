import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import AutoLinkedPartsReportTable from "./AutoLinkedPartsReportTable";

export default async function AutoLinkedPartsReportPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("part_vehicle_models")
    .select(`
      id,
      notes,
      created_at,
      parts(
        id,
        name,
        part_number,
        part_names(
          name,
          auto_link_vehicle_model,
          part_categories(name, auto_link_vehicle_model)
        )
      ),
      vehicle_models(
        厂商,
        品牌,
        车系,
        车型,
        销售版本,
        年款,
        排量,
        发动机型号,
        燃油类型,
        进气形式,
        变速箱类型,
        变速箱代号,
        底盘代号,
        驱动方式,
        车身类型,
        排放标准
      )
    `)
    .order("created_at", { ascending: false });

  const autoLinkedRows = (rows || []).filter((row: any) => {
    return (
      row.parts?.part_names?.auto_link_vehicle_model ||
      row.parts?.part_names?.part_categories?.auto_link_vehicle_model
    );
  });

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="自动关联配件"
        description="查看系统自动从工单中建立的配件与车型关联，并可直接更新备注或删除关联。"
      />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">自动关联记录</h2>
            <p className="text-sm text-gray-500 mt-1">共 {autoLinkedRows.length} 条自动关联</p>
          </div>
        </div>

        <AutoLinkedPartsReportTable rows={autoLinkedRows} />
      </div>
    </div>
  );
}
