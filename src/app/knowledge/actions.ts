"use server";

import mammoth from "mammoth";
import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { 中文分词 } from "@/lib/chineseSegmenter";
import { 文字转向量, 文档转向量, 生成嵌入文本 } from "@/lib/localEmbedding";

/* ═════════════════════════════════════════════════════════════════
 * 知识库数据查询 Server Action
 * 把数据查询从客户端移到服务端，消除客户端 session 问题的影响。
 * ═════════════════════════════════════════════════════════════════ */

interface 知识文章数据 {
  id: string;
  title: string;
  content: string;
  content_blocks: unknown;
  type: string;
  created_at: string;
  category_id: string | null;
  created_by: string | null;
  visibility: string;
  category_name?: string | null;
  author_name?: string | null;
  score?: number;
}

interface 知识分类数据 {
  id: string;
  name: string;
}

export async function loadKnowledgeArticles(params: {
  keyword?: string;
  category?: string;
  page?: number;
  createdBy?: string;
  /** 搜索模式：keyword=关键词全文检索  semantic=语义搜索 */
  searchMode?: "keyword" | "semantic";
}): Promise<{
  success: boolean;
  articles?: 知识文章数据[];
  categories?: 知识分类数据[];
  currentUserId?: string;
  isAdmin?: boolean;
  total?: number;
  totalPages?: number;
  segments?: string[];
  error?: string;
}> {
  /* 登录校验（Server Action 也是公开端点，必须验证） */
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "请先登录" };

  const { keyword = "", category = "", page = 1, createdBy = "", searchMode = "keyword" } = params;
  const pageSize = 20;
  const fromIdx = (page - 1) * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  const supabase = await createClient();

  /* 只在需要搜索时才加载分词字典（节省一次查询） */
  const searchKeywords = keyword.trim()
    ? await (async () => {
        const { data: customWordsData } = await supabase
          .from("search_dictionary")
          .select("word")
          .order("created_at", { ascending: false });
        const customWords = (customWordsData || []).map((row) => String(row.word));
        return 中文分词(keyword.trim(), customWords);
      })()
    : [];

  /* 分类列表查询（用户身份已在上方登录校验时获取，无需重复 getUser） */
  const categoriesResult = await supabase.from("knowledge_categories").select("*").order("sort_order", { ascending: true }).limit(100);

  const currentUserId = user.id;
  let isAdmin = false;
  if (currentUserId) {
    const { data: roleData } = await supabase
      .from("profile_roles")
      .select("roles(name)")
      .eq("profile_id", currentUserId);
    isAdmin = ((roleData || []) as unknown as { roles?: { name?: string } | null }[]).some(
      (d) => d.roles?.name === "admin"
    );
  }

  /* 查询文章 */
  let articles: 知识文章数据[] = [];
  let total = 0;

  /* 构建筛选条件（泛型保持查询构建器原类型，无需关心 select 前后类型差异） */
  function 应用筛选条件<T extends { eq: (column: string, value: string) => T }>(query: T): T {
    if (category) query = query.eq("category_id", category);
    if (createdBy) query = query.eq("created_by", createdBy);
    return query;
  }

  let 语义搜索完成 = false;

  if (keyword.trim() && searchMode === "semantic") {
    /* 语义搜索模式：本地模型转向量 → pgvector 纯向量搜索 → 代码层同义词扩展 + 关键词加分 */
    try {
      /* 查询同义词映射表 */
      const { data: synonymData } = await supabase
        .from("synonym_mapping")
        .select("term, synonyms");

      const 扩展词列表 = [keyword.trim()];
      if (synonymData?.length) {
        for (const row of synonymData) {
          const 原词 = String(row.term || "");
          const 同义词组 = (Array.isArray(row.synonyms) ? row.synonyms : []) as string[];
          if (!原词) continue;

          /* 双向匹配 */
          const 所有相关词 = [原词, ...同义词组];
          const 是否命中 = 所有相关词.some(
            (词) => keyword.includes(词) || 词.includes(keyword)
          );

          if (是否命中) {
            扩展词列表.push(...所有相关词);
          }
        }
      }

      const 搜索词数组 = [...new Set(扩展词列表)];

      /* 用原始关键词生成向量 */
      const 查询向量 = await 文字转向量(keyword.trim());

      /* 用已验证稳定的 v3 纯向量搜索函数 */
      const { data: rpcResults, error: rpcError } = await supabase
        .rpc("search_knowledge_semantic", {
          query_embedding: 查询向量,
          p_category_id: category || null,
          p_limit: pageSize,
          p_offset: fromIdx,
        });

      if (rpcError) throw rpcError;

      const allResults = (rpcResults || []) as Array<{
        id: string; title: string; content: string; content_blocks: unknown;
        type: string; created_at: string; category_id: string | null;
        category_name: string | null; author_name: string | null;
        visibility: string; created_by: string | null; similarity: number;
        total_count: number;
      }>;

      total = allResults.length > 0 ? Number(allResults[0].total_count) : 0;

      /* 在代码层做同义词关键词加分 + 重排序 */
      articles = allResults.map((r) => {
        /* 全文：标题 + 内容字段 + content_blocks */
        const 全文 = (r.title || "") + " " + (r.content || "") + " " + (() => {
          try { return JSON.stringify(r.content_blocks); } catch { return ""; }
        })();
        /* 计算关键词命中加分 */
        let 关键词加分 = 0;
        for (const 词 of 搜索词数组) {
          const 命中 = 全文.toLowerCase().includes(词.toLowerCase());
          if (命中 && (r.title || "").toLowerCase().includes(词.toLowerCase())) 关键词加分 += 20;
          else if (命中) 关键词加分 += 10;
        }
        /* 最终分 = 语义相似度 × 40% + 关键词加分归一化 × 60% */
        const 关键词归一化 = Math.min(关键词加分, 50) / 50;
        const 最终分 = r.similarity * 0.4 + 关键词归一化 * 0.6;

        return {
          id: r.id,
          title: r.title,
          content: r.content,
          content_blocks: r.content_blocks,
          type: r.type,
          created_at: r.created_at,
          category_id: r.category_id,
          created_by: r.created_by,
          visibility: r.visibility,
          category_name: r.category_name,
          author_name: r.author_name,
          score: Math.round(最终分 * 100),
        };
      });

      /* 按最终分降序重排 */
      articles.sort((a, b) => (b.score || 0) - (a.score || 0));

      /* 从 content_blocks 提取纯文本（用于关键词匹配） */
      function 提取内容块文本(块: unknown): string {
        if (!块) return "";
        try { return JSON.stringify(块); } catch { return ""; }
      }

      /* 过滤：必须至少命中一个搜索词，最多 15 条 */
      const 过滤前数量 = articles.length;
      articles = articles.filter((a) => {
        const 全文 = (a.title || "") + " " + (a.content || "") + " " + 提取内容块文本(a.content_blocks);
        const 命中关键词 = 搜索词数组.some(
          (词) => 全文.toLowerCase().includes(词.toLowerCase())
        );
        return 命中关键词;
      }).slice(0, 15);
      if (过滤前数量 > articles.length || articles.length < 过滤前数量) {
        console.log(`[knowledge] 过滤低分结果: ${过滤前数量} → ${articles.length} 条 (最高分: ${articles.length > 0 ? articles[0].score : 0})`);
        if (total > 0 && 过滤前数量 > 0) {
          total = Math.max(articles.length, Math.round(total * (articles.length / 过滤前数量)));
        }
      }

      /* 始终补充关键词搜索结果，合并去重（语义结果优先） */
      if (搜索词数组.length > 1) {
        console.log(`[knowledge] 语义搜索命中 ${total} 条，同义词扩展 ${搜索词数组.length - 1} 个`);
      }
      语义搜索完成 = true;
      /* 把扩展词加入关键词搜索，用于补充没有向量的文章 */
      searchKeywords.push(...搜索词数组);
    } catch (err: unknown) {
      const 错误详情 = err instanceof Error
        ? err.message
        : (err && typeof err === "object" && "message" in err)
          ? String((err as Record<string, unknown>).message)
          : String(err);
      console.warn("[knowledge] 语义搜索失败，回退到关键词搜索:", 错误详情);
      /* 语义搜索失败时，至少用原始关键词搜索 */
      if (keyword.trim()) {
        searchKeywords.push(keyword.trim());
      }
    }
  }

  if (语义搜索完成 && searchKeywords.length > 0) {
    /* 语义搜索已返回结果，关键词搜索补充没有向量的文章（合并去重） */
    const 已有ID = new Set(articles.map((a) => a.id));
    const { data: rpcResults, error: rpcError } = await supabase
      .rpc("search_knowledge_articles", {
        search_keywords: searchKeywords,
        p_category_id: category || null,
        p_limit: pageSize * 3,   /* 取更多结果用于合并去重 */
        p_offset: 0,
      });

    if (!rpcError && rpcResults) {
      const allKWResults = rpcResults as Array<{
        id: string; title: string; content: string; content_blocks: unknown;
        type: string; created_at: string; category_id: string | null;
        category_name: string | null; author_name: string | null;
        visibility: string; created_by: string | null; score: number;
        total_count: number;
      }>;

      let 补充计数 = 0;
      for (const r of allKWResults) {
        if (!已有ID.has(r.id)) {
          articles.push({
            id: r.id,
            title: r.title,
            content: r.content,
            content_blocks: r.content_blocks,
            type: r.type,
            created_at: r.created_at,
            category_id: r.category_id,
            created_by: r.created_by,
            visibility: r.visibility,
            category_name: r.category_name,
            author_name: r.author_name,
            score: r.score, /* 关键词分数 */
          });
          已有ID.add(r.id);
          补充计数++;
        }
      }
      total = articles.length;
      if (补充计数 > 0) {
        console.log(`[knowledge] 关键词补充: +${补充计数} 篇（无向量的文章）`);
      }
    }

    /* 按分数降序重排合并结果 */
    articles.sort((a, b) => (b.score || 0) - (a.score || 0));
  } else if (语义搜索完成 && !keyword.trim()) {
    /* 语义模式但无搜索词 → 显示全部（与普通列表一致） */
  } else if (!语义搜索完成 && searchKeywords.length > 0) {
    /* 纯关键词搜索模式 */
    const { data: rpcResults, error: rpcError } = await supabase
      .rpc("search_knowledge_articles", {
        search_keywords: searchKeywords,
        p_category_id: category || null,
        p_limit: pageSize,
        p_offset: fromIdx,
      });

    if (rpcError) {
      /* RPC 失败，回退到 ilike */
      console.warn("[knowledge] RPC 全文检索失败，回退到 ilike:", rpcError.message);
      let countQuery = supabase
        .from("knowledge_articles")
        .select("*", { count: "exact", head: true });
      countQuery = 应用筛选条件(countQuery);
      for (const kw of searchKeywords) {
        countQuery = countQuery.or(`title.ilike.%${kw}%,content.ilike.%${kw}%`);
      }
      const { count, error: countError } = await countQuery;
      if (countError) {
        return { success: false, error: countError.message, segments: searchKeywords };
      }
      total = count || 0;

      let query = supabase
        .from("knowledge_articles")
        .select("*, knowledge_categories(name), profiles(full_name)")
        .order("created_at", { ascending: false })
        .range(fromIdx, toIdx);
      query = 应用筛选条件(query);
      for (const kw of searchKeywords) {
        query = query.or(`title.ilike.%${kw}%,content.ilike.%${kw}%`);
      }

      const { data, error } = await query;
      if (error) {
        return { success: false, error: error.message, segments: searchKeywords };
      }
      articles = (data || []).map((a: Record<string, unknown>) => ({
        id: a.id as string,
        title: a.title as string,
        content: a.content as string,
        content_blocks: a.content_blocks,
        type: a.type as string,
        created_at: a.created_at as string,
        category_id: a.category_id as string | null,
        created_by: a.created_by as string | null,
        visibility: a.visibility as string,
        category_name: (a.knowledge_categories as { name: string } | null)?.name || null,
        author_name: (a.profiles as { full_name: string } | null)?.full_name || null,
      }));
    } else {
      /* RPC v3 成功：数据库已分页+筛选，附带 total_count */
      const allResults = (rpcResults || []) as Array<{
        id: string; title: string; content: string; content_blocks: unknown;
        type: string; created_at: string; category_id: string | null;
        category_name: string | null; author_name: string | null;
        visibility: string; created_by: string | null; score: number;
        total_count: number;
      }>;

      /* 数据库已做分页和分类筛选，直接取结果 */
      total = allResults.length > 0 ? Number(allResults[0].total_count) : 0;

      articles = allResults.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        content_blocks: r.content_blocks,
        type: r.type,
        created_at: r.created_at,
        category_id: r.category_id,
        created_by: r.created_by,
        visibility: r.visibility,
        category_name: r.category_name,
        author_name: r.author_name,
        score: r.score,
      }));
    }
  } else if (!语义搜索完成) {
    /* 普通列表模式：数据库层真实分页 */
    let countQuery = supabase
      .from("knowledge_articles")
      .select("*", { count: "exact", head: true });
    countQuery = 应用筛选条件(countQuery);
    const { count, error: countError } = await countQuery;
    if (countError) {
      return { success: false, error: countError.message };
    }
    total = count || 0;

    let query = supabase
      .from("knowledge_articles")
      .select("*, knowledge_categories(name), profiles(full_name)")
      .order("created_at", { ascending: false })
      .range(fromIdx, toIdx);
    query = 应用筛选条件(query);

    const { data, error } = await query;
    if (error) {
      return { success: false, error: error.message };
    }
    articles = (data || []).map((a: Record<string, unknown>) => ({
      id: a.id as string,
      title: a.title as string,
      content: a.content as string,
      content_blocks: a.content_blocks,
      type: a.type as string,
      created_at: a.created_at as string,
      category_id: a.category_id as string | null,
      created_by: a.created_by as string | null,
      visibility: a.visibility as string,
      category_name: (a.knowledge_categories as { name: string } | null)?.name || null,
      author_name: (a.profiles as { full_name: string } | null)?.full_name || null,
    }));
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    success: true,
    articles,
    categories: (categoriesResult.data || []) as 知识分类数据[],
    currentUserId,
    isAdmin,
    total,
    totalPages,
    segments: searchKeywords,
  };
}

