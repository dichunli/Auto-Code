"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useCreateBlockNote,
  useEditorChange,
  FormattingToolbar,
  BlockNoteViewEditor,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { createClient } from "@/lib/supabase/client";
import { compressImage, base64转Blob } from "@/lib/imageCompress";
import { blocknoteDictionary } from "@/lib/blocknoteDictionary";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { 启动原生录像, 本地文件路径转URL } from "@/lib/androidVideoCapture";

interface Props {
  initialValue?: string;
  onChange: (jsonString: string) => void;
}

export function BlockNoteEditor({ initialValue, onChange }: Props) {
  /* useState 初始化函数只在首次渲染执行，避免后续 props 变化导致编辑器重建 */
  const [initialContent] = useState(() => {
    if (!initialValue) return undefined;
    try {
      const parsed = JSON.parse(initialValue);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  });

  const uploadFile = useCallback(async (file: File) => {
    let uploadFile = file;

    /* 图片文件先压缩 */
    if (file.type.startsWith("image/")) {
      try {
        uploadFile = await compressImage(file, 300);
      } catch {
        /* 压缩失败用原文件 */
      }
    }

    const formData = new FormData();
    formData.append("file", uploadFile, file.name);

    /* 30 秒超时 */
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败");
      return result.path;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      throw err;
    }
  }, []);

  /* deps 传空数组，只在组件挂载时创建一次编辑器 */
  const editor = useCreateBlockNote(
    {
      initialContent,
      uploadFile,
      dictionary: blocknoteDictionary,
    },
    []
  );

  useEditorChange(() => {
    const json = JSON.stringify(editor.document);
    onChange(json);
  }, editor);

  return (
    <div className="border border-gray-300 rounded-lg relative z-10">
      {/* 提升 BlockNote 浮动 UI 的层级，避免被左侧导航栏遮挡 */}
      <style>{`
        .bn-container .mantine-Menu-dropdown,
        .bn-container [data-floating-ui-portal] {
          z-index: 9999 !important;
        }
        .bn-editor {
          min-height: 400px;
        }
      `}</style>
      <BlockNoteView
        editor={editor}
        formattingToolbar={false}
        renderEditor={false}
      >
        {/* 固定工具栏 — 显示在编辑器上方 */}
        <div className="bg-gray-50 border-b border-gray-200 px-2 py-1.5 flex items-center gap-1 flex-wrap">
          <CustomToolbarButtons editor={editor} uploadFile={uploadFile} />
          <FormattingToolbar />
        </div>
        <BlockNoteViewEditor />
      </BlockNoteView>
    </div>
  );
}

