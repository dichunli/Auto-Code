"use client";

export interface CommissionFormData {
  auto_link_vehicle_model: boolean;
  auto_match_17vin_models: boolean;
  is_consumable: boolean;
  require_scan_check: boolean;
  require_location_check: boolean;
  sales_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  sales_value: string;
  diagnosis_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  diagnosis_value: string;
  repair_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  repair_value: string;
  qc_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  qc_value: string;
  picking_type: "" | "revenue_pct" | "profit_pct" | "fixed";
  picking_value: string;
}

function CommissionField({
  label,
  typeValue,
  valueValue,
  onTypeChange,
  onValueChange,
}: {
  label: string;
  typeValue: string;
  valueValue: string;
  onTypeChange: (v: string) => void;
  onValueChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}方式</label>
        <select
          className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
          value={typeValue}
          onChange={(e) => onTypeChange(e.target.value)}
        >
          <option value="">无提成</option>
          <option value="revenue_pct">按产值(%)</option>
          <option value="profit_pct">按毛利(%)</option>
          <option value="fixed">固定金额</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}数值</label>
        <input
          type="number"
          className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
          value={valueValue}
          onChange={(e) => onValueChange(e.target.value)}
          disabled={!typeValue}
        />
      </div>
    </div>
  );
}

interface CommissionSectionProps {
  data: CommissionFormData;
  onChange: (partial: Partial<CommissionFormData>) => void;
}

export default function CommissionSection({ data, onChange }: CommissionSectionProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">分类属性与提成（选择配件名称后自动带入，可修改）</h3>
      <div className="flex gap-6 flex-wrap mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={data.auto_link_vehicle_model}
            onChange={(e) => onChange({ auto_link_vehicle_model: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-700">自动关联车型</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer" title="勾选后，该配件保存时会自动通过17VIN匹配全部适配车型">
          <input
            type="checkbox"
            checked={data.auto_match_17vin_models}
            onChange={(e) => onChange({ auto_match_17vin_models: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-700">17VIN自动匹配全部车型</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={data.is_consumable}
            onChange={(e) => onChange({ is_consumable: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-700">耗材（出库不计入营业额）</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer" title="勾选后，该配件出库时需要库管扫码确认">
          <input
            type="checkbox"
            checked={data.require_scan_check}
            onChange={(e) => onChange({ require_scan_check: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-700">扫码出库确认</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer" title="勾选后，该配件入库时必须填写/确认存放位置">
          <input
            type="checkbox"
            checked={data.require_location_check}
            onChange={(e) => onChange({ require_location_check: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-700">入库仓位确认</span>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CommissionField
          label="销售提成"
          typeValue={data.sales_type}
          valueValue={data.sales_value}
          onTypeChange={(v) => onChange({ sales_type: v as CommissionFormData["sales_type"], sales_value: v ? data.sales_value : "" })}
          onValueChange={(v) => onChange({ sales_value: v })}
        />
        <CommissionField
          label="诊断提成"
          typeValue={data.diagnosis_type}
          valueValue={data.diagnosis_value}
          onTypeChange={(v) => onChange({ diagnosis_type: v as CommissionFormData["diagnosis_type"], diagnosis_value: v ? data.diagnosis_value : "" })}
          onValueChange={(v) => onChange({ diagnosis_value: v })}
        />
        <CommissionField
          label="施工提成"
          typeValue={data.repair_type}
          valueValue={data.repair_value}
          onTypeChange={(v) => onChange({ repair_type: v as CommissionFormData["repair_type"], repair_value: v ? data.repair_value : "" })}
          onValueChange={(v) => onChange({ repair_value: v })}
        />
        <CommissionField
          label="质检提成"
          typeValue={data.qc_type}
          valueValue={data.qc_value}
          onTypeChange={(v) => onChange({ qc_type: v as CommissionFormData["qc_type"], qc_value: v ? data.qc_value : "" })}
          onValueChange={(v) => onChange({ qc_value: v })}
        />
        <CommissionField
          label="领料提成"
          typeValue={data.picking_type}
          valueValue={data.picking_value}
          onTypeChange={(v) => onChange({ picking_type: v as CommissionFormData["picking_type"], picking_value: v ? data.picking_value : "" })}
          onValueChange={(v) => onChange({ picking_value: v })}
        />
      </div>
    </div>
  );
}
