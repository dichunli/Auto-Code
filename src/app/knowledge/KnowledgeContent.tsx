"use client";

import { useState, useEffect, useRef, useCallback, useMemo, type ComponentProps } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { useDebounce } from "@/lib/useDebounce";
import KnowledgeImportExport from "./KnowledgeImportExport";
import { loadKnowledgeArticles } from "./actions";

/* ═════════════════════════════════════════════════════════════════
 * 知识库 — Client Component（展示 + 交互）
 *
 * 数据首次通过 Server Component 预加载（props 传入），
 * 后续搜索/分类/分页通过 Server Action 在服务端完成查询。
 * ═════════════════════════════════════════════════════════════════ */

interface InlineContent {
  type: string;
  text?: string;
  content?: InlineContent[];
}

interface BlockItem {
  type: string;
  props?: {
    allowedGroups?: string | string[];
  };
  content?: InlineContent[] | { type: string; rows: unknown[] };
  children?: BlockItem[];
}

interface 知识分类 {
  id: string;
  name: string;
}

interface 知识文章 {
  id: string;
  title: string;
  content: string;
  content_blocks: BlockItem[] | null;
  type: string;
  created_at: string;
  category_id: string | null;
  created_by: string | null;
  visibility: string;
  category_name?: string | null;
  author_name?: string | null;
  score?: number;
}

function extractTextFromInline(content: InlineContent[]): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (item.type === "link" && Array.isArray(item.content)) {
        return extractTextFromInline(item.content);
      }
      return item.text || "";
    })
    .join("");
}

function extractTextFromBlocks(blocks: BlockItem[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (Array.isArray(block.content)) {
      parts.push(extractTextFromInline(block.content));
    }
    if (block.children && block.children.length > 0) {
      parts.push(extractTextFromBlocks(block.children));
    }
  }
  return parts.join(" ");
}

/* 列表摘要专用：只要段落设置了「可见分组」权限，就一律剔除（不分角色、不分分组）。
   摘要是列表预览给所有人看的，带权限的内容不应出现在这里。 */
function 剔除受限块(blocks: BlockItem[]): BlockItem[] {
  return blocks
    .filter((block) => {
      const rawAllowed = block.props?.allowedGroups;
      const 已设权限 =
        (Array.isArray(rawAllowed) && rawAllowed.length > 0) ||
        (typeof rawAllowed === "string" && rawAllowed.trim() !== "");
      return !已设权限;
    })
    .map((block) => ({
      ...block,
      children: block.children ? 剔除受限块(block.children) : undefined,
    }));
}

function extractSummary(a: 知识文章): string {
  if (a.content_blocks && Array.isArray(a.content_blocks)) {
    const 公开块 = 剔除受限块(a.content_blocks);
    const text = extractTextFromBlocks(公开块);
    return text.slice(0, 120) || "暂无内容";
  }
  return a.content?.replace(/<[^>]*>/g, "").slice(0, 120) || "暂无内容";
}