interface InlineText {
  type: "text";
  text: string;
  styles?: Record<string, boolean>;
}

interface InlineLink {
  type: "link";
  href: string;
  content: InlineText[];
}

type InlineContent = InlineText | InlineLink;

interface BlockNoteBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: InlineContent[];
  children?: BlockNoteBlock[];
}

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

function 解析HTML为Blocks(html: string): BlockNoteBlock[] {
  /* 服务端用简单的正则提取，不用 DOMParser */
  const blocks: BlockNoteBlock[] = [];

  /* 去掉 script/style */
  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  /* 匹配标题 */
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: { level: number; text: string; index: number }[] = [];
  let match;
  while ((match = headingRegex.exec(cleanHtml)) !== null) {
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (text) {
      headings.push({ level: parseInt(match[1]), text, index: match.index });
    }
  }

  /* 匹配段落 */
  const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const paragraphs: { text: string; index: number }[] = [];
  while ((match = paraRegex.exec(cleanHtml)) !== null) {
    const text = match[1].replace(/<[^>]*>/g, "").trim();
    if (text) {
      paragraphs.push({ text, index: match.index });
    }
  }

  const listItems: { text: string; parentTag: string; index: number }[] = [];
  const ulRegex = /<ul[^>]*>([\s\S]*?)<\/ul>/gi;
  const olRegex = /<ol[^>]*>([\s\S]*?)<\/ol>/gi;

  while ((match = ulRegex.exec(cleanHtml)) !== null) {
    const ulContent = match[1];
    let liMatch;
    const liRegexLocal = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    while ((liMatch = liRegexLocal.exec(ulContent)) !== null) {
      const text = liMatch[1].replace(/<[^>]*>/g, "").trim();
      if (text) {
        listItems.push({ text, parentTag: "ul", index: match.index + liMatch.index });
      }
    }
  }

  while ((match = olRegex.exec(cleanHtml)) !== null) {
    const olContent = match[1];
    let liMatch;
    const liRegexLocal = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    while ((liMatch = liRegexLocal.exec(olContent)) !== null) {
      const text = liMatch[1].replace(/<[^>]*>/g, "").trim();
      if (text) {
        listItems.push({ text, parentTag: "ol", index: match.index + liMatch.index });
      }
    }
  }

  /* 匹配表格 */
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const tables: { rows: { cells: unknown[][] }[]; index: number }[] = [];
  while ((match = tableRegex.exec(cleanHtml)) !== null) {
    const tableHtml = match[1];
    const rows: { cells: unknown[][] }[] = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRegex.exec(tableHtml)) !== null) {
      const cells: unknown[][] = [];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
        const text = cellMatch[1].replace(/<[^>]*>/g, "").trim();
        cells.push([{ type: "text", text, styles: {} }]);
      }
      if (cells.length > 0) {
        rows.push({ cells });
      }
    }
    if (rows.length > 0) {
      tables.push({ rows, index: match.index });
    }
  }

  /* 合并所有元素并按位置排序 */
  const allElements: Array<{
    type: string;
    index: number;
    data: unknown;
  }> = [
    ...headings.map((h) => ({ type: "heading", index: h.index, data: h })),
    ...paragraphs.map((p) => ({ type: "paragraph", index: p.index, data: p })),
    ...listItems.map((li) => ({ type: li.parentTag === "ul" ? "bullet" : "numbered", index: li.index, data: li })),
    ...tables.map((t) => ({ type: "table", index: t.index, data: t })),
  ];

  allElements.sort((a, b) => a.index - b.index);

  /* 按顺序生成 blocks */
  for (const el of allElements) {
    if (el.type === "heading") {
      const h = el.data as { level: number; text: string };
      blocks.push(创建文本块(h.text, "heading", { level: h.level }));
    } else if (el.type === "paragraph") {
      const p = el.data as { text: string };
      blocks.push(创建文本块(p.text));
    } else if (el.type === "bullet") {
      const li = el.data as { text: string };
      blocks.push({
        id: 生成块ID(),
        type: "bulletListItem",
        props: {},
        content: [{ type: "text", text: li.text, styles: {} }],
        children: [],
      });
    } else if (el.type === "numbered") {
      const li = el.data as { text: string };
      blocks.push({
        id: 生成块ID(),
        type: "numberedListItem",
        props: {},
        content: [{ type: "text", text: li.text, styles: {} }],
        children: [],
      });
    } else if (el.type === "table") {
      const t = el.data as { rows: { cells: unknown[][] }[] };
      blocks.push({
        id: 生成块ID(),
        type: "table",
        content: { type: "tableContent", rows: t.rows },
        children: [],
      } as unknown as BlockNoteBlock);
    }
  }

  /* 如果没有匹配到任何内容，尝试按换行分块 */
  if (blocks.length === 0) {
    const text = cleanHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text) {
      const 段落们 = text.split(/\n+/).filter((p) => p.trim());
      return 段落们.map((p) => 创建文本块(p.trim()));
    }
  }

  return blocks.length > 0 ? blocks : [创建文本块("")];
}

