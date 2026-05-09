"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/imageCompress";

interface Props {
  seqLabel: string;
  name: string;
  parts: any[];
  isLocked: boolean;
  itemId?: string;
  quantity?: number;
  existingImages?: string[];
}

export default function PartGroupHeader({ seqLabel, name, parts, isLocked, itemId, quantity, existingImages = [] }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const unit = parts[0]?.unit || parts[0]?.part_names?.unit || parts[0]?.parts?.unit || "件";
  const category = parts[0]?.part_names?.part_categories?.name || parts[0]?.parts?.part_categories?.name;

  const defaultQty = quantity != null ? String(quantity) : (parts[0]?.quantity != null ? String(parts[0].quantity) : "1");
  const [qty, setQty] = useState(defaultQty);

  const [notes, setNotes] = useState(parts[0]?.notes || "");
  const [images, setImages] = useState<string[]>(existingImages);

  useEffect(() => {
    setImages(existingImages);
  }, [existingImages]);

  async function handleAddBranch() {
    if (!itemId || !parts[0]) return;
    setSaving(true);
    // 如果当前只有一个分支，先清除其选中状态
    if (parts.length === 1) {
      await supabase.from("work_order_item_parts").update({ is_selected: false }).eq("id", parts[0].id);
    }
    const { error } = await supabase.from("work_order_item_parts").insert({
      work_order_item_id: itemId,
      part_name_id: parts[0].part_name_id || null,
      name: parts[0].name || null,
      unit: parts[0].unit || parts[0].part_names?.unit || parts[0].parts?.unit || "件",
      quantity: 1,
      customer_opinion: "pending",
      is_selected: false,
    });
    setSaving(false);
    if (error) {
      alert("添加失败: " + error.message);
      return;
    }
    router.refresh();
  }

  async function handleDeleteGroup() {
    if (!confirm(`确定删除配件「${name}」及其所有分支吗？`)) return;
    setSaving(true);
    const ids = parts.map((p) => p.id).filter(Boolean);
    const { error } = await supabase.from("work_order_item_parts").delete().in("id", ids);
    setSaving(false);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    router.refresh();
  }

  async function saveQuantity() {
    const val = parseInt(qty, 10);
    if (isNaN(val) || val < 1) return;
    setSaving(true);
    if (itemId) {
      const { error } = await supabase
        .from("work_order_items")
        .update({ quantity: val })
        .eq("id", itemId);
      setSaving(false);
      if (error) {
        alert("保存失败: " + error.message);
        return;
      }
    }
    router.refresh();
  }

  async function saveNotes() {
    if (!parts[0]) return;
    const { error } = await supabase
      .from("work_order_item_parts")
      .update({ notes })
      .eq("id", parts[0].id);
    if (error) {
      alert("保存备注失败: " + error.message);
    }
  }

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      if (images.length >= 5) {
        alert("最多上传 5 张图片");
        return;
      }
      if (!parts[0]) return;

      setSaving(true);
      try {
        const compressed = await compressImage(file, 150);
        const ext = file.name.split(".").pop() || "jpg";
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage.from("work-order-media").upload(fileName, compressed, {
          contentType: "image/jpeg",
          upsert: false,
        });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("work-order-media").getPublicUrl(fileName);
        const path = urlData?.publicUrl || fileName;

        const { error: dbError } = await supabase.from("work_order_item_part_media").insert({
          work_order_item_part_id: parts[0].id,
          media_type: "image",
          storage_path: path,
        });
        if (dbError) throw dbError;

        setImages((prev) => [...prev, path]);
      } catch (err: any) {
        alert("图片上传失败: " + err.message);
      } finally {
        setSaving(false);
      }
    },
    [images, parts, supabase]
  );

  async function removeImage(index: number) {
    const path = images[index];
    setImages((prev) => prev.filter((_, i) => i !== index));
    if (!parts[0]) return;
    await supabase
      .from("work_order_item_part_media")
      .delete()
      .eq("work_order_item_part_id", parts[0].id)
      .eq("storage_path", path);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => uploadFile(f));
    e.target.value = "";
  }

  // 粘贴上传
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (!files) return;
      Array.from(files).forEach((f) => uploadFile(f));
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [uploadFile]);

  return (
    <div className="flex items-center gap-1.5 pl-1">
      {/* 左侧可滚动内容区 */}
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto min-w-0">
        <span className="text-xs text-gray-400 font-mono shrink-0">{seqLabel}</span>
        <span className="font-medium text-sm text-gray-800 shrink-0">{name}</span>

        {/* 供应商名称 */}
        {parts[0]?.supplier_name && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 shrink-0">
            {parts[0].supplier_name}
          </span>
        )}

        {!isLocked ? (
          <input
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onBlur={saveQuantity}
            disabled={saving}
            className="w-14 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50 text-center shrink-0"
          />
        ) : (
          <span className="text-xs text-gray-500 shrink-0">×{qty}</span>
        )}

        <span className="text-xs text-gray-400 shrink-0">{unit}</span>

        {category && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">{category}</span>
        )}

        {/* 右侧操作区：用 ml-auto 推到右边并对齐 */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {/* 备注 */}
          {!isLocked ? (
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              disabled={saving}
              placeholder="备注"
              className="w-32 px-1.5 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            />
          ) : notes ? (
            <span className="text-xs text-gray-400">{notes}</span>
          ) : null}

          {/* 图片 */}
          <div className="flex items-center gap-1 ml-2">
            <span className="text-[10px] text-gray-400">添加图片</span>
            {images.map((src, i) => (
              <div key={i} className="relative w-8 h-8 rounded border border-gray-200 overflow-hidden group">
                <img src={src} alt="" className="w-full h-full object-cover" />
                {!isLocked && (
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-0 right-0 w-3 h-3 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {!isLocked && images.length < 5 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
                className="w-8 h-8 rounded border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
                title="上传/粘贴/拍照"
              >
                {saving ? (
                  <span className="text-[8px]">...</span>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                )}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>
      </div>

      {/* 右侧冻结按钮区 */}
      {!isLocked && itemId && (
        <div className="shrink-0 flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleAddBranch}
            disabled={saving}
            className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center hover:bg-blue-700 disabled:opacity-50"
            title="添加同配件新分支"
          >
            +
          </button>
          <button
            type="button"
            onClick={handleDeleteGroup}
            disabled={saving}
            className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
            title="删除该配件及其所有分支"
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}
