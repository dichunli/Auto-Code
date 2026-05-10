"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FuelGauge } from "./FuelGauge";

function toDatetimeLocal(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function fromDatetimeLocal(localString: string): string {
  return new Date(localString).toISOString();
}

interface Props {
  orderId: string;
  mileageIn: number | null;
  fuelLevel: number | null;
  estimatedCompletionAt: string | null;
  senderName?: string | null;
  senderPhone?: string | null;
}

export function ReceptionInfoEditor({ orderId, mileageIn, fuelLevel, estimatedCompletionAt, senderName, senderPhone }: Props) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [mileage, setMileage] = useState(mileageIn != null ? String(mileageIn) : "");
  const [fuel, setFuel] = useState(fuelLevel != null ? String(fuelLevel) : "");
  const [delivery, setDelivery] = useState(toDatetimeLocal(estimatedCompletionAt));
  const [sName, setSName] = useState(senderName || "");
  const [sPhone, setSPhone] = useState(senderPhone || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const payload: any = {};
    if (mileage.trim() !== "") payload.mileage_in = Number(mileage);
    else payload.mileage_in = null;

    if (fuel.trim() !== "") payload.fuel_level = Number(fuel);
    else payload.fuel_level = null;

    if (delivery.trim() !== "") payload.estimated_completion_at = fromDatetimeLocal(delivery);
    else payload.estimated_completion_at = null;

    payload.sender_name = sName.trim() || null;
    payload.sender_phone = sPhone.trim() || null;

    const { error } = await supabase.from("work_orders").update(payload).eq("id", orderId);
    setSaving(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    setOpen(false);
    window.location.reload();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:text-blue-700"
      >
        编辑接车信息
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md shadow-lg">
            <h3 className="text-base font-semibold text-gray-900 mb-4">编辑接车信息</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">接车里程 (km)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                  placeholder="未输入"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">油量/电量</label>
                <FuelGauge value={fuel} onChange={setFuel} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">约定交车时间</label>
                <input
                  type="datetime-local"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={delivery}
                  onChange={(e) => setDelivery(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">送修人</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={sName}
                  onChange={(e) => setSName(e.target.value)}
                  placeholder="未输入"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">送修人电话</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={sPhone}
                  onChange={(e) => setSPhone(e.target.value)}
                  placeholder="未输入"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