export async function 解析Word文档(formData: FormData): Promise<{
  success: boolean;
  title?: string;
  blocks?: BlockNoteBlock[];
  error?: string;
}> {
  /* 登录校验 */
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "请先登录" };

  try {
    const file = formData.get("file") as File;
    if (!file) {
      return { success: false, error: "没有上传文件" };
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const result = await mammoth.convertToHtml({ buffer });
    const html = result.value;

    const blocks = 解析HTML为Blocks(html);

    /* 提取标题 */
    let title = file.name.replace(/\.docx?$/i, "");
    const firstHeading = blocks.find((b) => b.type === "heading");
    if (firstHeading?.content && firstHeading.content.length > 0) {
      const headingText = firstHeading.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      if (headingText.trim()) {
        title = headingText.trim();
      }
    }

    return { success: true, title, blocks };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: "Word 解析失败: " + msg };
  }
}

/* ========== Word 导出 Server Action ========== */

interface ExportArticle {
  title: string;
  content: string;
  content_blocks: BlockNoteBlock[] | null;
  type: string;
  knowledge_categories: { name: string } | null;
  profiles: { full_name: string } | null;
  created_at: string;
}

export async function 生成Word文档(article: ExportArticle): Promise<{
  success: boolean;
  base64?: string;
  error?: string;
}> {
  /* 登录校验 */
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "请先登录" };

  try {
    const { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, HeadingLevel, WidthType, BorderStyle, AlignmentType } = await import("docx");

    const children: (typeof Paragraph.prototype | typeof Table.prototype)[] = [];

    children.push(
      new Paragraph({
        text: article.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 },
      })
    );

    children.push(
      new Paragraph({
        children: [new TextRun({ text: `分类：${article.knowledge_categories?.name || "未分类"}`, size: 20 })],
        spacing: { after: 100 },
      })
    );
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `作者：${article.profiles?.full_name || "系统"}`, size: 20 })],
        spacing: { after: 100 },
      })
    );
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `日期：${new Date(article.created_at).toLocaleDateString()}`, size: 20 })],
        spacing: { after: 300 },
      })
    );

    children.push(new Paragraph({ spacing: { after: 200 } }));

    const blocks = article.content_blocks || [];

    if (blocks.length > 0) {
      for (const block of blocks) {
        const el = blockToDocxElement(block, {
          Paragraph, TextRun, Table, TableCell, TableRow, HeadingLevel, WidthType, BorderStyle, AlignmentType,
        });
        if (el) children.push(el);
      }
    } else if (article.content) {
      const text = article.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const 段落们 = text.split(/\n+/).filter((p) => p.trim());
      for (const p of 段落们) {
        children.push(new Paragraph({ text: p.trim(), spacing: { after: 120 } }));
      }
    }

    const document = new Document({
      sections: [{
        properties: {},
        children,
      }],
    });

    const buffer = await Packer.toBuffer(document);
    const base64 = buffer.toString("base64");

    return { success: true, base64 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: "Word 生成失败: " + msg };
  }
}

