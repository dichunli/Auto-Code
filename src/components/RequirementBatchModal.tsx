"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { VideoUploader } from "@/components/VideoUploader";
import { useConfirm } from "./ConfirmDialog";
import { 保存需求, 指派需求, 领取需求, 取消需求指派, 删除需求 } from "@/app/work-orders/actions";

interface MediaItem {
  id?: string;
  /* 放宽为 string：与数据源 MediaRecord 及 RequirementTitle 的定义对齐 */
  media_type?: string;
  storage_path?: string;
}

interface Profile {
  id: string;
  full_name?: string | null;
}

/* 包装 Promise 加超时：网络"假死"（连接挂着但不回包）时，
 * 15 秒后果断报错并恢复保存按钮，不会永远卡在"保存中..." */
function 带超时<T>(promise: PromiseLike<T>, 操作名: string): Promise<T> {
  const 毫秒 = 15000;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${操作名}超时（15秒），请检查网络后重试`)), 毫秒);
    }),
  ]);
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
  项目数?: number; // 该需求下挂的维修项目数量：>0 时禁止删除
}

export default function RequirementBatchModal({ open, onClose, orderId, requirement, initialMedia = [], profiles = [], 项目数 = 0 }: Props) {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
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
  // 弹窗内指派状态：指派/领单/取消后本地更新显示 + 广播事件，不整页刷新
  const [当前指派, 设置当前指派] = useState<{ id: string; type: string; name: string } | null>(
    requirement?.assigned_to
      ? {
          id: requirement.assigned_to,
          type: requirement.assignment_type || "assigned",
          name: requirement.assigned_to_profile?.full_name || "未知",
        }
      : null
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevOpenRef = useRef(false);

  /* 获取当前用户及角色 */
  useEffect(() => {
    async function initUser() {
      const { data: sessionData } = await supabase.auth.getSession();
      const authData = { user: sessionData.session?.user ?? null }; /* getSession本地读不联网 */
      const uid = authData.user?.id || null;
      setCurrentUserId(uid);
      if (uid) {
        const { data: roleData } = await supabase
          .from("profile_roles")
          .select("roles(name)")
          .eq("profile_id", uid);
        const admin = ((roleData || []) as unknown as { roles?: { name?: string } | null }[]).some(
          (d) => d.roles?.name === "admin"
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
        setImages(initialMedia.filter((m) => m.media_type === "image").map((m) => m.storage_path).filter((p): p is string => !!p));
        setVideos(initialMedia.filter((m) => m.media_type === "video").map((m) => m.storage_path).filter((p): p is string => !!p));
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
    if (saving) return; // 防止重复提交：正在保存时再次点击直接忽略
    if (!description.trim() && images.length === 0 && videos.length === 0) {
      alert("请至少填写客户需求描述或上传媒体文件");
      return;
    }

    /* 立即进入保存中状态：按钮马上变「保存中...」并禁用，给用户即时反馈，杜绝因反应慢而重复提交 */
    setSaving(true);

    /* 当前用户已在组件挂载时(useEffect)拿到并存入 currentUserId state，此处直接用，
     * 无需再联网 getUser（环境判定修复后 session 本就健康，避免拖慢保存）。
     * userId 为下方字段级权限校验沿用的名字，与 currentUserId 同值。 */
    const userId = currentUserId;
    /* 统一的需求ID：编辑模式取props，新增模式取插入后的返回值（不再改写props，避免类型收窄失效） */
    let 当前需求ID: string | undefined = requirement?.id;
    // 新建成功后用于局部追加的需求数据（避免整页刷新）
    let 新建需求: { id: string; seq: number; description: string; submitted_by: string | null } | null = null;
    try {
      if (isEdit && requirement) {
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

        // 编辑模式：更新需求（写库走 Server Action，提交人由服务端记）
        const 保存参数: {
          orderId: string;
          requirementId: string | null;
          description?: string;
          diagnosis?: string | null;
          remarks?: string | null;
          deletedMediaIds: string[];
          newMedia: { media_type: "image" | "video"; storage_path: string }[];
        } = {
          orderId,
          requirementId: requirement.id,
          deletedMediaIds: canEditMedia ? deletedMediaIds : [],
          newMedia: [],
        };
        if (canEditDescription) {
          保存参数.description = description.trim();
        }
        if (canEditDiagnosis) {
          const newDiagnosis = diagnosis.trim();
          if (newDiagnosis !== (requirement.diagnosis || "").trim()) {
            保存参数.diagnosis = newDiagnosis || null;
          }
        }
        if (canEditRemarks) {
          const newRemarks = remarks.trim();
          if (newRemarks !== (requirement.remarks || "").trim()) {
            保存参数.remarks = newRemarks || null;
          }
        }
        if (canEditMedia) {
          保存参数.newMedia = [
            ...images
              .filter((path) => !initialMedia.some((m) => m.media_type === "image" && m.storage_path === path))
              .map((path) => ({ media_type: "image" as const, storage_path: path })),
            ...videos
              .filter((path) => !initialMedia.some((m) => m.media_type === "video" && m.storage_path === path))
              .map((path) => ({ media_type: "video" as const, storage_path: path })),
          ];
        }

        const 编辑结果 = await 带超时(保存需求(保存参数), "保存需求");
        if (!编辑结果.success) throw new Error(编辑结果.error || "保存失败");
      } else {
        // 新增模式：序号在服务端取，写库走 Server Action
        const newDiagnosis = diagnosis.trim();
        const newRemarks = remarks.trim();
        const 新增结果 = await 带超时(保存需求({
          orderId,
          requirementId: null,
          description: description.trim(),
          diagnosis: newDiagnosis || null,
          remarks: newRemarks || null,
          deletedMediaIds: [],
          newMedia: [
            ...images.map((path) => ({ media_type: "image" as const, storage_path: path })),
            ...videos.map((path) => ({ media_type: "video" as const, storage_path: path })),
          ],
        }), "创建需求");
        if (!新增结果.success || !新增结果.id) throw new Error(新增结果.error || "创建需求失败");
        当前需求ID = 新增结果.id;
        新建需求 = { id: 新增结果.id, seq: 新增结果.seq || 1, description: description.trim(), submitted_by: userId || null };
      }

      // 删除被移除的媒体文件（包括已保存的和新上传后取消的）——并行发送，
      // 弱网下不再逐个等；单个文件删除失败不阻塞整体保存（文件残留无害，记录已删）
      const pathsToDelete = [...deletedMediaPaths];
      await Promise.all(
        pathsToDelete.map((path) =>
          带超时(
            fetch("/api/delete-media", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path }),
            }),
            "删除文件"
          ).catch(() => { /* 单个删除失败忽略 */ })
        )
      );

      /* 先清服务端缓存并重新验证页面、刷新数据，全部完成后再关弹窗。
       * 这样保存期间「保存中...」状态一直保持，用户有明确反馈，不会以为卡住或没存上。
       * 工单数据量大时，将关闭弹窗放在刷新之前，避免用户感觉弹窗卡住。 */
      onClose();
      reset();
      if (新建需求) {
        /* 新建需求：局部追加需求卡片，立即显示，不整页刷新（与配件添加同一模式）。
         * 整页刷新后服务端数据已含此需求，追加卡片按 id 去重自动移除。 */
        window.dispatchEvent(
          new CustomEvent("wo-requirement-added", {
            detail: {
              requirement: 新建需求,
              media: [
                ...images.map((path) => ({ media_type: "image" as const, storage_path: path })),
                ...videos.map((path) => ({ media_type: "video" as const, storage_path: path })),
              ],
            },
          })
        );
      } else {
        /* 编辑需求：广播"wo-requirement-updated"事件，RequirementTitle 监听后立即更新
         * 标题描述和媒体图标，不整页刷新。媒体列表为增删后的最终状态（本地 state）。 */
        window.dispatchEvent(
          new CustomEvent("wo-requirement-updated", {
            detail: {
              requirementId: 当前需求ID,
              description: description.trim(),
              media: [
                ...images.map((path) => ({ media_type: "image" as const, storage_path: path })),
                ...videos.map((path) => ({ media_type: "video" as const, storage_path: path })),
              ],
            },
          })
        );
      }
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
              {!当前指派 ? (
                <>
                  <select
                    className="flex-1 min-w-0 text-xs px-2 py-1.5 border border-gray-300 rounded-lg bg-white"
                    defaultValue=""
                    onChange={async (e) => {
                      const val = e.target.value;
                      if (!val) return;
                      const name = profiles.find((p) => p.id === val)?.full_name || "";
                      if (!(await 请求确认(`确定指派给 ${name} 吗？`))) {
                        e.target.value = "";
                        return;
                      }
                      /* 写库走 Server Action，指派人取服务端登录用户 */
                      const result = await 指派需求({ requirementId: requirement.id, assigneeId: val });
                      if (!result.success) {
                        alert("指派失败: " + (result.error || "未知错误"));
                        e.target.value = "";
                      } else {
                        设置当前指派({ id: val, type: "assigned", name });
                        window.dispatchEvent(
                          new CustomEvent("wo-requirement-assigned", {
                            detail: { requirementId: requirement.id, assignedTo: val, assignmentType: "assigned", fullName: name },
                          })
                        );
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
                      if (!currentUserId) {
                        alert("未登录，无法领单");
                        return;
                      }
                      /* 写库走 Server Action，领单人取服务端登录用户 */
                      const result = await 领取需求(requirement.id);
                      if (!result.success) {
                        alert("领单失败: " + (result.error || "未知错误"));
                      } else {
                        const 我的姓名 = profiles.find((p) => p.id === currentUserId)?.full_name || "";
                        设置当前指派({ id: currentUserId, type: "claimed", name: 我的姓名 });
                        window.dispatchEvent(
                          new CustomEvent("wo-requirement-assigned", {
                            detail: { requirementId: requirement.id, assignedTo: currentUserId, assignmentType: "claimed", fullName: 我的姓名 },
                          })
                        );
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
                    {当前指派.type === "claimed" ? "领单" : "指派"}:
                    <span className="font-medium ml-1">{当前指派.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!(await 请求确认("确定取消指派吗？"))) return;
                      const result = await 取消需求指派(requirement.id);
                      if (!result.success) {
                        alert("取消失败: " + (result.error || "未知错误"));
                      } else {
                        设置当前指派(null);
                        window.dispatchEvent(
                          new CustomEvent("wo-requirement-assigned", {
                            detail: { requirementId: requirement.id, assignedTo: null, assignmentType: null, fullName: "" },
                          })
                        );
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
                disabled={saving}
                title={项目数 > 0 ? "该需求下有维修项目，请先删除项目再删需求" : undefined}
                onClick={async () => {
                  /* 防误删：需求下挂有维修项目时不允许删除。项目数检查挪到服务端实时查，
                   * 避免"项目已删却仍被拦"或"项目还在却被放过"。 */
                  if (!(await 请求确认("确定要删除这条需求吗？关联的媒体文件也会被删除。"))) {
                    return;
                  }
                  setSaving(true);
                  const result = await 删除需求(requirement!.id);
                  if (!result.success) {
                    alert(result.error || "删除失败");
                    setSaving(false);
                  } else {
                    /* 删除需求：局部更新，卡片立即消失，不整页刷新。
                     * 已知取舍：后面需求的序号暂时跳号，下次整页刷新自动重排 */
                    window.dispatchEvent(
                      new CustomEvent("wo-requirement-deleted", {
                        detail: { requirementId: requirement!.id },
                      })
                    );
                    onClose();
                    setSaving(false);
                  }
                }}
                className="mr-auto px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
        {确认弹窗}
      </div>
    </div>
  );
}