/* 自定义工具栏按钮 */
function CustomToolbarButtons({
  editor,
  uploadFile,
}: {
  editor: ReturnType<typeof useCreateBlockNote>;
  uploadFile: (file: File) => Promise<string>;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

  const btnBase =
    "px-1.5 py-1 text-xs rounded hover:bg-gray-200 transition-colors text-gray-600 flex items-center gap-1";

  /* 通用处理：上传文件并插入到编辑器 */
  async function insertFileToEditor(file: File) {
    const url = await uploadFile(file);
    const pos = editor.getTextCursorPosition();
    editor.insertBlocks(
      [{ type: "image", props: { url, caption: "" } }],
      pos.block,
      "after"
    );
  }

  /* 浏览器环境：处理 file input 选择 */
  async function handleInsertImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await insertFileToEditor(file);
    } catch (err: unknown) {
      alert("图片插入失败: " + (err instanceof Error ? err.message : String(err)));
    }
    e.target.value = "";
  }

  /* APP 环境：使用 Capacitor 原生相机/相册拍照 */
  async function handleAppPickImage() {
    try {
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt, /* 让用户选择拍照或相册 */
      });
      if (!photo.base64String) {
        alert("拍照未获取到图片");
        return;
      }
      const base64 = `data:image/jpeg;base64,${photo.base64String}`;
      const blob = base64转Blob(base64);
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
      await insertFileToEditor(file);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User denied")) return;
      alert("拍照失败: " + msg);
    }
  }

  /* APP 环境：使用原生录像（WebView 不支持文件选择） */
  async function handleAppRecordVideo() {
    try {
      const result = await 启动原生录像();
      if (result.cancelled) return;
      if (result.error || !result.filePath) {
        alert("录像失败: " + (result.error || "未知错误"));
        return;
      }
      const fileUrl = 本地文件路径转URL(result.filePath);
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error("读取视频文件失败");
      const blob = await response.blob();
      if (blob.size > 500 * 1024 * 1024) {
        alert("视频大小不能超过 500MB");
        return;
      }
      const file = new File([blob], `record_${Date.now()}.mp4`, { type: blob.type || "video/mp4" });
      const url = await uploadFile(file);
      const pos = editor.getTextCursorPosition();
      editor.insertBlocks(
        [{ type: "video", props: { url, caption: "" } }],
        pos.block,
        "after"
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancelled")) return;
      alert("录像上传失败: " + msg);
    }
  }

  function handleInsertTable() {
    const pos = editor.getTextCursorPosition();
    editor.insertBlocks(
      [
        {
          type: "table",
          content: {
            type: "tableContent",
            rows: [
              {
                cells: [
                  [{ type: "text", text: "", styles: {} }],
                  [{ type: "text", text: "", styles: {} }],
                ],
              },
              {
                cells: [
                  [{ type: "text", text: "", styles: {} }],
                  [{ type: "text", text: "", styles: {} }],
                ],
              },
            ],
          },
        },
      ],
      pos.block,
      "after"
    );
  }

  function handleInsertDivider() {
    const pos = editor.getTextCursorPosition();
    editor.insertBlocks([{ type: "divider" }], pos.block, "after");
  }

  function handleInsertCodeBlock() {
    const pos = editor.getTextCursorPosition();
    editor.insertBlocks(
      [{ type: "codeBlock", props: { language: "javascript" } }],
      pos.block,
      "after"
    );
  }

  function handleInsertVideo() {
    const url = prompt("输入视频链接地址:");
    if (!url) return;
    const pos = editor.getTextCursorPosition();
    editor.insertBlocks(
      [{ type: "video", props: { url, caption: "" } }],
      pos.block,
      "after"
    );
  }

  function handleInsertDouyinVideo() {
    const url = prompt("输入抖音视频分享链接（如 https://v.douyin.com/xxxxx）:");
    if (!url) return;
    /* 简单校验 */
    const trimmed = url.trim();
    if (!trimmed.startsWith("http")) {
      alert("请输入以 http:// 或 https:// 开头的链接");
      return;
    }
    const pos = editor.getTextCursorPosition();
    editor.insertBlocks(
      [{ type: "video", props: { url: trimmed, caption: "" } }],
      pos.block,
      "after"
    );
  }

  async function handleUploadVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    /* 限制 500MB */
    if (file.size > 500 * 1024 * 1024) {
      alert("视频大小不能超过 500MB");
      e.target.value = "";
      return;
    }

    /* 限制 30分钟 */
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(file);
        const timer = setTimeout(() => {
          URL.revokeObjectURL(url);
          reject(new Error("读取视频信息超时"));
        }, 10000);
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          resolve(video.duration);
        };
        video.onerror = () => {
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          reject(new Error("无法读取视频信息"));
        };
        video.src = url;
      });
      if (duration > 30 * 60) {
        alert("视频时长不能超过 30 分钟");
        e.target.value = "";
        return;
      }
    } catch {
      /* 无法读取时长时继续上传 */
    }

    try {
      /* 使用 XHR 上传，支持进度 */
      const path = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");
        xhr.timeout = 300000; /* 5分钟超时 */

        xhr.onload = () => {
          try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(result.path);
            } else {
              reject(new Error(result.error || "上传失败"));
            }
          } catch {
            reject(new Error("服务器返回格式异常"));
          }
        };
        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.ontimeout = () => reject(new Error("上传超时"));

        const formData = new FormData();
        formData.append("file", file, file.name);
        xhr.send(formData);
      });

      const pos = editor.getTextCursorPosition();
      editor.insertBlocks(
        [{ type: "video", props: { url: path, caption: "" } }],
        pos.block,
        "after"
      );
    } catch (err: unknown) {
      alert("视频上传失败: " + (err instanceof Error ? err.message : String(err)));
    }
    e.target.value = "";
  }

  function handleInsertFile() {
    const url = prompt("输入文件链接地址:");
    if (!url) return;
    const pos = editor.getTextCursorPosition();
    editor.insertBlocks(
      [{ type: "file", props: { url, name: "文件" } }],
      pos.block,
      "after"
    );
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUploadOfficeFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf"];
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowed.includes(ext)) {
      alert("仅支持 Word、Excel、PPT、PDF 文件");
      e.target.value = "";
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败");

      const pos = editor.getTextCursorPosition();
      editor.insertBlocks(
        [{
          type: "file",
          props: {
            url: result.path,
            name: file.name,
            pdfUrl: result.pdfPath || "",
          },
        }],
        pos.block,
        "after"
      );
    } catch (err: unknown) {
      alert("文件上传失败: " + (err instanceof Error ? err.message : String(err)));
    }
    e.target.value = "";
  }

  const [showJumpModal, setShowJumpModal] = useState(false);

  return (
    <>
      {/* 插入跳转链接 */}
      <button
        type="button"
        className={btnBase}
        onClick={() => setShowJumpModal(true)}
        title="插入跳转链接"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        跳转
      </button>

      {showJumpModal && (
        <JumpLinkModal editor={editor} onClose={() => setShowJumpModal(false)} />
      )}

      {/* 插入图片：APP 调用原生相机，浏览器用文件选择 */}
      {是Capacitor环境() ? (
        <button
          type="button"
          className={btnBase}
          onClick={handleAppPickImage}
          title="拍照/相册"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          图片
        </button>
      ) : (
        <label className={btnBase + " cursor-pointer"} title="插入图片">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          图片
          <input ref={imageInputRef} type="file" accept="image/*" className="sr-only" onChange={handleInsertImage} />
        </label>
      )}

      {/* 插入视频链接 */}
      <button type="button" className={btnBase} onClick={handleInsertVideo} title="插入视频链接">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        视频链接
      </button>

      {/* 插入抖音视频 */}
      <button type="button" className={btnBase} onClick={handleInsertDouyinVideo} title="插入抖音视频">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
          <path d="M12.53 2C12.53 2 12.53 6.5 12.53 8C12.53 10.5 14.53 12.5 17.03 12.5C17.83 12.5 18.53 12.3 19.03 12V16.5C19.03 16.5 17.53 17 16.03 17C13.53 17 11.53 15 11.53 12.5V8H8.53V12.5C8.53 16.5 11.53 19.5 15.53 19.5C16.53 19.5 17.53 19.3 18.53 18.8V22C18.53 22 17.03 22.5 15.53 22.5C10.53 22.5 6.53 18.5 6.53 13.5V8H4.53V4H11.53C11.53 3 12.03 2 12.53 2Z" fill="currentColor" />
        </svg>
        抖音视频
      </button>

      {/* 上传视频：APP 调用原生录像，浏览器用文件选择 */}
      {是Capacitor环境() ? (
        <button
          type="button"
          className={btnBase}
          onClick={handleAppRecordVideo}
          title="录像"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
          </svg>
          上传视频
        </button>
      ) : (
        <label className={btnBase + " cursor-pointer"} title="上传视频">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
          </svg>
          上传视频
          <input ref={videoFileInputRef} type="file" accept="video/*" className="sr-only" onChange={handleUploadVideo} />
        </label>
      )}

      {/* 上传文件：APP 环境不显示（WebView 不支持文件选择） */}
      {!是Capacitor环境() && (
        <label className={btnBase + " cursor-pointer"} title="上传文件">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          文件
          <input ref={fileInputRef} type="file" accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf" className="sr-only" onChange={handleUploadOfficeFile} />
        </label>
      )}

      {/* 插入文件链接 */}
      <button type="button" className={btnBase} onClick={handleInsertFile} title="插入文件链接">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        链接
      </button>

      {/* 插入表格 */}
      <button type="button" className={btnBase} onClick={handleInsertTable} title="插入表格">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        表格
      </button>

      {/* 插入代码块 */}
      <button type="button" className={btnBase} onClick={handleInsertCodeBlock} title="插入代码块">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        代码
      </button>

      {/* 插入分割线 */}
      <button type="button" className={btnBase} onClick={handleInsertDivider} title="插入分割线">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
        </svg>
        分割线
      </button>
    </>
  );
}