function blockToDocxElement(
  block: BlockNoteBlock,
  libs: {
    Paragraph: typeof import("docx").Paragraph;
    TextRun: typeof import("docx").TextRun;
    Table: typeof import("docx").Table;
    TableCell: typeof import("docx").TableCell;
    TableRow: typeof import("docx").TableRow;
    HeadingLevel: typeof import("docx").HeadingLevel;
    WidthType: typeof import("docx").WidthType;
    BorderStyle: typeof import("docx").BorderStyle;
    AlignmentType: typeof import("docx").AlignmentType;
  }
): import("docx").Paragraph | import("docx").Table | null {
  const { Paragraph, TextRun, Table, TableCell, TableRow, HeadingLevel, WidthType, BorderStyle, AlignmentType } = libs;

  function 提取文本(content: InlineContent[]): string {
    return content.map((c) => {
      if (c.type === "text") return c.text;
      if (c.type === "link") return c.content.map((t) => t.text).join("");
      return "";
    }).join("");
  }

  function 创建TextRuns(content: InlineContent[]): (typeof TextRun.prototype)[] {
    const runs: (typeof TextRun.prototype)[] = [];
    for (const c of content) {
      if (c.type === "text") {
        runs.push(new TextRun({
          text: c.text,
          bold: c.styles?.bold,
          italics: c.styles?.italic,
          underline: c.styles?.underline ? { type: "single" } : undefined,
          strike: c.styles?.strikethrough,
        }));
      } else if (c.type === "link") {
        const linkText = c.content.map((t) => t.text).join("");
        runs.push(new TextRun({
          text: linkText,
          color: "0563C1",
          underline: { type: "single" },
        }));
      }
    }
    return runs;
  }

  switch (block.type) {
    case "heading": {
      const level = (block.props?.level as number) || 1;
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      return new Paragraph({
        children: block.content ? 创建TextRuns(block.content) : [],
        heading: headingMap[level] || HeadingLevel.HEADING_1,
        spacing: { after: 200 },
      });
    }

    case "paragraph": {
      return new Paragraph({
        children: block.content ? 创建TextRuns(block.content) : [],
        spacing: { after: 120 },
      });
    }

    case "bulletListItem":
    case "numberedListItem": {
      const text = block.content ? 提取文本(block.content) : "";
      const prefix = block.type === "bulletListItem" ? "• " : "1. ";
      return new Paragraph({
        children: [new TextRun({ text: prefix + text })],
        spacing: { after: 80 },
        indent: { left: 360 },
      });
    }

    case "table": {
      /* BlockNote 表格内容类型与目标结构重叠不足，先转 unknown 再断言 */
      const tableContent = block.content as unknown as { type: string; rows: { cells: unknown[][] }[] } | undefined;
      if (!tableContent?.rows?.length) return null;

      const rows: (typeof TableRow.prototype)[] = [];
      for (const row of tableContent.rows) {
        const cells: (typeof TableCell.prototype)[] = [];
        for (const cell of row.cells) {
          const cellText = (cell as unknown[])
            .map((item) => {
              if (typeof item === "object" && item !== null && "text" in item) {
                return String((item as Record<string, unknown>).text || "");
              }
              return "";
            })
            .join("");
          cells.push(new TableCell({
            children: [new Paragraph({ text: cellText })],
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
            },
          }));
        }
        if (cells.length > 0) {
          rows.push(new TableRow({ children: cells }));
        }
      }

      if (rows.length === 0) return null;
      return new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      });
    }

    case "divider": {
      return new Paragraph({
        text: "────────────────────────",
        spacing: { before: 120, after: 120 },
        alignment: AlignmentType.CENTER,
      });
    }

    case "codeBlock": {
      const codeText = block.content ? 提取文本(block.content) : "";
      return new Paragraph({
        children: [new TextRun({ text: codeText, font: "Courier New" })],
        spacing: { after: 120 },
        shading: { fill: "F5F5F5" },
      });
    }

    default: {
      if (block.type === "image") {
        return new Paragraph({
          children: [new TextRun({ text: "[图片]", italics: true, color: "888888" })],
          spacing: { after: 120 },
        });
      }
      if (block.type === "video") {
        return new Paragraph({
          children: [new TextRun({ text: "[视频]", italics: true, color: "888888" })],
          spacing: { after: 120 },
        });
      }
      if (block.type === "file") {
        return new Paragraph({
          children: [new TextRun({ text: "[文件]", italics: true, color: "888888" })],
          spacing: { after: 120 },
        });
      }
      const fallbackText = block.content ? 提取文本(block.content) : "";
      if (fallbackText) {
        return new Paragraph({
          text: fallbackText,
          spacing: { after: 120 },
        });
      }
      return null;
    }
  }
}

