"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";
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

interface BlockNoteBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown[];
  children?: BlockNoteBlock[];
}

type ExcelRow = (string | number | null | undefined)[];

/* ========== BlockNote 辅助函数 ========== */

function 生成块ID(): string {
  return Math.random().toString(36).substring(2, 10);
}

function 创建文本块(文本: string, 类型 = "paragraph", 属性: Record<string, unknown> = {}): BlockNoteBlock {
  return {
    id: 生成块ID(),
    type: 类型,
    props: 属性,
    content: [{ type: "text", text: 文本, styles: {} }],
    children: [],
  };
}

/* 将纯文本转为 BlockNote blocks，支持 Markdown 表格 */
function 纯文本转Blocks(文本: string): BlockNoteBlock[] {
  const blocks: BlockNoteBlock[] = [];
  const lines = 文本.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    /* 检测 Markdown 表格起始：行以 | 开头 */
    if (line.trim().startsWith('|')) {
      /* 收集连续的表格行 */
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      /* Markdown 表格至少需要 2 行（表头 + 分隔行） */
      if (tableLines.length >= 2) {
        /* 检查第二行是否是分隔行（包含 ---） */
        const isDivider = tableLines[1].replace(/\|/g, '').trim().split(/\s+/).filter(Boolean).every((s) => /^-+(:)?$/.test(s));
        if (isDivider) {
          const headerLine = tableLines[0];
          const dataLines = tableLines.slice(2);

          /* 解析单元格 */
          function 解析单元格(row: string): unknown[][] {
            return row
              .split('|')
              .slice(1, -1) /* 去掉首尾空项 */
              .map((cell) => [{ type: 'text', text: cell.trim(), styles: {} }]);
          }

          const rows: { cells: unknown[][] }[] = [];
          /* 表头 */
          rows.push({ cells: 解析单元格(headerLine) });
          /* 数据行 */
          for (const dataLine of dataLines) {
            rows.push({ cells: 解析单元格(dataLine) });
          }

          blocks.push({
            id: 生成块ID(),
            type: 'table',
            content: { type: 'tableContent', rows },
            children: [],
          } as unknown as BlockNoteBlock);
          continue;
        }
      }

      /* 不是有效表格，回退为普通段落 */
      for (const tl of tableLines) {
        if (tl.trim()) blocks.push(创建文本块(tl.trim()));
      }
      continue;
    }

    /* 普通段落 */
    if (line.trim()) {
      blocks.push(创建文本块(line.trim()));
    }
    i++;
  }

  return blocks.length > 0 ? blocks : [创建文本块('')];
}

/* ========== Excel 列配置 ========== */

const excel列定义 = [
  { key: "title", label: "标题", required: true },
  { key: "content", label: "正文内容", required: false },
  { key: "category", label: "分类名称", required: false },
  { key: "type", label: "类型", required: false },
  { key: "video_url", label: "视频链接", required: false },
];

const 类型选项 = ["article", "video", "qa"];
const 类型标签: Record<string, string> = {
  article: "文章",
  video: "视频",
  qa: "问答",
};

/* ========== 组件 Props ========== */

interface Props {
  articles: 知识文章[];
  categories: 知识分类[];
  onSuccess?: () => void;
}

/* ========== 主组件 ========== */

