"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/imageCompress";
import { formatCurrency } from "@/lib/utils";
import { PartPickerModal } from "./PartPickerModal";
import { ImageViewer } from "./ImageViewer";

interface Props {
  seqLabel: string;
  name: string;
  parts: any[];
  isLocked: boolean;
  itemId?: string;
  existingImages?: string[];
}

export default function PartGroupHeader({ seqLabel, name, parts, isLocked, itemId, existingImages = [] }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 配件名称替换弹窗
  const [showModal, setShowModal] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [nameResults, setNameResults] = useState<any[]>([]);
  const [nameSearching, setNameSearching] = useState(false);
  const nameTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 配件选择器弹窗
  const [pickerOpen, setPickerOpen] = useState(false);

  // 已选库存配件（编辑弹窗中）
  const [selectedRealPart, setSelectedRealPart] = useState<any | null>(null);

  // 待替换的配件名称（延迟到保存时执行）
  const [pendingName, setPendingName] = useState<any | null>(null);

  const unit = parts[0]?.unit || parts[0]?.part_names?.unit || parts[0]?.parts?.unit || "件";
  const category = parts[0]?.part_names?.part_categories?.name || parts[0]?.parts?.part_categories?.name;

  const defaultQty = parts[0]?.quantity != null ? String(parts[0].quantity) : "";
  const [qty, setQty] = useState(defaultQty);

  const [notes, setNotes] = useState(parts[0]?.notes || "");
  const [images, setImages] = useState<string[]>(existingImages);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);

  // 实时跟踪分支字段变化（用于销售价/数量修改时的即时刷新）
  const [liveParts, setLiveParts] = useState(parts);
  useEffect(() => {
    setLiveParts(parts);
  }, [parts]);

  useEffect(() => {
    function handleUpdate(e: Event) {
      const detail = (e as CustomEvent).detail as {
        itemId: string;
        partId: string;
        unit_price?: number;
        quantity?: number;
        is_selected?: boolean;
      };
      if (!detail) return;
      const partIds = parts.map((p) => p.id);
      if (!partIds.includes(detail.partId)) return;
      setLiveParts((prev) =>
        prev.map((p) =>
          p.id === detail.partId
            ? {
                ...p,
                unit_price: detail.unit_price !== undefined ? detail.unit_price : p.unit_price,
                quantity: detail.quantity !== undefined ? detail.quantity : p.quantity,
                is_selected: detail.is_selected !== undefined ? detail.is_selected : p.is_selected,
              }
            : p
        )
      );
    }
    window.addEventListener("wo-part-update", handleUpdate as EventListener);
    return () => window.removeEventListener("wo-part-update", handleUpdate as EventListener);
  }, [parts]);

  // 该配件组下所有分支的单价与小计（使用 liveParts 实现实时刷新）
  const { unitPrice, subtotal } = useMemo(() => {
    const total = liveParts.reduce((sum, p) => sum + ((p.quantity || 0) * (p.unit_price || 0)), 0);
    const prices = liveParts.map((p) => p.unit_price).filter((v): v is number => v != null && v > 0);
    const price = prices.length > 0 ? prices[0] : 0;
    return { unitPrice: price, subtotal: total };
  }, [liveParts]);

  useEffect(() => {
    if (showModal) {
      setNameQuery("");
      setNameResults([]);
      setPendingName(null);
      setSelectedRealPart(parts[0]?.parts || null);
    }
  }, [showModal, name, parts]);

  async function handleAddBranch() {
    if (!itemId || !parts[0]) return;
    setSaving(true);
    if (parts.length === 1) {
      await supabase.from("work_order_item_parts").update({ is_selected: false }).eq("id", parts[0].id);
    }
    const { error } = await supabase.from("work_order_item_parts").insert({
      work_order_item_id: itemId,
      part_name_id: parts[0].part_name_id || null,
      name: parts[0].name || null,
      unit: parts[0].unit || parts[0].part_names?.unit || parts[0].parts?.unit || "件",
      quantity: null,
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
    const val = qty.trim() === "" ? null : parseInt(qty, 10);
    if (val !== null && (isNaN(val) || val < 1)) return;
    setSaving(true);
    if (parts[0]) {
      const { error } = await supabase
        .from("work_order_item_parts")
        .update({ quantity: val })
        .eq("id", parts[0].id);
      setSaving(false);
      if (error) {
        alert("保存数量失败: " + error.message);
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
      if (!parts[0]?.id) {
        alert("无法获取配件分支ID，请刷新页面后重试");
        return;
      }

      setSaving(true);
      try {
        /* 诊断：确认配件分支记录仍存在 */
        const { data: branchCheck, error: checkError } = await supabase
          .from("work_order_item_parts")
          .select("id")
          .eq("id", parts[0].id)
          .maybeSingle();
        if (checkError || !branchCheck) {
          throw new Error(
            `找不到对应的配件分支记录(ID: ${parts[0].id})，可能已被删除，请刷新页面后重试`
          );
        }

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
    const { error } = await supabase
      .from("work_order_item_part_media")
      .delete()
      .eq("work_order_item_part_id", parts[0].id)
      .eq("storage_path", path);
    if (error) {
      alert("删除失败: " + error.message);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => uploadFile(f));
    e.target.value = "";
  }

  // 搜索配件名称
  useEffect(() => {
    if (nameTimeoutRef.current) clearTimeout(nameTimeoutRef.current);
    if (!nameQuery.trim()) {
      setNameResults([]);
      return;
    }
    setNameSearching(true);
    nameTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("part_names")
        .select("id, name, unit, part_categories(name)")
        .ilike("name", `%${nameQuery.trim()}%`)
        .limit(10);
      setNameResults(data || []);
      setNameSearching(false);
    }, 300);
    return () => {
      if (nameTimeoutRef.current) clearTimeout(nameTimeoutRef.current);
    };
  }, [nameQuery, supabase]);

  // 选择待替换的配件名称（延迟到保存时执行）
  function handleSelectPendingName(selected: any) {
    setPendingName(selected);
    setNameQuery("");
    setNameResults([]);
    setSelectedRealPart(null); // 名称变更后清空已选库存配件
  }

  // 取消待替换
  function handleCancelPendingName() {
    setPendingName(null);
  }

  // 处理从配件选择器返回的配件
  function handlePickerConfirm(partsList: any[]) {
    if (partsList.length === 0) return;
    const part = partsList[0];
    setSelectedRealPart(part);
    setPickerOpen(false);
  }

  // 保存编辑（统一处理名称替换和库存关联）
  async function handleSaveEdit() {
    if (!parts[0]) return;
    setSaving(true);

    const ids = parts.map((p) => p.id).filter(Boolean);

    // 1. 如果有待替换的名称，先执行名称替换，同时清空所有分支的旧库存关联
    if (pendingName) {
      const { error } = await supabase
        .from("work_order_item_parts")
        .update({
          part_name_id: pendingName.id,
          name: pendingName.name,
          unit: pendingName.unit || parts[0].unit,
          part_id: null,
          part_number: "",
          brand: "",
          specification: "",
          unit_cost: null,
          unit_price: null,
        })
        .in("id", ids);
      if (error) {
        setSaving(false);
        alert("替换配件名称失败: " + error.message);
        return;
      }
    }

    // 2. 如果选择了库存配件，更新所有分支的 part_id 及相关信息
    if (selectedRealPart) {
      const updateData: any = {
        part_id: selectedRealPart.id,
        part_name_id: selectedRealPart.part_name_id,
        part_number: selectedRealPart.part_number || "",
        name: selectedRealPart.name,
        unit: selectedRealPart.unit || "件",
        brand: selectedRealPart.part_brands?.name || "",
        specification: selectedRealPart.specification_text || selectedRealPart.part_specifications?.name || "",
        unit_cost: selectedRealPart.unit_cost,
        unit_price: selectedRealPart.unit_price,
      };

      const { error } = await supabase
        .from("work_order_item_parts")
        .update(updateData)
        .in("id", ids);

      if (error) {
        setSaving(false);
        alert("关联库存配件失败: " + error.message);
        return;
      }
    }

    setSaving(false);
    setShowModal(false);
    setPendingName(null);
    setSelectedRealPart(null);
    router.refresh();
  }

  // 鼠标悬停状态，用于确定哪个组件接收粘贴
  const [isHovered, setIsHovered] = useState(false);

  // 粘贴上传（只有鼠标悬停在本组件上时才响应）
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (!isHovered) return;
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      Array.from(files).forEach((f) => uploadFile(f));
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [uploadFile, isHovered]);

  return (
    <>
      <div className="flex items-center gap-1.5 pl-1" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        {/* 左侧可滚动内容区 */}
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto min-w-0">
          <span className="text-xs text-gray-400 font-mono shrink-0">{seqLabel}</span>
          <span className="font-medium text-sm shrink-0 text-gray-800">
            {name}
          </span>

          {!isLocked ? (
            <input
              type="text"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onBlur={saveQuantity}
              disabled={saving}
              placeholder=""
              className={`w-12 px-1 py-0.5 border rounded text-xs disabled:bg-gray-50 text-center shrink-0 ${
                !qty ? "border-red-300 bg-red-50" : "border-gray-200"
              }`}
            />
          ) : qty ? (
            <span className="text-xs text-gray-500 shrink-0">×{qty}</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 shrink-0">
              缺少数量
            </span>
          )}

          {!qty && !isLocked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 shrink-0">
              缺少数量
            </span>
          )}

          <span className="text-xs text-gray-400 shrink-0">{unit}</span>

          {category && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">{category}</span>
          )}

          {parts.length > 0 && (
            <>
              <span className="text-xs text-gray-500 shrink-0">单价:{formatCurrency(unitPrice)}</span>
              <span className="text-xs text-gray-700 font-medium shrink-0">小计:{formatCurrency(subtotal)}</span>
            </>
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
                <div key={i} className="relative w-8 h-8 rounded border border-gray-200 overflow-hidden group cursor-pointer">
                  <img src={src} alt="" className="w-full h-full object-cover" onClick={() => setViewerSrc(src)} />
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeImage(i); }}
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
              onClick={() => setShowModal(true)}
              disabled={saving}
              className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
              title="编辑配件"
            >
              编辑
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

      {/* 编辑弹窗 — 左右分栏 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-5xl max-h-[90vh] flex flex-col mx-4">
            {/* 标题 */}
            <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">
                编辑配件「{name}」
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                左侧可替换配件名称，右侧可从库存选择实际配件
              </p>
            </div>

            {/* 左右分栏 */}
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
              {/* 左侧：替换配件名称 */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 border-b md:border-b-0 md:border-r border-gray-100 space-y-5 min-h-0">
                <div className="text-sm font-medium text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg inline-block">
                  替换配件名称
                </div>

                <p className="text-xs text-gray-500">
                  当前配件：<span className="font-medium text-gray-800">{name}</span>
                  <br />
                  替换后将同步更新该配件下的所有分支。
                </p>

                <div className="relative">
                  <input
                    type="text"
                    autoFocus
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    placeholder="搜索配件名称..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {nameSearching && (
                    <span className="absolute right-3 top-2 text-xs text-gray-400">搜索中...</span>
                  )}
                </div>

                {nameResults.length > 0 && (
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                    {nameResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleSelectPendingName(r)}
                        disabled={saving}
                        className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 disabled:opacity-50"
                      >
                        <div className="text-gray-900">{r.name}</div>
                        <div className="text-xs text-gray-400">
                          {r.part_categories?.name || "-"} · {r.unit || "件"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {nameQuery.trim() && !nameSearching && nameResults.length === 0 && (
                  <p className="text-xs text-gray-400">未找到匹配的配件名称</p>
                )}

                {/* 待替换的名称 */}
                {pendingName && (
                  <div className="p-3 rounded-lg border border-green-200 bg-green-50">
                    <div className="text-sm font-medium text-gray-900">
                      待替换为：{pendingName.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {pendingName.part_categories?.name || "-"} · {pendingName.unit || "件"}
                    </div>
                    <button
                      type="button"
                      onClick={handleCancelPendingName}
                      className="mt-2 text-xs text-red-600 hover:text-red-700"
                    >
                      取消替换
                    </button>
                  </div>
                )}
              </div>

              {/* 右侧：从库存选择配件 */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 min-h-0">
                <div className="text-sm font-medium text-green-700 bg-green-50 px-3 py-1.5 rounded-lg inline-block">
                  关联库存配件
                </div>

                <p className="text-xs text-gray-500">
                  从库存中选择实际配件，会自动带入编号、品牌、价格等信息。
                  关联后该配件将使用库存配件的数据。
                </p>

                {/* 名称已更改提示 */}
                {pendingName ? (
                  <div className="p-3 rounded-lg border border-orange-200 bg-orange-50 text-sm text-orange-700">
                    配件名称已更改，保存后将清除原库存关联。
                    如需关联新库存配件，请先保存名称替换后再编辑。
                  </div>
                ) : (
                  <>
                    {/* 当前已关联的库存配件 */}
                    {parts[0]?.part_id && parts[0]?.parts ? (
                      <div className="p-3 rounded-lg border border-blue-200 bg-blue-50">
                        <div className="text-sm font-medium text-gray-900">
                          当前已关联：{parts[0].parts.name}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {parts[0].parts.part_number && <span className="mr-2">编号:{parts[0].parts.part_number}</span>}
                          {parts[0].parts.part_brands?.name && <span className="mr-2">品牌:{parts[0].parts.part_brands.name}</span>}
                          库存:{parts[0].parts.quantity}
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
                        当前未关联库存配件
                      </div>
                    )}

                    {/* 新选择的库存配件 */}
                    {selectedRealPart ? (
                      <div className="p-3 rounded-lg border border-green-200 bg-green-50">
                        <div className="text-sm font-medium text-gray-900">
                          新选择：{selectedRealPart.name}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {selectedRealPart.part_number && <span className="mr-2">编号:{selectedRealPart.part_number}</span>}
                          {selectedRealPart.part_brands?.name && <span className="mr-2">品牌:{selectedRealPart.part_brands.name}</span>}
                          库存:{selectedRealPart.quantity}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedRealPart(null)}
                          className="mt-2 text-xs text-red-600 hover:text-red-700"
                        >
                          取消选择
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="w-full py-3 border-2 border-dashed border-blue-300 rounded-xl text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-colors text-sm font-medium"
                      >
                        + 选择配件
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
              <button
                type="button"
                onClick={() => { setShowModal(false); setNameResults([]); setPendingName(null); setSelectedRealPart(null); }}
                disabled={saving}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={saving || (!pendingName && !selectedRealPart)}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 配件选择器弹窗 */}
      <PartPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={handlePickerConfirm}
      />
      {viewerSrc && (
        <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />
      )}
    </>
  );
}