/* ========== VIN同步车型 Server Action ========== */

import { vin17DecodeVin } from "@/lib/17vin/client";
import { 标准化VIN } from "@/lib/vinValidator";
import type { 车型库行 } from "@/lib/vehicleModelFields";

/* ═════════════════════════════════════════════════════════════════
 * 批量生成全部文章向量
 * 查询所有没有 embedding 的文章，逐条生成并保存
 * ═════════════════════════════════════════════════════════════════ */
export async function 批量生成全部文章向量(): Promise<{
  success: boolean;
  已处理: number;
  已跳过: number;
  error?: string;
}> {
  /* 登录校验（批量计算耗资源，防被薅接口） */
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, 已处理: 0, 已跳过: 0, error: 登录错误 || "请先登录" };

  const supabase = await createClient();

  const { data: articles, error: queryError } = await supabase
    .from("knowledge_articles")
    .select("id, title, content, content_blocks")
    .is("embedding", null)
    .limit(200);

  if (queryError) {
    return { success: false, 已处理: 0, 已跳过: 0, error: queryError.message };
  }

  if (!articles || articles.length === 0) {
    return { success: true, 已处理: 0, 已跳过: 0, error: "所有文章已有向量" };
  }

  let 已处理 = 0;
  let 已跳过 = 0;

  for (const article of articles) {
    const 文章ID = String(article.id);
    const 标题 = String(article.title || "");
    const 内容 = String(article.content || "");

    try {
      const 嵌入文本 = 生成嵌入文本(标题, 内容, article.content_blocks);
      if (!嵌入文本) { 已跳过++; continue; }

      const 向量 = await 文档转向量(嵌入文本);
      if (!向量 || 向量.length === 0) { 已跳过++; continue; }

      const { error: updateError } = await supabase
        .from("knowledge_articles")
        .update({ embedding: 向量 })
        .eq("id", 文章ID);

      if (updateError) {
        console.warn(`[knowledge] 批量向量化失败 [${文章ID.slice(0, 8)}]:`, updateError.message);
        已跳过++;
      } else {
        已处理++;
        console.log(`[knowledge] 批量向量化 [${已处理}/${articles.length}]: ${标题.slice(0, 30)}`);
      }
    } catch (err: unknown) {
      已跳过++;
    }
  }

  return { success: true, 已处理, 已跳过 };
}