/* 高亮文本 — 修复了原版的 regex.test 副作用 bug */
function 高亮文本(text: string, keywords: string[]): React.ReactNode {
  if (keywords.length === 0 || !text) return text;
  const pattern = keywords
    .filter((k) => k.length > 0)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!pattern) return text;
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) => {
    const isMatch = keywords.some(
      (k) => k.length > 0 && part.toLowerCase() === k.toLowerCase()
    );
    return isMatch ? (
      <mark key={i} className="bg-yellow-200 rounded px-0.5">{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

function 获取分类名(a: 知识文章): string {
  return a.category_name || "";
}

function 获取作者名(a: 知识文章): string {
  return a.author_name || "系统";
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString();
  } catch {
    return "-";
  }
}

function 权限标签(visibility: string) {
  const map: Record<string, { label: string; className: string }> = {
    public: { label: "公开", className: "bg-green-50 text-green-700" },
    internal: { label: "内部", className: "bg-blue-50 text-blue-700" },
    private: { label: "私有", className: "bg-gray-100 text-gray-600" },
  };
  const config = map[visibility] || map.public;
  return config;
}

interface Props {
  initialArticles: 知识文章[];
  initialCategories: 知识分类[];
  initialTotal: number;
  initialTotalPages: number;
  initialSegments: string[];
  currentUserId: string;
  isAdmin: boolean;
  initialAuthorId?: string;
  initialAuthorName?: string;
}

export default function KnowledgeContent({
  initialArticles,
  initialCategories,
  initialTotal,
  initialTotalPages,
  initialSegments,
  currentUserId: serverUserId,
  isAdmin: serverIsAdmin,
  initialAuthorId = "",
  initialAuthorName = "",
}: Props) {
  const [articles, setArticles] = useState<知识文章[]>(initialArticles);
  const [categories, setCategories] = useState<知识分类[]>(initialCategories);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const debouncedKeyword = useDebounce(searchKeyword, 300);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);

  const [currentUserId, setCurrentUserId] = useState<string>(serverUserId);
  const [isAdmin, setIsAdmin] = useState(serverIsAdmin);
  const [segments, setSegments] = useState<string[]>(initialSegments);

  const authorId = initialAuthorId;
  const authorName = initialAuthorName;

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [queryError, setQueryError] = useState<string | null>(null);

  /* 跳过首次挂载的加载（数据已由 Server Component 预加载） */
  const isInitialMount = useRef(true);

  /* 加载数据：通过 Server Action */
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setQueryError(null);
      try {
        const result = await loadKnowledgeArticles({
          keyword: debouncedKeyword,
          category: selectedCategory,
          page,
          createdBy: authorId,
          searchMode,
        });

        if (cancelled) return;

        if (!result.success || result.error) {
          setQueryError(result.error || "加载失败");
          setArticles([]);
          setCategories([]);
          setSegments([]);
        } else {
          setArticles((result.articles || []) as unknown as 知识文章[]);
          setCategories(result.categories || []);
          setCurrentUserId(result.currentUserId || "");
          setIsAdmin(result.isAdmin || false);
          setTotal(result.total || 0);
          setTotalPages(result.totalPages || 1);
          setSegments(result.segments || []);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setQueryError(err instanceof Error ? err.message : "加载异常");
          setArticles([]);
        }
      }
      if (!cancelled) {
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [debouncedKeyword, selectedCategory, page, authorId, searchMode]);

  /* 搜索输入只更新原始状态，防抖由 useDebounce 处理 */
  function handleSearchChange(val: string) {
    setSearchKeyword(val);
    setPage(1);
  }

  /* 分类切换 */
  function handleCategoryChange(catId: string) {
    setSelectedCategory(catId);
    setPage(1);
  }

  /* 高亮关键词使用后端分词结果 */
  const searchKeywords = useMemo(() => segments.filter((k) => k.length > 0), [segments]);

  const 类型标签 = useCallback((type: string) => {
    const map: Record<string, { label: string; className: string }> = {
      video: { label: "视频", className: "bg-red-50 text-red-700" },
      qa: { label: "问答", className: "bg-green-50 text-green-700" },
      guide: { label: "维修指导", className: "bg-orange-50 text-orange-700" },
    };
    const config = map[type] || { label: "文章", className: "bg-blue-50 text-blue-700" };
    return config;
  }, []);

  return (
    <div>
      <PageHeader
        title="知识库"
        description="维修指导、视频教程、常见问题"
        action={{ href: "/knowledge/new", label: "新建知识" }}
      />

      {/* 个人入口与统计 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Link
          href="/knowledge/my"
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          我的文章
        </Link>
        <Link
          href="/reports/knowledge-articles"
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          统计报表
        </Link>
      </div>

      {/* 当前作者筛选提示 */}
      {authorId && authorName && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <span className="text-sm text-blue-700">
            正在查看 <strong>{authorName}</strong> 提交的文章
          </span>
          <Link
            href="/knowledge"
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            清除筛选
          </Link>
        </div>
      )}

      {/* 导入导出按钮 — 桌面端显示 */}
      <div className="hidden lg:block mb-4">
        <KnowledgeImportExport
          articles={articles as unknown as ComponentProps<typeof KnowledgeImportExport>["articles"]}
          categories={categories}
          onSuccess={() => {
            setSearchKeyword("");
            setSelectedCategory("");
            setPage(1);
            window.location.reload();
          }}
        />
      </div>

      {/* 搜索栏 */}
      <div className="mb-6">
        {/* 搜索模式切换 */}
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setSearchMode("semantic")}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${
              searchMode === "semantic"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            AI 语义搜索
          </button>
          <button
            type="button"
            onClick={() => setSearchMode("keyword")}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${
              searchMode === "keyword"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            关键词搜索
          </button>
        </div>
        <div className="relative">
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="搜索知识库标题或内容..."
            className="w-full px-4 py-2.5 pl-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchKeyword && (
            <button
              type="button"
              onClick={() => {
                setSearchKeyword("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {debouncedKeyword && (
          <p className="mt-2 text-xs text-gray-500">
            搜索 &quot;{debouncedKeyword}&quot;，找到 {total} 条结果
          </p>
        )}
      </div>

      {/* 数据加载错误提示 */}
      {queryError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="font-medium text-red-700">数据加载失败</p>
          <p className="text-sm text-red-600 mt-1">{queryError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 text-sm text-blue-600 hover:text-blue-700"
          >
            刷新页面重试
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 分类侧边栏 — 桌面端显示 */}
        <div className="hidden lg:block lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">分类</h3>
              <div className="flex items-center gap-2">
                <Link href="/knowledge/categories" className="text-xs text-blue-600 hover:text-blue-700">
                  管理
                </Link>
                <button
                  type="button"
                  onClick={() => setCategoriesExpanded(!categoriesExpanded)}
                  className="lg:hidden text-xs text-gray-500 hover:text-gray-700 p-1"
                  title={categoriesExpanded ? "收起" : "展开"}
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${categoriesExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>

            <div className={`${categoriesExpanded ? "block" : "hidden lg:block"} space-y-1`}>
              <button
                type="button"
                onClick={() => handleCategoryChange("")}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  selectedCategory === ""
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                全部
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleCategoryChange(c.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedCategory === c.id
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 文章列表 */}
        <div className="lg:col-span-3 space-y-4">
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
              加载中...
            </div>
          ) : articles.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
              {debouncedKeyword || selectedCategory ? "没有找到匹配的文章" : "暂无知识库内容"}
            </div>
          ) : (
            <>
              {articles.map((a) => {
                const config = 类型标签(a.type);
                const permConfig = 权限标签(a.visibility || "public");
                const canEdit = isAdmin || a.created_by === currentUserId;

                return (
                  <Link
                    key={a.id}
                    href={`/knowledge/${a.id}`}
                    className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded ${config.className}`}>
                            {config.label}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded ${permConfig.className}`}>
                            {permConfig.label}
                          </span>
                          {获取分类名(a) && (
                            <span className="hidden lg:inline text-xs text-gray-500">{获取分类名(a)}</span>
                          )}
                        </div>
                        <h3 className="text-base font-semibold text-gray-900 mb-1">
                          {searchKeywords.length > 0
                            ? 高亮文本(a.title, searchKeywords)
                            : a.title}
                        </h3>
                        <p className="text-sm text-gray-500 line-clamp-2">
                          {searchKeywords.length > 0
                            ? 高亮文本(extractSummary(a), searchKeywords)
                            : extractSummary(a)}
                        </p>
                        <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                          <span>{获取作者名(a)}</span>
                          <span>{formatDate(a.created_at)}</span>
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex-shrink-0 ml-3">
                          <Link
                            href={`/knowledge/${a.id}/edit`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs px-2 py-1 text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
                          >
                            编辑
                          </Link>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 mt-4">
                  <div className="text-sm text-gray-500">
                    共 {total} 条，第 {page}/{totalPages} 页
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${
                        page <= 1 ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      上一页
                    </button>
                    <span className="text-sm text-gray-600 px-2">
                      {page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${
                        page >= totalPages ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
