"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import KnowledgeImportExport from "./KnowledgeImportExport";
import { loadKnowledgeArticles } from "./actions";

/* ═════════════════════════════════════════════════════════════════
 * 知识库 — Client Component（展示 + 交互）
 *
 * 数据查询通过 Server Action（loadKnowledgeArticles）在服务端完成，
 * 彻底消除客户端 session 问题对列表加载的影响。
 * ═════════════════════════════════════════════════════════════════ */

interface InlineContent {
  type: string;
  text?: string;
  content?: InlineContent[];
}

interface BlockItem {
  type: string;
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
  return content
    .map((item) => {
      if (item.type === "link" && item.content) {
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

function extractSummary(a: 知识文章): string {
  if (a.content_blocks && Array.isArray(a.content_blocks)) {
    const text = extractTextFromBlocks(a.content_blocks);
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

function 权限标签(visibility: string) {
  const map: Record<string, { label: string; className: string }> = {
    public: { label: "公开", className: "bg-green-50 text-green-700" },
    internal: { label: "内部", className: "bg-blue-50 text-blue-700" },
    private: { label: "私有", className: "bg-gray-100 text-gray-600" },
  };
  const config = map[visibility] || map.public;
  return config;
}

export default function KnowledgePage() {
  const [articles, setArticles] = useState<知识文章[]>([]);
  const [categories, setCategories] = useState<知识分类[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [readCounts, setReadCounts] = useState<Record<string, number>>({});

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [queryError, setQueryError] = useState<string | null>(null);

  /* 加载数据：通过 Server Action */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setQueryError(null);
      try {
        const result = await loadKnowledgeArticles({
          keyword: debouncedKeyword,
          category: selectedCategory,
          page,
        });

        if (cancelled) return;

        if (!result.success || result.error) {
          setQueryError(result.error || "加载失败");
          setArticles([]);
          setCategories([]);
        } else {
          setArticles(result.articles || []);
          setCategories(result.categories || []);
          setReadCounts(result.readCounts || {});
          setCurrentUserId(result.currentUserId || "");
          setIsAdmin(result.isAdmin || false);
          setTotal(result.total || 0);
          setTotalPages(result.totalPages || 1);
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
  }, [debouncedKeyword, selectedCategory, page]);

  /* 搜索防抖 */
  function handleSearchChange(val: string) {
    setSearchKeyword(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedKeyword(val.trim());
      setPage(1);
    }, 300);
  }

  /* 分类切换 */
  function handleCategoryChange(catId: string) {
    setSelectedCategory(catId);
    setPage(1);
  }

  /* 解析搜索关键词：空格分词 + 中文2字子串 */
  const searchKeywords = useMemo(() => {
    const raw = debouncedKeyword.trim();
    if (!raw) return [];
    const words = raw.split(/\s+/).filter((k: string) => k.length > 0);
    const result = [...words];
    for (const word of words) {
      if (word.length >= 2) {
        for (let i = 0; i <= word.length - 2; i++) {
          result.push(word.slice(i, i + 2));
        }
      }
    }
    return [...new Set(result)];
  }, [debouncedKeyword]);

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

      {/* 导入导出按钮 */}
      <div className="mb-4">
        <KnowledgeImportExport
          articles={articles}
          categories={categories}
          onSuccess={() => {
            setSearchKeyword("");
            setDebouncedKeyword("");
            setSelectedCategory("");
            setPage(1);
            window.location.reload();
          }}
        />
      </div>

      {/* 搜索栏 */}
      <div className="mb-6">
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
                setDebouncedKeyword("");
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
        {/* 分类侧边栏 */}
        <div className="lg:col-span-1">
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
                const reads = readCounts[a.id] || 0;

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
                            <span className="text-xs text-gray-500">{获取分类名(a)}</span>
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
                          <span>{new Date(a.created_at).toLocaleDateString()}</span>
                          <span className="flex items-center gap-0.5">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            {reads}
                          </span>
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