/**
 * 知识库通过VIN同步车型
 * VIN解码后匹配本地车型库，未匹配到则自动创建
 */
/* 为文章生成并保存语义向量（文章保存后异步调用，不阻塞保存） */
export async function 生成文章向量(文章ID: string, 标题: string, 内容: string, 内容块?: unknown): Promise<void> {
  /* 登录校验（调用方是保存文章后的异步任务，未登录静默跳过） */
  const { user } = await 验证用户已登录();
  if (!user) return;

  try {
    const supabase = await createClient();
    const 嵌入文本 = 生成嵌入文本(标题, 内容, 内容块);
    console.log(`[knowledge] 生成文章向量: id=${文章ID}, 文本长度=${嵌入文本.length}, 前50字="${嵌入文本.slice(0, 50)}"`);
    if (!嵌入文本) {
      console.warn("[knowledge] 向量生成跳过: 嵌入文本为空");
      return;
    }

    /* 用文档嵌入（"passage:" 前缀），与搜索时的 "query:" 前缀区分 */
    const 向量 = await 文档转向量(嵌入文本);
    if (!向量 || 向量.length === 0) {
      console.warn("[knowledge] 向量生成跳过: 返回空向量");
      return;
    }

    console.log(`[knowledge] 向量已生成: 维度=${向量.length}, 前3值=[${向量.slice(0, 3).map(v => v.toFixed(4)).join(", ")}]`);
    const { error: updateError } = await supabase
      .from("knowledge_articles")
      .update({ embedding: 向量 })
      .eq("id", 文章ID);
    if (updateError) {
      console.error("[knowledge] 向量写入失败:", updateError.message);
    } else {
      console.log(`[knowledge] 向量写入成功: id=${文章ID}`);
    }
  } catch (err: unknown) {
    /* 向量生成失败不影响文章正常使用，仅语义搜索不可用 */
    console.warn("[knowledge] 向量生成失败:", err instanceof Error ? err.message : String(err));
  }
}

