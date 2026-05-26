"use client";

/* 基于 BlockNote heading 块生成目录大纲 */

interface BlockProps {
  level?: number;
}

interface InlineContent {
  type: "text" | "link";
  text?: string;
  content?: InlineContent[];
}

interface BlockItem {
  id: string;
  type: string;
  props: BlockProps;
  content?: InlineContent[];
}

interface HeadingItem {
  id: string;
  level: number;
  text: string;
}

interface Props {
  blocks: BlockItem[];
}

function extractText(content: InlineContent[]): string {
  return content
    .map((item) => {
      if (item.type === "link" && item.content) {
        return extractText(item.content);
      }
      return item.text || "";
    })
    .join("");
}

function extractHeadings(blocks: BlockItem[]): HeadingItem[] {
  const headings: HeadingItem[] = [];

  for (const block of blocks) {
    if (block.type === "heading") {
      const level = (block.props || {}).level || 1;
      const text = block.content ? extractText(block.content) : "";
      headings.push({ id: `heading-${block.id}`, level, text });
    }
    if (block.children && block.children.length > 0) {
      headings.push(...extractHeadings(block.children));
    }
  }

  return headings;
}

export function BlockNoteTOC({ blocks }: Props) {
  const headings = extractHeadings(blocks);

  if (headings.length === 0) {
    return null;
  }

  function handleClick(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <nav className="space-y-1">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">目录</h4>
      {headings.map((h) => {
        const indentClass =
          h.level === 1
            ? ""
            : h.level === 2
            ? "pl-3"
            : "pl-6";
        const sizeClass =
          h.level === 1
            ? "text-sm font-medium"
            : "text-xs";
        return (
          <button
            key={h.id}
            onClick={() => handleClick(h.id)}
            className={`block w-full text-left ${indentClass} ${sizeClass} text-gray-600 hover:text-blue-600 hover:bg-gray-50 rounded px-2 py-1 transition-colors truncate`}
            title={h.text}
          >
            {h.text}
          </button>
        );
      })}
    </nav>
  );
}
