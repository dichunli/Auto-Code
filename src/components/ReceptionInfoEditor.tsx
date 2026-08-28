"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 保存接车信息 } from "@/app/work-orders/actions";
import { ImageUploader } from "./ImageUploader";

function toDatetimeLocal(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function fromDatetimeLocal(localString: string): string {
  return new Date(localString).toISOString();
}

/** 生成快捷时间的 datetime-local 格式字符串 */
function 生成快捷时间(偏移天数: number, 小时: number, 分钟: number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + 偏移天数);
  d.setHours(小时, 分钟, 0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

interface Props {
  orderId: string;
  mileageIn: number | null;
  dashboardPhotos?: string[] | null;
  estimatedCompletionAt: string | null;
  senderName?: string | null;
  senderPhone?: string | null;
}

export function ReceptionInfoEditor({
  orderId,
  mileageIn,
  dashboardPhotos,
  estimatedCompletionAt,
  senderName,
  senderPhone,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mileage, setMileage] = useState(mileageIn != null ? String(mileageIn) : "");
  const [delivery, setDelivery] = useState(toDatetimeLocal(estimatedCompletionAt));
  const [sName, setSName] = useState(senderName || "");
  const [sPhone, setSPhone] = useState(senderPhone || "");
  const [saving, setSaving] = useState(false);

  const [dashPaths, setDashPaths] = useState<string[]>(dashboardPhotos || []);

  async function handleSave() {
    setSaving(true);
    /* 写库走 Server Action；空字符串统一转 null，数字字段空值传 null */
    const result = await 保存接车信息({
      orderId,
      mileage_in: mileage.trim() !== "" ? Number(mileage) : null,
      estimated_completion_at: delivery.trim() !== "" ? fromDatetimeLocal(delivery) : null,
      sender_name: sName.trim() || null,
      sender_phone: sPhone.trim() || null,
      dashboard_photos: dashPaths.length > 0 ? dashPaths : null,
    });
    setSaving(false);
    if (!result.success) {
      alert("保存失败: " + (result.error || "未知错误"));
      return;
    }
    setOpen(false);
    router.refresh();
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
          <div className="relative bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md shadow-lg max-h-[90vh] overflow-y-auto">
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
                <label className="block text-sm text-gray-600 mb-1">仪表照片</label>
                <ImageUploader
                  onUpload={setDashPaths}
                  existingImages={dashPaths}
                  maxImages={3}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">约定交车时间</label>
                {/* 快捷时间选择 */}
                <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
                  {[
                    { label: "今天18:00", value: 生成快捷时间(0, 18) },
                    { label: "明天09:00", value: 生成快捷时间(1, 9) },
                    { label: "明天18:00", value: 生成快捷时间(1, 18) },
                    { label: "后天09:00", value: 生成快捷时间(2, 9) },
                    { label: "后天18:00", value: 生成快捷时间(2, 18) },
                    { label: "大后天18:00", value: 生成快捷时间(3, 18) },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setDelivery(item.value)}
                      className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                        delivery === item.value
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
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