export async function syncKnowledgeModelsFromVin(rawVin: string): Promise<{
  success: boolean;
  matchedModels?: 车型库行[];
  error?: string;
}> {
  /* 登录校验 */
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "请先登录" };

  const supabase = await createClient();
  const vin = 标准化VIN(rawVin);

  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return { success: false, error: "VIN码必须为17位" };
  }

  /* VIN解码获取车型信息 */
  interface VinDecodeModel {
    Brand?: string;
    Series?: string;
    Model?: string;
    Engine_no?: string;
    Date_begin?: string;
    Date_end?: string;
    Model_year?: string;
  }

  let vinDecodeModel: VinDecodeModel | null = null;

  try {
    const decodeRes = (await vin17DecodeVin(vin)) as {
      code: number;
      data?: {
        model_list?: Array<VinDecodeModel>;
      };
    };
    if (decodeRes.code === 1 && decodeRes.data?.model_list?.[0]) {
      vinDecodeModel = decodeRes.data.model_list[0];
    }
  } catch (err: unknown) {
    return { success: false, error: "VIN解码出错: " + (err instanceof Error ? err.message : String(err)) };
  }

  if (!vinDecodeModel) {
    return { success: false, error: "VIN解码失败，未找到车型信息" };
  }

  /* 匹配本地车型库：只查匹配品牌的记录，避免全表扫描（9.6 万条 → 几百条） */
  const vmBrand = (vinDecodeModel.Brand || "").toLowerCase().trim();
  const { data: localModels } = (await supabase
    .from("vehicle_models")
    .select("id, 厂商, 品牌, 车系, 车型, 销售版本, 年款, 排量, 发动机型号, 燃油类型, 进气形式, 变速箱类型, 变速箱代号, 底盘代号, 驱动方式, 车身类型, 排放标准")
    .ilike("品牌", `%${vmBrand}%`)) as unknown as { data: 车型库行[] | null };

  const vmSeries = (vinDecodeModel.Series || "").toLowerCase().trim();
  const vmModel = (vinDecodeModel.Model || "").toLowerCase().trim();
  const vmEngine = (vinDecodeModel.Engine_no || "").toLowerCase().trim();
  const yearStr = vinDecodeModel.Model_year || vinDecodeModel.Date_begin || "";
  const vmYear = yearStr ? parseInt(String(yearStr).slice(0, 4)) : null;

  const matchedModels: 车型库行[] = [];

  for (const local of localModels || []) {
    const localBrand = (local.品牌 || "").toLowerCase().trim();
    const localSeries = (local.车系 || "").toLowerCase().trim();
    const localModel = (local.车型 || "").toLowerCase().trim();
    const localYear = local.年款;
    const localEngine = (local.发动机型号 || "").toLowerCase().trim();

    if (!vmBrand || !localBrand) continue;
    const brandMatch = localBrand.includes(vmBrand) || vmBrand.includes(localBrand);
    if (!brandMatch) continue;

    if (vmEngine && localEngine) {
      const engineMatch = localEngine.includes(vmEngine) || vmEngine.includes(localEngine);
      if (!engineMatch) continue;
    } else if (vmSeries && localSeries) {
      const seriesMatch = localSeries.includes(vmSeries) || vmSeries.includes(localSeries);
      if (!seriesMatch) continue;
    } else if (vmModel && localModel) {
      const modelMatch = localModel.includes(vmModel) || vmModel.includes(localModel);
      if (!modelMatch) continue;
    }

    if (vmYear && localYear) {
      if (vmYear < localYear - 1 || vmYear > localYear + 1) continue;
    }

    matchedModels.push(local);
  }

  /* 没有匹配到，自动创建一条车型记录 */
  if (matchedModels.length === 0 && vmBrand) {
    const { data: newModel } = await supabase
      .from("vehicle_models")
      .insert({
        品牌: vinDecodeModel.Brand || "",
        车系: vinDecodeModel.Series || "",
        车型: vinDecodeModel.Model || "",
        年款: vmYear || null,
        发动机型号: vinDecodeModel.Engine_no || "",
      })
      .select("id, 厂商, 品牌, 车系, 车型, 销售版本, 年款, 排量, 发动机型号, 燃油类型, 进气形式, 变速箱类型, 变速箱代号, 底盘代号, 驱动方式, 车身类型, 排放标准")
      .single();
    if (newModel) {
      matchedModels.push(newModel as unknown as 车型库行);
    }
  }

  return {
    success: true,
    matchedModels,
  };
}

