"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "./ImageUploader";
import { filterLogisticsBySupplierName, supplierNeedsLogistics } from "@/lib/logisticsFilter";

const RETURN_REASONS = [
  { key: "wrong_ship", label: "错发" },
  { key: "excess", label: "多发退货" },
  { key: "damaged", label: "损坏" },
  { key: "cancel", label: "客户悔单" },
];

interface Props {
  open: boolean;
  partName: string;
  workOrderItemPartId: string;
  maxQty: number;
  suppliers: { id: string; name: string; region?: string | null }[];
  logisticsCompanies: { id: string; name: string; scopes?: string[] | null }[];
  onClose: () => void;
  onSuccess: () => void;
}

export function SupplierReturnModal({
  open,
  partName,
  workOrderItemPartId,
  maxQty,
  suppliers,
  logisticsCompanies,
  onClose,
  onSuccess,
}: Props) {
  const supabase = createClient();
  const [returnReason, setReturnReason] = useState("wrong_ship");
  const [quantity, setQuantity] = useState(1);
  const [supplierName, setSupplierName] = useState("");
  const [logisticsCompany, setLogisticsCompany] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (quantity <= 0 || quantity > maxQty) {
      alert(`退货数量必须在 1-${maxQty} 之间`);
      return;
    }
    if (photos.length === 0) {
      alert("请至少上传一张退货商品照片");
      return;
    }
    setLoading(true);

    try {
      const { error } = await supabase.from("supplier_return_records").insert({
        work_order_item_part_id: workOrderItemPartId,
        return_reason: returnReason,
        quantity,
        supplier_name: supplierName || null,
        logistics_company: logisticsCompany || null,
        tracking_no: trackingNo || null,
        photos,
      });
      if (error) throw error;

      onSuccess();
      onClose();
    } catch (err: any) {
      alert("退货失败: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog open className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">退货给供应商</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-sm text-gray-600">
            配件: <span className="font-medium text-gray-900">{partName}</span>
            <span className="ml-3">可退: <span className="font-medium">{maxQty}</span></span>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-2">退货原因</label>
            <div className="grid grid-cols-2 gap-2">
              {RETURN_REASONS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setReturnReason(t.key)}
                  className={`px-3 py-2 rounded border text-sm text-center transition-colors ${
                    returnReason === t.key
                      ? "bg-blue-50 border-blue-200 text-blue-700"
                      : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">退货数量</label>
            <input
              type="number"
              min={1}
              max={maxQty}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">供应商</label>
            <select
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">请选择或填写</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
            {!supplierName && (
              <input
                type="text"
                placeholder="手动输入供应商名称"
                className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                onChange={(e) => setSupplierName(e.target.value)}
              />
            )}
          </div>

          {(() => {
            const selectedSupplier = suppliers.find((s) => s.name === supplierName);
            const region = selectedSupplier?.region as ("local" | "harbin" | "outside" | undefined);
            if (selectedSupplier && !supplierNeedsLogistics(region)) {
              return (
                <div className="grid grid-cols-1 gap-3">
                  <div className="px-3 py-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded">本地供应商，无需物流和运单</div>
                </div>
              );
            }
            const filtered = filterLogisticsBySupplierName(logisticsCompanies, supplierName, suppliers);
            return (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    物流公司
                    {region === "harbin" && <span className="ml-1 text-blue-500">（哈市）</span>}
                    {region === "outside" && <span className="ml-1 text-orange-500">（外阜）</span>}
                  </label>
                  <select
                    value={logisticsCompany}
                    onChange={(e) => setLogisticsCompany(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">请选择</option>
                    {filtered.map((l) => (
                      <option key={l.id} value={l.name}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">运单号</label>
                  <input
                    type="text"
                    value={trackingNo}
                    onChange={(e) => setTrackingNo(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="运单号"
                  />
                </div>
              </div>
            );
          })()}

          <div>
            <label className="block text-xs text-gray-500 mb-2">退货照片（必填）</label>
            <ImageUploader onUpload={setPhotos} maxImages={5} />
            <p className="text-[10px] text-gray-400 mt-1">请拍摄退货商品照片（可多张）及包装箱照片</p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || quantity <= 0 || quantity > maxQty || photos.length === 0}
              className="px-4 py-2 text-sm text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
            >
              {loading ? "保存中..." : "生成退货单"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
