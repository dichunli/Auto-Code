"use client";

import {useState, useRef, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { 解析Word文档, 生成Word文档 } from "./actions";

/* ========== 类型定义 ========== */

interface 知识分类 {
  id: string;
  name: string;
}

interface 知识文章 {
  id: string;
  title: string;
  content: string;
  content_blocks: unknown[] | null;
  type: string;
  category_id: string | null;
  knowledge_categories: { name: string } | null;
  profiles: { full_name: string } | null;
  created_at: string;
}

/* ========== 组件 Props ========== */

interface Props {
  articles: 知识文章[];
  categories: 知识分类[];
  onSuccess?: () => void;
}

/* ========== 主组件 ========== */

export default function KnowledgeImportExport({ articles, onSuccess }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportArticle, setSelectedExportArticle] = useState<string>("");
  const wordInputRef = useRef<HTMLInputElement>(null);

  async function 导入单篇Word(file: File): Promise<{ success: boolean; msg: string }> {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const result = await 解析Word文档(formData);

      if (!result.success) {
        return { success: false, msg: result.error || "Word 解析失败" };
      }

      const { title, blocks } = result;
      if (!title || !blocks) {
        return { success: false, msg: `「${file.name}」解析结果为空` };
      }

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { error } = await supabase.from("knowledge_articles").insert({
        title,
        content_blocks: blocks,
        type: "article",
        category_id: null,
        created_by: userId || null,
      });

      if (error) {
        return { success: false, msg: `「${title}」保存失败: ${error.message}` };
      }

      return { success: true, msg: `「${title}」导入成功` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, msg: `「${file.name}」Word 导入出错: ${msg}` };
    }
  }

  async function 批量导入Word(files: File[]) {
    if (files.length === 0) return;
    setImporting(true);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setImportMsg(`正在导入 ${file.name}（${i + 1}/${files.length}）...`);
      const result = await 导入单篇Word(file);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    let msg = `导入完成：成功 ${successCount} 个`;
    if (failCount > 0) {
      msg += `，失败 ${failCount} 个`;
    }
    setImportMsg(msg);

    if (successCount > 0) {
      onSuccess?.();
    }
    setImporting(false);
  }

  async function 导出Word(articleId: string) {
    const article = articles.find((a) => a.id === articleId);
    if (!article) {
      alert("未找到文章");
      return;
    }

    try {
      const result = await 生成Word文档({
        title: article.title,
        content: article.content,
        content_blocks: article.content_blocks as unknown as Parameters<typeof 生成Word文档>[0]["content_blocks"],
        type: article.type,
        knowledge_categories: article.knowledge_categories,
        profiles: article.profiles,
        created_at: article.created_at,
      });

      if (!result.success || !result.base64) {
        alert(result.error || "导出失败");
        return;
      }

      /* base64 转 Blob 下载 */
      const byteCharacters = atob(result.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${article.title}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("导出 Word 失败: " + msg);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setShowExportModal(true)}
          className="px-3 py-2 text-sm text-green-700 bg-white border border-green-300 rounded-lg hover:bg-green-50"
        >
          导出Word
        </button>
        <button
          onClick={() => wordInputRef.current?.click()}
          disabled={importing}
          className="px-3 py-2 text-sm text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
        >
          {importing ? "导入中..." : "导入Word"}
        </button>

        <input
          ref={wordInputRef}
          type="file"
          accept=".docx,.doc"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) 批量导入Word(files);
            e.target.value = "";
          }}
        />

        {importMsg && (
          <div
            className={`px-3 py-2 text-sm border rounded-lg ${
              importMsg.includes("失败") || importMsg.includes("出错")
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-green-50 border-green-200 text-green-700"
            }`}
          >
            {importMsg}
          </div>
        )}
      </div>

      {showExportModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-3">
              选择要导出为 Word 的文章
            </h3>

            <div className="max-h-[60vh] overflow-y-auto border border-gray-200 rounded-lg mb-4">
              {articles.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">暂无文章</p>
              ) : (
                articles.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedExportArticle(a.id)}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 transition-colors ${
                      selectedExportArticle === a.id
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="font-medium">{a.title}</span>
                    <span className="text-gray-400 ml-2 text-xs">
                      {a.knowledge_categories?.name || "未分类"}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowExportModal(false);
                  setSelectedExportArticle("");
                }}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedExportArticle) {
                    导出Word(selectedExportArticle);
                    setShowExportModal(false);
                    setSelectedExportArticle("");
                  }
                }}
                disabled={!selectedExportArticle}
                className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-30"
              >
                导出
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