/* ========== 知识库阅读记录延迟加载 Server Action ========== */

interface 阅读记录 {
  user_id: string;
  read_date: string;
  created_at: string;
  full_name: string;
}

export async function loadKnowledgeArticleReads(articleId: string): Promise<{
  success: boolean;
  reads?: 阅读记录[];
  error?: string;
}> {
  try {
    const supabase = await createClient();

    const { data: readsRaw, error } = await supabase
      .from("knowledge_article_reads")
      .select("user_id, read_date, read_at")
      .eq("article_id", articleId)
      .order("read_at", { ascending: false })
      .limit(50);

    if (error) {
      return { success: false, error: error.message };
    }

    if (!readsRaw || readsRaw.length === 0) {
      return { success: true, reads: [] };
    }

    const userIds = [...new Set(readsRaw.map((r) => r.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    const profileMap = new Map((profiles || []).map((p) => [p.id, p.full_name]));
    const reads = readsRaw.map((r) => ({
      user_id: r.user_id,
      read_date: r.read_date,
      created_at: r.read_at,
      full_name: profileMap.get(r.user_id) || "未知用户",
    }));

    return { success: true, reads };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: "加载阅读记录失败: " + msg };
  }
}

/* ═════════════════════════════════════════════════════════════════
 * 分词词典管理 Server Action（绕过 RLS）
 * ═════════════════════════════════════════════════════════════════ */

/* 分词增删仅管理员可操作；返回 null 表示通过，否则返回错误对象 */
async function 验证分词管理员(): Promise<{ success: boolean; error?: string } | null> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录" };
  const supabase = await createClient();
  const { data: 角色行 } = await supabase
    .from("profile_roles")
    .select("roles(name)")
    .eq("profile_id", user.id);
  const 是管理员 = ((角色行 || []) as unknown as { roles?: { name?: string } | null }[]).some(
    (d) => d.roles?.name === "admin"
  );
  if (!是管理员) return { success: false, error: "仅管理员可管理分词" };
  return null;
}

/** 加载自定义分词列表（Server Action，用 admin 客户端绕过 RLS） */
export async function 加载分词列表(): Promise<{ success: boolean; data?: string[]; error?: string }> {
  try {
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("search_dictionary")
      .select("word")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[加载分词列表] 数据库错误:", error.message);
      return { success: false, error: error.message };
    }
    const words = (data || []).map((row: { word: unknown }) => String(row.word));
    return { success: true, data: words };
  } catch (err: unknown) {
    console.error("[加载分词列表] 异常:", err instanceof Error ? err.message : String(err));
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function 添加分词(词: string): Promise<{ success: boolean; error?: string }> {
  try {
    const 校验 = await 验证分词管理员();
    if (校验) return 校验;
    const supabase = createAdminClient();
    const { error } = await supabase.from("search_dictionary").insert({ word: 词, created_by: null });
    if (error) {
      console.error("[添加分词] 数据库错误:", error.message, "| code:", error.code, "| details:", error.details);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    console.error("[添加分词] 异常:", err instanceof Error ? err.message : String(err));
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function 删除分词(词: string): Promise<{ success: boolean; error?: string }> {
  try {
    const 校验 = await 验证分词管理员();
    if (校验) return 校验;
    const supabase = createAdminClient();
    const { error } = await supabase.from("search_dictionary").delete().eq("word", 词);
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
