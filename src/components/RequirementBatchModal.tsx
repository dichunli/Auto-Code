"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { VideoUploader } from "@/components/VideoUploader";
import { 清除工单缓存 } from "@/app/work-orders/actions";

interface MediaItem {
  id?: string;
  media_type: "image" | "video" | "audio";
  storage_path: string;
}

interface Profile {
  id: string;
  full_name?: string | null;
}

interface Requirement {
  id: string;
  description?: string | null;
  diagnosis?: string | null;
  remarks?: string | null;
  submitted_by?: string | null;
  diagnosis_submitter_id?: string | null;
  remarks_submitter_id?: string | null;
  assigned_to?: string | null;
  assignment_type?: string | null;
  assigned_to_profile?: { full_name?: string | null } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  requirement?: Requirement; // 编辑模式时传入
  initialMedia?: MediaItem[]; // 编辑模式时传入现有媒体
  profiles?: Profile[];
}

export default function RequirementBatchModal({ open, onClose, orderId, requirement, initialMedia = [], profiles = [] }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!requirement;

  const [description, setDescription] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [remarks, setRemarks] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [deletedMediaIds, setDeletedMediaIds] = useState<string[]>([]);
  const [deletedMediaPaths, setDeletedMediaPaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevOpenRef = useRef(false);

  /* 获取当前用户及角色 */
  useEffect(() => {
    async function initUser() {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData.user?.id || null;
      setCurrentUserId(uid);
      if (uid) {
        const { data: roleData } = await supabase
          .from("profile_roles")
          .select("roles(name)")
          .eq("profile_id", uid);
        const admin = (roleData || []).some(
          (d: { roles?: { name?: string } | null }) => d.roles?.name === "admin"
        );
        setIsAdmin(admin);
      }
    }
    initUser();
  }, [supabase]);

  // 编辑模式时初始化数据：每次弹窗从关闭变为打开时重新初始化，
  // 避免第一次打开时 initialMedia 尚未加载完成导致后续数据无法回显
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      if (isEdit) {
        setDescription(requirement.description || "");
        setDiagnosis(requirement.diagnosis || "");
        setRemarks(requirement.remarks || "");
        setImages(initialMedia.filter((m) => m.media_type === "image").map((m) => m.storage_path));
        setVideos(initialMedia.filter((m) => m.media_type === "video").map((m) => m.storage_path));
        setDeletedMediaIds([]);
        setDeletedMediaPaths([]);
      } else {
        reset();
      }
    }
    prevOpenRef.current = open;
  }, [open, isEdit, requirement, initialMedia]);

  function reset() {
    setDescription("");
    setDiagnosis("");
    setRemarks("");
    setImages([]);
    setVideos([]);
    setDeletedMediaIds([]);
    setDeletedMediaPaths([]);
  }

  /* 权限判断 */
  const canEditDescription = !isEdit || isAdmin || currentUserId === requirement?.submitted_by;
  const canEditDiagnosis = !isEdit || isAdmin || currentUserId === requirement?.diagnosis_submitter_id || !requirement?.diagnosis_submitter_id;
  const canEditRemarks = !isEdit || isAdmin || currentUserId === requirement?.remarks_submitter_id || !requirement?.remarks_submitter_id;
  const canEditMedia = !isEdit || isAdmin || currentUserId === requirement?.submitted_by;

  async function handleSubmit() {
    if (!description.trim() && images.length === 0 && videos.length === 0) {
      alert("请至少填写客户需求描述或上传媒体文件");
      return;
    }

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id || null;

    setSaving(true);
    try {
      if (isEdit) {
        /* 权限校验：非提交人/管理员尝试修改受保护字段 */
        const isOwnerOrAdmin = isAdmin || userId === requirement?.submitted_by;
        if (!isOwnerOrAdmin) {
          if (description.trim() !== (requirement.description || "").trim()) {
            alert("您没有权限修改客户需求描述");
            setSaving(false);
            return;
          }
          const hasNewImage = images.some(
            (path) => !initialMedia.some((m) => m.media_type === "image" && m.storage_path === path)
          );
          const hasNewVideo = videos.some(
            (path) => !initialMedia.some((m) => m.media_type === "video" && m.storage_path === path)
          );
          if (deletedMediaIds.length > 0 || hasNewImage || hasNewVideo) {
            alert("您没有权限修改需求图片/视频");
            setSaving(false);
            return;
          }
        }

        // 编辑模式：更新需求
        const updateData: Record<string, unknown> = {};
        if (canEditDescription) {
          updateData.description = description.trim();
        }
        if (canEditDiagnosis) {
          const newDiagnosis = diagnosis.trim();
          if (newDiagnosis !== (requirement.diagnosis || "").trim()) {
            updateData.diagnosis = newDiagnosis || null;
            updateData.diagnosis_submitter_id = newDiagnosis ? userId : null;
          }
        }
        if (canEditRemarks) {
          const newRemarks = remarks.trim();
          if (newRemarks !== (requirement.remarks || "").trim()) {
            updateData.remarks = newRemarks || null;
            updateData.remarks_submitter_id = newRemarks ? userId : null;
          }
        }

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from("work_order_requirements")
            .update(updateData)
            .eq("id", requirement.id);
          if (updateError) throw updateError;
        }

        // 删除被标记删除的媒体记录（仅当有权限时）
        if (canEditMedia && deletedMediaIds.length > 0) {
          const { error: delError } = await supabase
            .from("work_order_requirement_media")
            .delete()
            .in("id", deletedMediaIds);
          if (delError) throw delError;
        }
      } else {
        // 新增模式
        const { data: existing } = await supabase
          .from("work_order_requirements")
          .select("seq")
          .eq("work_order_id", orderId)
          .order("seq", { ascending: false })
          .limit(1);
        const nextSeq = (existing && existing[0]?.seq ? existing[0].seq : 0) + 1;

        const newDiagnosis = diagnosis.trim();
        const newRemarks = remarks.trim();
        const { data: req, error: reqError } = await supabase
          .from("work_order_requirements")
          .insert({
            work_order_id: orderId,
            seq: nextSeq,
            description: description.trim(),
            submitted_by: userId,
            diagnosis: newDiagnosis || null,
            remarks: newRemarks || null,
            diagnosis_submitter_id: newDiagnosis ? userId : null,
            remarks_submitter_id: newRemarks ? userId : null,
          })
          .select("id")
          .single();

        if (reqError || !req) throw reqError || new Error("创建需求失败");
        requirement = { id: req.id };
      }

      // 插入新媒体（仅当有权限时）
      if (canEditMedia) {
        const mediaRecords = [
          ...images
            .filter((path) => !initialMedia.some((m) => m.media_type === "image" && m.storage_path === path))
            .map((path) => ({
              requirement_id: requirement.id,
              media_type: "image" as const,
              storage_path: path,
            })),
          ...videos
            .filter((path) => !initialMedia.some((m) => m.media_type === "video" && m.storage_path === path))
            .map((path) => ({
              requirement_id: requirement.id,
              media_type: "video" as const,
              storage_path: path,
            })),
        ];
        if (mediaRecords.length > 0) {
          const { error: mediaError } = await supabase
            .from("work_order_requirement_media")
            .insert(mediaRecords);
          if (mediaError) throw mediaError;
        }
      }

      // 删除被移除的媒体文件（包括已保存的和新上传后取消的）
      const pathsToDelete = [...deletedMediaPaths];
      for (const path of pathsToDelete) {
        await fetch("/api/delete-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
      }

      reset();
      onClose();
      await 清除工单缓存(orderId);
      router.refresh();
    } catch (err: unknown) {
      let msg = "未知错误";
      if (err instanceof Error) {
        msg = err.message;
      } else if (err && typeof err === "object" && "message" in err) {
        msg = String((err as Record<string, unknown>).message);
      } else if (err && typeof err === "object" && "error" in err) {
        msg = String((err as Record<string, unknown>).error);
      } else {
        msg = String(err);
      }
      console.error("保存需求弹窗异常:", err);
      alert("保存失败: " + msg);
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (saving) return;
    // 关闭时如果是新增模式且未保存，清理已上传的媒体文件
    if (!isEdit && (images.length > 0 || videos.length > 0)) {
      for (const path of [...images, ...videos]) {
        fetch("/api/delete-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
      }
    }
    reset();
    onClose();
  }

  // 处理媒体删除：已保存的媒体记录 ID，新上传的直接删文件
  function handleDeleteMedia(path: string, mediaType: "image" | "video") {
    const existing = initialMedia.find(
      (m) => m.media_type === mediaType && m.storage_path === path
    );
    if (existing?.id) {
      setDeletedMediaIds((prev) => (prev.includes(existing.id!) ? prev : [...prev, existing.id!]));
    }
    setDeletedMediaPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }

  // 移动端键盘弹出时，自动滚动到textarea
  function handleTextareaFocus() {
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }

  // 移除媒体时记录已删除的ID（编辑模式）
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/50">
      <div className="!bg-white !opacity-100 rounded-t-xl md:rounded-xl shadow-xl w-full md:max-w-lg md:max-h-[90vh] flex flex-col" style={{ backgroundColor: "#ffffff", opacity: 1, maxHeight: "calc(100vh - env(safe-area-inset-top))" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">{isEdit ? "编辑客户需求" : "添加客户需求"}</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <textarea
            ref={textareaRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onFocus={handleTextareaFocus}
            rows={3}
            placeholder="请输入客户需求，例如：刹车异响、需要保养..."
            disabled={!canEditDescription}
            className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-1 ${!canEditDescription ? "bg-gray-100 text-gray-500" : ""}`}
            inputMode="text"
          />
          {isEdit && requirement && (
            <div className="text-xs text-gray-400 mb-3">
              提交人: {profiles.find((p) => p.id === requirement.submitted_by)?.full_name || "未知"}
              {requirement.diagnosis_submitter_id && (
                <> · 诊断: {profiles.find((p) => p.id === requirement.diagnosis_submitter_id)?.full_name || "未知"}</>
              )}
              {requirement.remarks_submitter_id && (
                <> · 备注: {profiles.find((p) => p.id === requirement.remarks_submitter_id)?.full_name || "未知"}</>
              )}
            </div>
          )}

          {isEdit && (
            <>
              <textarea
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                rows={2}
                placeholder="诊断结果（可选）"
                disabled={!canEditDiagnosis}
                className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-3 ${!canEditDiagnosis ? "bg-gray-100 text-gray-500" : ""}`}
              />
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                placeholder="备注（可选）"
                disabled={!canEditRemarks}
                className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-3 ${!canEditRemarks ? "bg-gray-100 text-gray-500" : ""}`}
              />
            </>
          )}

          <div className="space-y-4">
            <div className={`${!canEditMedia ? "opacity-70" : ""}`}>
              <div className="text-xs text-gray-500 mb-1">需求图片</div>
              <ImageUploader
                existingImages={images}
                onUpload={setImages}
                onDelete={(path) => handleDeleteMedia(path, "image")}
                maxImages={5}
                disabled={!canEditMedia}
              />
            </div>
            <div className={`${!canEditMedia ? "opacity-70" : ""}`}>
              <div className="text-xs text-gray-500 mb-1">需求视频</div>
              <VideoUploader
                existingVideos={videos}
                onUpload={setVideos}
                onDelete={(path) => handleDeleteMedia(path, "video")}
                maxVideos={3}
                disabled={!canEditMedia}
              />
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200">
          {isEdit && profiles.length > 0 && requirement && (
            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
              <span className="text-xs text-gray-500 shrink-0">指派:</span>
              {!requirement.assigned_to ? (
                <>
                  <select
                    className="flex-1 min-w-0 text-xs px-2 py-1.5 border border-gray-300 rounded-lg bg-white"
                    defaultValue=""
                    onChange={async (e) => {
                      const val = e.target.value;
                      if (!val) return;
                      const name = profiles.find((p) => p.id === val)?.full_name || "";
                      if (!confirm(`确定指派给 ${name} 吗？`)) {
                        e.target.value = "";
                        return;
                      }
                      const { data: authData } = await supabase.auth.getUser();
                      const { error } = await supabase
                        .from("work_order_requirements")
                        .update({
                          assigned_to: val,
                          assignment_type: "assigned",
                          dispatcher_id: authData.user?.id || null,
                        })
                        .eq("id", requirement.id);
                      if (error) {
                        alert("指派失败: " + error.message);
                        e.target.value = "";
                      } else {
                        await 清除工单缓存(orderId);
                        router.refresh();
                      }
                    }}
                  >
                    <option value="">选择人员...</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      const { data: authData } = await supabase.auth.getUser();
                      if (!authData.user) {
                        alert("未登录，无法领单");
                        return;
                      }
                      const { error } = await supabase
                        .from("work_order_requirements")
                        .update({
                          assigned_to: authData.user.id,
                          assignment_type: "claimed",
                          dispatcher_id: null,
                        })
                        .eq("id", requirement.id);
                      if (error) {
                        alert("领单失败: " + error.message);
                      } else {
                        await 清除工单缓存(orderId);
                        router.refresh();
                      }
                    }}
                    disabled={saving}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50"
                  >
                    领单
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xs truncate">
                    {requirement.assignment_type === "claimed" ? "领单" : "指派"}:
                    <span className="font-medium ml-1">{requirement.assigned_to_profile?.full_name || "未知"}</span>
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("确定取消指派吗？")) return;
                      const { error } = await supabase
                        .from("work_order_requirements")
                        .update({
                          assigned_to: null,
                          assignment_type: null,
                          dispatcher_id: null,
                        })
                        .eq("id", requirement.id);
                      if (error) {
                        alert("取消失败: " + error.message);
                      } else {
                        await 清除工单缓存(orderId);
                        router.refresh();
                      }
                    }}
                    disabled={saving}
                    className="ml-auto shrink-0 px-2 py-1 text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            {isEdit && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("确定要删除这条需求吗？关联的媒体文件也会被删除。")) return;
                  const { error } = await supabase
                    .from("work_order_requirements")
                    .delete()
                    .eq("id", requirement.id);
                  if (error) {
                    alert("删除失败: " + error.message);
                  } else {
                    onClose();
                    await 清除工单缓存(orderId);
                    router.refresh();
                  }
                }}
                className="mr-auto px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50"
              >
                删除
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
