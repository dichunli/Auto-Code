"use server";

import mammoth from "mammoth";
import { createClient } from "@/lib/supabase/server";
import { 中文分词 } from "@/lib/chineseSegmenter";

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
}): Promise<{
  success: boolean;
  articles?: 知识文章数据[];
  categories?: 知识分类数据[];
  readCounts?: Record<string, number>;
  currentUserId?: string;
  isAdmin?: boolean;
  total?: number;
  totalPages?: number;
  segments?: string[];
  error?: string;
}> {
  const { keyword = "", category = "", page = 1, createdBy = "" } = params;
  const pageSize = 20;

  const supabase = await createClient();

  /* 读取管理员自定义分词 */
  const { data: customWordsData } = await supabase
    .from("search_dictionary")
    .select("word")
    .order("created_at", { ascending: false });
  const customWords = (customWordsData || []).map((row) => String(row.word));
  const searchKeywords = keyword.trim() ? 中文分词(keyword.trim(), customWords) : [];

  /* 获取当前用户 */
  const { data: { user } } = await supabase.auth.getUser();
  const currentUserId = user?.id || "";
  let isAdmin = false;
  if (currentUserId) {
    const { data: roleData } = await supabase
      .from("profile_roles")
      .select("roles(name)")
      .eq("profile_id", currentUserId);
    isAdmin = (roleData || []).some(
      (d: { roles?: { name?: string } | null }) => d.roles?.name === "admin"
    );
  }

  /* 查询文章 */
  let articles: 知识文章数据[] = [];

  if (searchKeywords.length > 0) {
    const { data, error } = await supabase.rpc("search_knowledge_articles", {
      search_keywords: searchKeywords,
    });
    if (error) {
      return { success: false, error: error.message, segments: searchKeywords };
    }
    articles = (data || [])
      .map((row: Record<string, unknown>) => ({
        id: row.id as string,
        title: row.title as string,
        content: row.content as string,
        content_blocks: row.content_blocks,
        type: row.type as string,
        created_at: row.created_at as string,
        category_id: row.category_id as string | null,
        created_by: row.created_by as string | null,
        visibility: row.visibility as string,
        category_name: row.category_name as string | null,
        author_name: row.author_name as string | null,
        score: row.score as number,
      }))
      .filter((a) => !createdBy || a.created_by === createdBy);
  } else {
    let query = supabase
      .from("knowledge_articles")
      .select("*, knowledge_categories(name), profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (category) {
      query = query.eq("category_id", category);
    }

    if (createdBy) {
      query = query.eq("created_by", createdBy);
    }

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

  /* 查询分类 */
  const { data: categoriesData } = await supabase
    .from("knowledge_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .limit(100);

  /* 查询阅读次数 */
  const articleIds = articles.map((a) => a.id);
  const readCounts: Record<string, number> = {};
  if (articleIds.length > 0) {
    const { data: readsData } = await supabase
      .from("knowledge_article_reads")
      .select("article_id")
      .in("article_id", articleIds);

    if (readsData) {
      for (const r of readsData) {
        const aid = r.article_id as string;
        readCounts[aid] = (readCounts[aid] || 0) + 1;
      }
    }
  }

  /* 分页 */
  const total = articles.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fromIdx = (page - 1) * pageSize;
  const paginatedArticles = articles.slice(fromIdx, fromIdx + pageSize);

  return {
    success: true,
    articles: paginatedArticles,
    categories: (categoriesData || []) as 知识分类数据[],
    readCounts,
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
      const tableContent = block.content as { type: string; rows: { cells: unknown[][] }[] } | undefined;
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

/**
 * 知识库通过VIN同步车型
 * VIN解码后匹配本地车型库，未匹配到则自动创建
 */
export async function syncKnowledgeModelsFromVin(rawVin: string): Promise<{
  success: boolean;
  matchedModels?: Array<{
    id: number;
    厂商: string | null;
    品牌: string | null;
    车系: string | null;
    车型: string | null;
    销售版本: string | null;
    年款: number | null;
    排量: string | null;
    发动机型号: string | null;
    燃油类型: string | null;
    进气形式: string | null;
    变速箱类型: string | null;
    变速箱代号: string | null;
    底盘代号: string | null;
    驱动方式: string | null;
    车身类型: string | null;
    排放标准: string | null;
  }>;
  error?: string;
}> {
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

  /* 匹配本地车型库 */
  const { data: localModels } = await supabase
    .from("vehicle_models")
    .select("id, 厂商, 品牌, 车系, 车型, 销售版本, 年款, 排量, 发动机型号, 燃油类型, 进气形式, 变速箱类型, 变速箱代号, 底盘代号, 驱动方式, 车身类型, 排放标准");

  const vmBrand = (vinDecodeModel.Brand || "").toLowerCase().trim();
  const vmSeries = (vinDecodeModel.Series || "").toLowerCase().trim();
  const vmModel = (vinDecodeModel.Model || "").toLowerCase().trim();
  const vmEngine = (vinDecodeModel.Engine_no || "").toLowerCase().trim();
  const yearStr = vinDecodeModel.Model_year || vinDecodeModel.Date_begin || "";
  const vmYear = yearStr ? parseInt(String(yearStr).slice(0, 4)) : null;

  const matchedModels: Array<{
    id: number;
    厂商: string | null;
    品牌: string | null;
    车系: string | null;
    车型: string | null;
    销售版本: string | null;
    年款: number | null;
    排量: string | null;
    发动机型号: string | null;
    燃油类型: string | null;
    进气形式: string | null;
    变速箱类型: string | null;
    变速箱代号: string | null;
    底盘代号: string | null;
    驱动方式: string | null;
    车身类型: string | null;
    排放标准: string | null;
  }> = [];

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
      matchedModels.push(newModel);
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
