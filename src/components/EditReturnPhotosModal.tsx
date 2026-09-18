"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUploader } from "./ImageUploader";
import { useToast } from "./Toast";
import { 更新退货记录照片 } from "@/app/procurement/actions";

/* 待退货记录修改弹窗（2026-09-18 用户拍板：待退货可修改退货照片）
 * 确认退货前可补拍/改拍货物照、外包装照和备注；
 * 只改 pending 记录（服务端按 status='pending' 兜底） */
export function EditReturnPhotosModal({
  记录id,
  配件名,
  初始货物照片,
  初始外包装照片,
  初始备注,
  onClose,
  on保存后,
}: {
  记录id: string;
  配件名: string;
  初始货物照片: string[];
  初始外包装照片: string[];
  初始备注: string;
  onClose: () => void;
  on保存后: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [货物照片, set货物照片] = useState<string[]>(初始货物照片);
  const [外包装照片, set外包装照片] = useState<string[]>(初始外包装照片);
  const [备注, set备注] = useState(初始备注);
  const [保存中, set保存中] = useState(false);

  async function 保存() {
    set保存中(true);
    try {
      const res = await 更新退货记录照片(记录id, 货物照片, 外包装照片, 备注);
      if (!res.success) {
        showToast("保存失败: " + (res.error || "未知错误"), "error");
        return;
      }
      showToast("已保存", "success");
      on保存后();
      onClose();
      router.refresh();
    } catch (err: unknown) {
      showToast("保存失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      set保存中(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl my-8">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">修改退货照片</h3>
            <p className="text-xs text-gray-500 mt-0.5">{配件名} · 确认退货前可随时补拍/改拍</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 min-h-8">货物照片</label>
              <ImageUploader
                onUpload={set货物照片}
                existingImages={货物照片}
                maxImages={9}
                folder="return-goods"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 min-h-8">外包装照片</label>
              <ImageUploader
                onUpload={set外包装照片}
                existingImages={外包装照片}
                maxImages={9}
                folder="return-package"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
            <input
              type="text"
              value={备注}
              onChange={(e) => set备注(e.target.value)}
              placeholder="如：供应商答应换货，等回复"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={保存中}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={保存}
            disabled={保存中}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {保存中 ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
