"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import KnowledgeImportExport from "./KnowledgeImportExport";

interface 知识分类 {
  id: string;
  name: string;
}

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
  knowledge_categories?: { name: string } | null;
  profiles?: { full_name: string } | null;
  /* RPC search_knowledge_articles 返回的字段 */
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

/* 多关键词高亮 */
function 高亮文本(text: string, keywords: string[]): React.ReactNode {
  if (keywords.length === 0) return text;
  const pattern = keywords
    .filter((k) => k.length > 0)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!pattern) return text;
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 rounded px-0.5">{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/* 获取分类名，兼容 RPC 和常规查询两种数据结构 */
function 获取分类名(a: 知识文章): string {
  return a.knowledge_categories?.name || a.category_name || "";
}

/* 获取作者名，兼容 RPC 和常规查询两种数据结构 */
function 获取作者名(a: 知识文章): string {
  return a.profiles?.full_name || a.author_name || "系统";
}

/* 权限标签 */
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
  const supabase = useMemo(() => createClient(), []);
  const [articles, setArticles] = useState<知识文章[]>([]);
  const [categories, setCategories] = useState<知识分类[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 当前用户信息 */
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  /* 阅读次数 */
  const [readCounts, setReadCounts] = useState<Record<string, number>>({});

  /* 加载当前用户信息 */
  useEffect(() => {
    async function loadUser() {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (uid) {
        setCurrentUserId(uid);
        const { data: roleData } = await supabase
          .from("profile_roles")
          .select("roles(name)")
          .eq("profile_id", uid);
        const roleNames = (roleData || []).map(
          (d: { roles?: { name?: string } | null }) => d.roles?.name
        ).filter(Boolean) as string[];
        setIsAdmin(roleNames.includes("admin"));
      }
    }
    loadUser();
  }, [supabase]);

  /* 加载数据：有搜索词时调用 RPC，无搜索词时正常查询 */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      console.log("[知识库] 开始加载数据, debouncedKeyword:", debouncedKeyword);
      try {
        let articlesData: 知识文章[] = [];

        if (debouncedKeyword.trim()) {
          /* 分词搜索：调用数据库函数 */
          console.log("[知识库] 调用 RPC search_knowledge_articles");
          interface 搜索结果行 {
            id: string;
            title: string;
            content: string;
            content_blocks: BlockItem[] | null;
            type: string;
            created_at: string;
            category_id: string | null;
            category_name: string | null;
            author_name: string | null;
            visibility: string;
            created_by: string | null;
            score: number;
          }
          const { data, error } = await supabase.rpc("search_knowledge_articles", {
            search_query: debouncedKeyword.trim(),
          });
          if (cancelled) return;
          if (error) {
            console.error("[知识库] 搜索出错:", error);
            setArticles([]);
            setCategories([]);
            setLoading(false);
            return;
          }
          const rows = (data || []) as 搜索结果行[];
          articlesData = rows.map((row) => ({
            ...row,
            knowledge_categories: row.category_name ? { name: row.category_name } : null,
            profiles: row.author_name ? { full_name: row.author_name } : null,
          }));
        } else {
          /* 正常加载全部 */
          console.log("[知识库] 正常加载文章列表");
          const { data, error } = await supabase
            .from("knowledge_articles")
            .select("*, knowledge_categories(name), profiles(full_name), created_by")
            .order("created_at", { ascending: false })
            .limit(100);
          if (cancelled) return;
          if (error) {
            console.error("[知识库] 加载文章出错:", error);
            setArticles([]);
            setCategories([]);
            setLoading(false);
            return;
          }
          articlesData = (data || []) as 知识文章[];
        }

        console.log("[知识库] 加载分类...");
        const { data: categoriesData, error: catError } = await supabase
          .from("knowledge_categories")
          .select("*")
          .order("sort_order", { ascending: true })
          .limit(100);
        if (cancelled) return;
        if (catError) {
          console.error("[知识库] 加载分类出错:", catError);
        }

        /* 加载阅读次数 */
        if (articlesData.length > 0) {
          const articleIds = articlesData.map((a) => a.id);
          const { data: readsData, error: readsError } = await supabase
            .from("knowledge_article_reads")
            .select("article_id")
            .in("article_id", articleIds);

          if (!readsError && readsData) {
            const counts: Record<string, number> = {};
            for (const r of readsData) {
              const aid = r.article_id as string;
              counts[aid] = (counts[aid] || 0) + 1;
            }
            setReadCounts(counts);
          }
        }

        console.log("[知识库] 加载完成, 文章:", articlesData.length, "分类:", (categoriesData || []).length);
        setArticles(articlesData);
        setCategories(categoriesData || []);
      } catch (err: unknown) {
        console.error("[知识库] 加载数据异常:", err);
        setArticles([]);
        setCategories([]);
      }
      if (!cancelled) {
        setLoading(false);
        console.log("[知识库] loading 已关闭");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [supabase, debouncedKeyword]);

  /* 搜索防抖 */
  function handleSearchChange(val: string) {
    setSearchKeyword(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedKeyword(val.trim()), 300);
  }

  /* 解析搜索关键词：空格分词 + 中文2字子串（和数据库函数逻辑一致） */
  const searchKeywords = useMemo(() => {
    const raw = debouncedKeyword.trim();
    if (!raw) return [];
    const words = raw.split(/\s+/).filter((k) => k.length > 0);
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

  /* 过滤文章：分类过滤在前端做，搜索已交给数据库函数 */
  const filteredArticles = useMemo(() => {
    let result = articles;
    if (selectedCategory) {
      result = result.filter((a) => a.category_id === selectedCategory);
    }
    return result;
  }, [articles, selectedCategory]);

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
            搜索 &quot;{debouncedKeyword}&quot;，找到 {filteredArticles.length} 条结果
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 分类侧边栏 */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            {/* 分类标题 + 展开/收起按钮（仅移动端显示） */}
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

            {/* 分类列表：桌面端始终显示，移动端根据 expanded 状态 */}
            <div className={`${categoriesExpanded ? "block" : "hidden lg:block"} space-y-1`}>
              <button
                type="button"
                onClick={() => setSelectedCategory("")}
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
                  onClick={() => setSelectedCategory(c.id)}
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
          ) : filteredArticles.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
              {debouncedKeyword || selectedCategory ? "没有找到匹配的文章" : "暂无知识库内容"}
            </div>
          ) : (
            filteredArticles.map((a) => {
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
            })
          )}
        </div>
      </div>
    </div>
  );
}
