"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { 导入保养模板 } from "@/app/work-orders/actions";

interface Props {
  vehicleId: string;
  orderId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface TemplateItem {
  id: string;
  service_item_id: string | null;
  name: string;
  item_type: string;
  quantity: number | null;
  unit_price: number | null;
  mechanic_id: string | null;
  vehicle_maintenance_template_parts?: TemplatePart[];
}

interface TemplatePart {
  id: string;
  part_name_id: string | null;
  part_id: string | null;
  quantity: number | null;
  name: string;
  brand: string | null;
  specification: string | null;
  unit_cost: number | null;
  unit_price: number | null;
}

interface Template {
  id: string;
  name: string;
  previous_cost: number | null;
  customer_notes: string | null;
  vehicle_maintenance_template_items?: TemplateItem[];
}

export function TemplateImportModal({ vehicleId, orderId, onClose, onSuccess }: Props) {
  const supabase = createClient();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Template | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    supabase
      .from("vehicle_maintenance_templates")
      .select("*, vehicle_maintenance_template_items(id)")
      .eq("vehicle_id", vehicleId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setTemplates(data || []);
        setLoading(false);
      });
  }, [vehicleId, supabase]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    supabase
      .from("vehicle_maintenance_templates")
      .select("*, vehicle_maintenance_template_items(*, vehicle_maintenance_template_parts(*))")
      .eq("id", selectedId)
      .single()
      .then(({ data }) => {
        setDetail(data);
      });
  }, [selectedId, supabase]);

  async function handleImport() {
    if (!selectedId || !detail) return;
    setImporting(true);

    /* 建需求 + 逐项目插入 + 逐项目加配件，全部收口到服务端一次完成 */
    try {
      const result = await 导入保养模板({
        orderId,
        templateName: detail.name,
        items: (detail.vehicle_maintenance_template_items || []).map((item) => ({
          service_item_id: item.service_item_id,
          name: item.name,
          item_type: item.item_type,
          quantity: item.quantity,
          unit_price: item.unit_price,
          mechanic_id: item.mechanic_id,
          parts: (item.vehicle_maintenance_template_parts || []).map((part) => ({
            part_name_id: part.part_name_id,
            part_id: part.part_id,
            quantity: part.quantity,
            name: part.name,
            brand: part.brand,
            specification: part.specification,
            unit_cost: part.unit_cost,
            unit_price: part.unit_price,
          })),
        })),
      });
      if (!result.success) {
        alert("导入失败: " + (result.error || "未知错误"));
        setImporting(false);
        return;
      }
      onSuccess();
    } catch (err: unknown) {
      alert("导入失败: " + (err instanceof Error ? err.message : String(err)));
      setImporting(false);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4">
          <p className="text-sm text-gray-500">加载模板中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
        <h3 className="text-base font-semibold text-gray-900 mb-1">导入保养模板</h3>
        <p className="text-xs text-gray-500 mb-4">选择该车辆的保养模板导入当前工单，项目和配件的客户意见将自动设为同意</p>

        <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
          {/* 左侧：模板列表 */}
          <div className="w-1/2 border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
              模板列表 ({templates.length})
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {templates.length === 0 && (
                <p className="text-sm text-gray-400 p-2">暂无保养模板</p>
              )}
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedId === t.id
                      ? "bg-blue-50 border border-blue-200 text-blue-800"
                      : "hover:bg-gray-50 border border-transparent"
                  }`}
                >
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {t.previous_cost !== null && <span>收费: {formatCurrency(t.previous_cost)} · </span>}
                    <span>项目: {t.vehicle_maintenance_template_items?.length || 0}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 右侧：模板详情 */}
          <div className="w-1/2 border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
              模板详情
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {!selectedId && (
                <p className="text-sm text-gray-400 p-2">请选择左侧模板</p>
              )}
              {selectedId && !detail && (
                <p className="text-sm text-gray-400 p-2">加载中...</p>
              )}
              {detail && (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-gray-900">{detail.name}</div>
                  {detail.previous_cost !== null && (
                    <div className="text-xs text-gray-500">往期收费: {formatCurrency(detail.previous_cost)}</div>
                  )}
                  {detail.customer_notes && (
                    <div className="text-xs text-gray-500">客户嘱咐: {detail.customer_notes}</div>
                  )}
                  <div className="text-xs text-gray-400 border-t border-gray-100 pt-2">包含项目:</div>
                  {(detail.vehicle_maintenance_template_items || []).map((item) => (
                    <div key={item.id} className="text-sm bg-gray-50 rounded p-2">
                      <div className="font-medium text-gray-800">{item.name}</div>
                      <div className="text-xs text-gray-400">
                        {item.item_type === 'labor' ? '工时' : item.item_type === 'part' ? '配件' : '其他'}
                        {' '}× {item.quantity} · {formatCurrency(item.unit_price)}
                      </div>
                      {(item.vehicle_maintenance_template_parts || []).length > 0 && (
                        <div className="text-xs text-gray-400 mt-1">
                          配件: {(item.vehicle_maintenance_template_parts || []).map((p) => p.name || '未命名').join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!selectedId || importing}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? "导入中..." : "确认导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
