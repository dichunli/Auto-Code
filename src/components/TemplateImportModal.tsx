"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

interface Props {
  vehicleId: string;
  orderId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function TemplateImportModal({ vehicleId, orderId, onClose, onSuccess }: Props) {
  const supabase = createClient();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

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

    try {
      // 1. 创建需求记录（作为导入的容器）
      const { data: req, error: reqErr } = await supabase
        .from("work_order_requirements")
        .insert({
          work_order_id: orderId,
          description: `保养模板导入: ${detail.name}`,
          diagnosis: "",
        })
        .select("id")
        .single();

      if (reqErr || !req) throw reqErr || new Error("创建需求失败");

      // 2. 导入项目
      for (const item of detail.vehicle_maintenance_template_items || []) {
        const { data: createdItem, error: itemErr } = await supabase
          .from("work_order_items")
          .insert({
            work_order_id: orderId,
            requirement_id: req.id,
            service_item_id: item.service_item_id,
            name: item.name,
            item_type: item.item_type,
            quantity: item.quantity || 1,
            unit_price: item.unit_price || 0,
            mechanic_id: item.mechanic_id,
            customer_opinion: "agree",
            business_type: "normal",
          })
          .select("id")
          .single();

        if (itemErr || !createdItem) throw itemErr || new Error("导入项目失败");

        // 3. 导入配件
        for (const part of item.vehicle_maintenance_template_parts || []) {
          const { error: partErr } = await supabase.from("work_order_item_parts").insert({
            work_order_item_id: createdItem.id,
            part_name_id: part.part_name_id,
            part_id: part.part_id,
            quantity: part.quantity || 1,
            name: part.name,
            brand: part.brand,
            specification: part.specification,
            unit_cost: part.unit_cost,
            unit_price: part.unit_price,
            customer_opinion: "agree",
          });
          if (partErr) throw partErr;
        }
      }

      onSuccess();
    } catch (err: any) {
      alert("导入失败: " + err.message);
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
              {templates.map((t: any) => (
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
                  {(detail.vehicle_maintenance_template_items || []).map((item: any) => (
                    <div key={item.id} className="text-sm bg-gray-50 rounded p-2">
                      <div className="font-medium text-gray-800">{item.name}</div>
                      <div className="text-xs text-gray-400">
                        {item.item_type === 'labor' ? '工时' : item.item_type === 'part' ? '配件' : '其他'}
                        {' '}× {item.quantity} · {formatCurrency(item.unit_price)}
                      </div>
                      {(item.vehicle_maintenance_template_parts || []).length > 0 && (
                        <div className="text-xs text-gray-400 mt-1">
                          配件: {(item.vehicle_maintenance_template_parts || []).map((p: any) => p.name || '未命名').join(', ')}
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