export default function KnowledgeImportExport({ articles, categories, onSuccess }: Props) {
  const supabase = createClient();
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportArticle, setSelectedExportArticle] = useState<string>("");
  const excelInputRef = useRef<HTMLInputElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);

  function 下载Excel模板() {
    const headers = excel列定义.map((c) => c.label);
    const example = [
      "机油更换操作规范",
      "1. 准备工作：确认车辆停放平稳，拉起手刹。\n2. 举升车辆：使用举升机将车辆举升至合适高度。\n3. 排放旧机油：拧开放油螺栓，完全排放旧机油。\n4. 更换机油滤芯：拆下旧滤芯，在新滤芯密封圈涂抹一层新机油后安装。\n5. 加注新机油：按规定量加注适合标号的新机油。\n6. 检查：启动发动机运转几分钟后熄火，检查机油液位和有无渗漏。",
      "维修规范",
      "article",
      "",
    ];
    const example2 = [
      "发动机异响常见原因",
      "Q: 发动机冷启动时有异响，热车后消失是什么原因？\nA: 可能是液压挺柱泄压导致，冷车时机油尚未完全到达挺柱，属于正常现象。如热车后仍有异响，需检查挺柱磨损情况。\n\nQ: 加速时有哒哒声是什么原因？\nA: 可能是爆震（敲缸），建议检查：1）燃油标号是否合适；2）点火提前角；3）积碳情况。",
      "常见问题",
      "qa",
      "",
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example, example2]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "知识库导入模板");
    XLSX.writeFile(wb, "知识库导入模板.xlsx");
  }

  async function 导入单篇Excel(file: File): Promise<{ success: boolean; msg: string }> {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: ExcelRow[] = XLSX.utils.sheet_to_json(ws, { header: 1 });

      if (rows.length < 1) {
        return { success: false, msg: `「${file.name}」文件中没有数据` };
      }

      const headers: string[] = (rows[0] as string[]).map((h) => String(h).trim());
      const dataRows = rows.slice(1);

      const colMap: Record<string, number> = {};
      headers.forEach((h, idx) => {
        const found = excel列定义.find((eh) => eh.label === h);
        if (found) colMap[found.key] = idx;
      });

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      /* ========== 单篇文章模式：一个 Excel 文件 = 一篇文章 ========== */

      /* 标题：有「标题」列取第一行有效值，没有则用文件名 */
      let title = file.name.replace(/\.[^/.]+$/, "");
      if (colMap["title"] !== undefined) {
        for (let i = 0; i < dataRows.length; i++) {
          const val = String(dataRows[i][colMap["title"]] || "").trim();
          if (val) {
            title = val;
            break;
          }
        }
      }
      if (!title) {
        return { success: false, msg: `「${file.name}」无法获取标题` };
      }

      /* 检查标题是否已存在 */
      const { data: existing } = await supabase.from("knowledge_articles").select("title").eq("title", title);
      if (existing && existing.length > 0) {
        return { success: false, msg: `「${title}」已存在，跳过` };
      }

      /* 正文：有「正文内容」列取所有有效值拼接，没有则取所有非空单元格拼接 */
      let content = "";
      if (colMap["content"] !== undefined) {
        const parts: string[] = [];
        for (let i = 0; i < dataRows.length; i++) {
          const val = String(dataRows[i][colMap["content"]] || "").trim();
          if (val) parts.push(val);
        }
        content = parts.join("\n\n");
      } else {
        const parts: string[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          for (let j = 0; j < row.length; j++) {
            const val = String(row[j] || "").trim();
            if (val) parts.push(val);
          }
        }
        content = parts.join("\n");
      }

      /* 分类：取第一个有效值 */
      let categoryId: string | null = null;
      if (colMap["category"] !== undefined) {
        for (let i = 0; i < dataRows.length; i++) {
          const catName = String(dataRows[i][colMap["category"]] || "").trim();
          if (catName) {
            const found = categories.find((c) => c.name === catName);
            if (found) {
              categoryId = found.id;
              break;
            }
          }
        }
      }

      /* 类型：取第一个有效值 */
      let type = "article";
      if (colMap["type"] !== undefined) {
        for (let i = 0; i < dataRows.length; i++) {
          const t = String(dataRows[i][colMap["type"]] || "").trim().toLowerCase();
          if (类型选项.includes(t)) {
            type = t;
            break;
          }
        }
      }

      /* 视频链接：取第一个有效值 */
      let videoUrl: string | null = null;
      if (colMap["video_url"] !== undefined) {
        for (let i = 0; i < dataRows.length; i++) {
          const v = String(dataRows[i][colMap["video_url"]] || "").trim();
          if (v) {
            videoUrl = v;
            break;
          }
        }
      }

      const contentBlocks = 纯文本转Blocks(content);

      const { error } = await supabase.from("knowledge_articles").insert({
        title,
        content_blocks: contentBlocks,
        type,
        category_id: categoryId,
        video_url: videoUrl,
        created_by: userId || null,
      });

      if (error) {
        return { success: false, msg: `「${title}」保存失败: ${error.message}` };
      }

      return { success: true, msg: `「${title}」导入成功` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, msg: `「${file.name}」导入出错: ${msg}` };
    }
  }

  async function 批量导入Excel(files: File[]) {
    if (files.length === 0) return;
    setImporting(true);

    let successCount = 0;
    let failCount = 0;
    const failMsgs: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setImportMsg(`正在导入 ${file.name}（${i + 1}/${files.length}）...`);
      const result = await 导入单篇Excel(file);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        failMsgs.push(result.msg);
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

  function 导出Excel() {
    if (articles.length === 0) {
      alert("没有可导出的文章");
      return;
    }

    const headers = ["标题", "分类", "类型", "作者", "创建时间"];
    const rows = articles.map((a) => [
      a.title,
      a.knowledge_categories?.name || "",
      类型标签[a.type] || a.type,
      a.profiles?.full_name || "系统",
      new Date(a.created_at).toLocaleDateString(),
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "知识库文章");
    XLSX.writeFile(wb, `知识库文章_${new Date().toISOString().split("T")[0]}.xlsx`);
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
        content_blocks: article.content_blocks as BlockNoteBlock[] | null,
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
          onClick={导出Excel}
          className="px-3 py-2 text-sm text-green-700 bg-white border border-green-300 rounded-lg hover:bg-green-50"
        >
          导出Excel
        </button>
        <button
          onClick={() => setShowExportModal(true)}
          className="px-3 py-2 text-sm text-green-700 bg-white border border-green-300 rounded-lg hover:bg-green-50"
        >
          导出Word
        </button>
        <button
          onClick={下载Excel模板}
          className="px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          下载模板
        </button>
        <button
          onClick={() => excelInputRef.current?.click()}
          disabled={importing}
          className="px-3 py-2 text-sm text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
        >
          {importing ? "导入中..." : "导入Excel"}
        </button>
        <button
          onClick={() => wordInputRef.current?.click()}
          disabled={importing}
          className="px-3 py-2 text-sm text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
        >
          {importing ? "导入中..." : "导入Word"}
        </button>

        <input
          ref={excelInputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) 批量导入Excel(files);
            e.target.value = "";
          }}
        />
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