/* 跳转链接弹窗 */
function JumpLinkModal({
  editor,
  onClose,
}: {
  editor: ReturnType<typeof useCreateBlockNote>;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [tab, setTab] = useState<"article" | "page">("article");
  const [search, setSearch] = useState("");
  const [articles, setArticles] = useState<{ id: string; title: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageNum, setPageNum] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkSize, setLinkSize] = useState<"normal" | "large" | "small">("normal");
  const [loading, setLoading] = useState(true);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 加载文章列表 */
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("knowledge_articles")
      .select("id, title")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) {
          setArticles(data || []);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [supabase]);

  /* 搜索文章 */
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setLoading(true);
      const query = search.trim()
        ? supabase
            .from("knowledge_articles")
            .select("id, title")
            .ilike("title", `%${search.trim()}%`)
            .limit(20)
        : supabase
            .from("knowledge_articles")
            .select("id, title")
            .order("created_at", { ascending: false })
            .limit(50);
      query.then(({ data }) => {
        setArticles(data || []);
        setLoading(false);
      });
    }, 300);
  }, [search, supabase]);

  function handleInsert() {
    const pos = editor.getTextCursorPosition();
    const isInTable = pos.block.type === "table";

    if (tab === "article" && selectedId) {
      const article = articles.find((a) => a.id === selectedId);
      if (!article) return;
      const text = linkText.trim() || `跳转到《${article.title}》`;
      const href = `/knowledge/${article.id}?present=1`;

      if (isInTable) {
        /* 在表格单元格内：直接在光标位置插入文本+链接 */
        editor._tiptapEditor
          .chain()
          .focus()
          .insertContent([
            { type: "text", text: "→ " },
            {
              type: "text",
              text,
              marks: [{ type: "link", attrs: { href } }],
            },
          ])
          .run();
      } else if (linkSize === "large") {
        /* 在段落中且选了大尺寸：插入 heading */
        editor.insertBlocks(
          [
            {
              type: "heading",
              props: { level: 2 },
              content: [
                { type: "text", text: "➤ " },
                {
                  type: "link",
                  href,
                  content: [{ type: "text", text }],
                },
              ],
            },
          ],
          pos.block,
          "after"
        );
      } else {
        /* 在段落中：插入 paragraph */
        editor.insertBlocks(
          [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "→ " },
                {
                  type: "link",
                  href,
                  content: [{ type: "text", text }],
                },
              ],
            },
          ],
          pos.block,
          "after"
        );
      }
    } else if (tab === "page" && pageNum) {
      const num = parseInt(pageNum, 10);
      if (num >= 1) {
        const text = linkText.trim() || `跳转到第 ${num} 页`;
        const href = `#page=${num}`;

        if (isInTable) {
          editor._tiptapEditor
            .chain()
            .focus()
            .insertContent([
              { type: "text", text: "→ " },
              {
                type: "text",
                text,
                marks: [{ type: "link", attrs: { href } }],
              },
            ])
            .run();
        } else if (linkSize === "large") {
          editor.insertBlocks(
            [
              {
                type: "heading",
                props: { level: 2 },
                content: [
                  { type: "text", text: "➤ " },
                  {
                    type: "link",
                    href,
                    content: [{ type: "text", text }],
                  },
                ],
              },
            ],
            pos.block,
            "after"
          );
        } else {
          editor.insertBlocks(
            [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "→ " },
                  {
                    type: "link",
                    href,
                    content: [{ type: "text", text }],
                  },
                ],
              },
            ],
            pos.block,
            "after"
          );
        }
      }
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-sm max-h-[80vh] flex flex-col mx-4">
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          插入跳转链接
        </h3>

        {/* 选项卡 */}
        <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setTab("article")}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              tab === "article"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            跳转到文章
          </button>
          <button
            type="button"
            onClick={() => setTab("page")}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              tab === "page"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            跳转到页码
          </button>
        </div>

        {/* 通用设置 */}
        <div className="mb-3 space-y-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">链接文字（可选）</label>
            <input
              type="text"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder={tab === "article" ? "默认：跳转到《文章标题》" : "默认：跳转到第 X 页"}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">大小</label>
            <div className="flex gap-1">
              {[
                { key: "small", label: "小" },
                { key: "normal", label: "中" },
                { key: "large", label: "大" },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setLinkSize(s.key as typeof linkSize)}
                  className={`flex-1 text-xs py-1 rounded border transition-colors ${
                    linkSize === s.key
                      ? "bg-blue-50 border-blue-300 text-blue-700"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 内容区 */}
        {tab === "article" && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-[160px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索文章标题..."
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg mb-2"
            />
            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
              {loading && (
                <p className="text-xs text-gray-400 text-center py-4">加载中...</p>
              )}
              {!loading && articles.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">暂无文章</p>
              )}
              {articles.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedId(a.id)}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 transition-colors ${
                    selectedId === a.id
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {a.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "page" && (
          <div className="py-2">
            <label className="block text-xs text-gray-500 mb-1">页码</label>
            <input
              type="number"
              min={1}
              value={pageNum}
              onChange={(e) => setPageNum(e.target.value)}
              placeholder="输入要跳转的页码"
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
            />
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleInsert}
            disabled={
              (tab === "article" && !selectedId) ||
              (tab === "page" && !pageNum)
            }
            className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-30"
          >
            插入
          </button>
        </div>
      </div>
    </div>
  );
}
