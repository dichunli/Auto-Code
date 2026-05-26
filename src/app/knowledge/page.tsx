"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

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
  knowledge_categories: { name: string } | null;
  profiles: { full_name: string } | null;
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

/* 计算搜索相关性分数 */
function 计算相关性分数(article: 知识文章, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const title = article.title.toLowerCase();
  const summary = extractSummary(article).toLowerCase();
  const categoryName = article.knowledge_categories?.name?.toLowerCase() || "";
  let score = 0;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (!kwLower) continue;

    /* 标题开头匹配（最高权重） */
    if (title.startsWith(kwLower)) {
      score += 100;
    }
    /* 标题包含 */
    else if (title.includes(kwLower)) {
      score += 50;
    }
    /* 分类名包含 */
    else if (categoryName.includes(kwLower)) {
      score += 30;
    }
    /* 内容摘要包含 */
    else if (summary.includes(kwLower)) {
      score += 10;
    }
  }

  /* 额外加分：标题包含的关键词数量越多越靠前 */
  const titleMatchCount = keywords.filter((kw) =>
    kw ? title.includes(kw.toLowerCase()) : false
  ).length;
  score += titleMatchCount * 20;

  return score;
}

export default function KnowledgePage() {
  const supabase = createClient();
  const [articles, setArticles] = useState<知识文章[]>([]);
  const [categories, setCategories] = useState<知识分类[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 加载数据 */
  useEffect(() => {
    async function load() {
      const { data: articlesData } = await supabase
        .from("knowledge_articles")
        .select("*, knowledge_categories(name), profiles(full_name)")
        .order("created_at", { ascending: false })
        .limit(100);

      const { data: categoriesData } = await supabase
        .from("knowledge_categories")
        .select("*")
        .order("sort_order", { ascending: true })
        .limit(100);

      setArticles(articlesData || []);
      setCategories(categoriesData || []);
      setLoading(false);
    }
    load();
  }, [supabase]);

  /* 搜索防抖 */
  function handleSearchChange(val: string) {
    setSearchKeyword(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedKeyword(val.trim()), 300);
  }

  /* 解析搜索关键词（支持空格分隔多关键词） */
  const searchKeywords = useMemo(() => {
    return debouncedKeyword.split(/\s+/).filter((k) => k.length > 0);
  }, [debouncedKeyword]);

  /* 过滤文章 */
  const filteredArticles = useMemo(() => {
    let result = articles;

    /* 按分类过滤 */
    if (selectedCategory) {
      result = result.filter((a) => a.category_id === selectedCategory);
    }

    /* 按关键词搜索 */
    if (searchKeywords.length > 0) {
      result = result
        .map((a) => ({
          article: a,
          score: 计算相关性分数(a, searchKeywords),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.article);
    }

    return result;
  }, [articles, selectedCategory, searchKeywords]);

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
            搜索 "{debouncedKeyword}"，找到 {filteredArticles.length} 条结果
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
              return (
                <Link
                  key={a.id}
                  href={`/knowledge/${a.id}`}
                  className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${config.className}`}>
                          {config.label}
                        </span>
                        {a.knowledge_categories?.name && (
                          <span className="text-xs text-gray-500">{a.knowledge_categories.name}</span>
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
                        <span>{a.profiles?.full_name || "系统"}</span>
                        <span>{new Date(a.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
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
