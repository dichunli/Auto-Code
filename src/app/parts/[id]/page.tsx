import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: part } = await supabase
    .from("parts")
    .select("*, part_names(name, unit, part_categories(name)), part_brands(name), suppliers(name)")
    .eq("id", id)
    .single();

  if (!part) {
    return (
      <div className="p-6">
        <PageHeader title="配件详情" />
        <p className="text-gray-500">配件不存在</p>
      </div>
    );
  }

  const [
    { data: vehicleModels },
    { data: stockLocations },
    { data: specialPrices },
    { data: vehiclePrices },
    { data: images },
    { data: specs },
  ] = await Promise.all([
    supabase.from("part_vehicle_models").select("vehicle_models(brand, series, model_name, year_start, year_end, engine), notes").eq("part_id", id),
    supabase.from("part_stock_locations").select("*, warehouses(name)").eq("part_id", id),
    supabase.from("part_special_prices").select("*, companies(name), customers(name, phone), vehicles(plate_number, vin)").eq("part_id", id),
    supabase.from("part_vehicle_prices").select("*, vehicle_models(brand, series, model_name, year_start, year_end, engine)").eq("part_id", id),
    supabase.from("part_images").select("*").eq("part_id", id).order("sort_order", { ascending: true }),
    supabase.from("parts_specifications").select("*, part_specifications(name)").eq("part_id", id),
  ]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="配件详情"
        action={{ href: "/inventory", label: "返回列表" }}
      />

      {/* 基础信息 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">基础信息</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <InfoItem label="系统码" value={part.system_code || "-"} />
          <InfoItem label="配件编号" value={part.part_number || "-"} />
          <InfoItem label="条形码" value={part.barcode || "-"} />
          <InfoItem label="名称" value={part.name || "-"} />
          <InfoItem label="单据名称" value={part.document_name || "-"} />
          <InfoItem label="分类" value={part.part_names?.part_categories?.name || "-"} />
          <InfoItem label="品牌" value={part.part_brands?.name || "-"} />
          <InfoItem label="单位" value={part.part_names?.unit || part.unit || "-"} />
          <InfoItem label="供应商" value={part.suppliers?.name || "-"} />
          <InfoItem label="互换码" value={part.interchange_code || "-"} />
          <InfoItem label="安全库存" value={part.min_stock ?? "-"} />
          <InfoItem label="存放位置" value={part.location || "-"} />
          <InfoItem label="备注" value={part.notes || "-"} className="sm:col-span-2 lg:col-span-3" />
        </div>
      </div>

      {/* 规格 */}
      {specs && specs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">规格</h2>
          <div className="flex flex-wrap gap-2">
            {specs.map((s: any) => (
              <span key={s.id} className="px-2 py-1 bg-gray-100 rounded text-sm text-gray-700">
                {s.part_specifications?.name || "-"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 价格信息 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">价格信息</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
          <InfoItem label="成本价" value={formatCurrency(part.unit_cost)} />
          <InfoItem label="销售价" value={formatCurrency(part.unit_price)} />
          <InfoItem label="采购价" value={formatCurrency(part.purchase_price)} />
          <InfoItem label="参考采购价" value={formatCurrency(part.reference_purchase_price)} />
          <InfoItem label="标准价" value={formatCurrency(part.standard_price)} />
          <InfoItem label="VIP价" value={formatCurrency(part.vip_price)} />
          <InfoItem label="批发价" value={formatCurrency(part.wholesale_price)} />
        </div>
      </div>

      {/* 库存分布 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">库存分布</h2>
        {stockLocations && stockLocations.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">仓库</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">仓位</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">数量</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">安全下限</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">安全上限</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stockLocations.map((row: any) => (
                <tr key={row.id}>
                  <td className="px-4 py-2">{row.warehouses?.name || "-"}</td>
                  <td className="px-4 py-2">{row.location || "-"}</td>
                  <td className="px-4 py-2 text-right">{row.quantity}</td>
                  <td className="px-4 py-2 text-right">{row.min_stock ?? "-"}</td>
                  <td className="px-4 py-2 text-right">{row.max_stock ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-400 text-sm">暂无库存分布数据</p>
        )}
      </div>

      {/* 适用车型 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">适用车型</h2>
        {vehicleModels && vehicleModels.length > 0 ? (
          <div className="space-y-2">
            {vehicleModels.map((vm: any, idx: number) => {
              const v = vm.vehicle_models;
              const name = v ? `${v.brand} ${v.series} ${v.model_name || ""}`.trim() : "-";
              return (
                <div key={idx} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                  <span className="text-gray-700">{name}</span>
                  {vm.notes && <span className="text-gray-400 text-xs">{vm.notes}</span>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">暂无适用车型</p>
        )}
      </div>

      {/* 车型定价 */}
      {vehiclePrices && vehiclePrices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">车型定价</h2>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">车型</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">销售价</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">VIP价</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">标准价</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vehiclePrices.map((vp: any) => {
                const v = vp.vehicle_models;
                const name = v ? `${v.brand} ${v.series} ${v.model_name || ""}`.trim() : "-";
                return (
                  <tr key={vp.id}>
                    <td className="px-4 py-2">{name}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(vp.sales_price)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(vp.vip_price)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(vp.standard_price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 指定用户价格 */}
      {specialPrices && specialPrices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">指定用户价格</h2>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">对象</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">价格</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {specialPrices.map((sp: any) => {
                let label = "";
                if (sp.companies?.name) label += `单位：${sp.companies.name} `;
                if (sp.customers?.name) label += `客户：${sp.customers.name} `;
                if (sp.vehicles?.plate_number) label += `车辆：${sp.vehicles.plate_number}`;
                if (!label) label = "-";
                return (
                  <tr key={sp.id}>
                    <td className="px-4 py-2">{label}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(sp.price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 图片 */}
      {images && images.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">配件图片</h2>
          <div className="flex flex-wrap gap-4">
            {images.map((img: any) => (
              <img
                key={img.id}
                src={img.storage_path}
                alt="配件图片"
                className="w-32 h-32 object-cover rounded-lg border border-gray-200"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-gray-900 font-medium">{value}</p>
    </div>
  );
}
