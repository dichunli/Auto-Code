"use server";

import mammoth from "mammoth";

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

  /* 匹配列表项 */
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
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
