"use client";

import { useState, useCallback, useEffect, useRef } from "react";

/* BlockNote 块级 JSON 只读渲染组件 */

interface InlineContent {
  type: "text" | "link";
  text?: string;
  href?: string;
  content?: InlineContent[];
  styles?: Record<string, boolean | string>;
}

interface BlockProps {
  textAlignment?: string;
  backgroundColor?: string;
  textColor?: string;
  level?: number;
  url?: string;
  caption?: string;
  language?: string;
  checked?: boolean;
  name?: string;
}

interface TableContent {
  type: "tableContent";
  rows: {
    cells: InlineContent[][][];
  }[];
}

interface BlockItem {
  id: string;
  type: string;
  props: BlockProps;
  content?: InlineContent[] | TableContent;
  children?: BlockItem[];
}

interface Props {
  blocks: BlockItem[];
}

function renderInlineContent(content: InlineContent[]): React.ReactNode {
  return content.map((item, i) => {
    if (item.type === "link") {
      return (
        <a
          key={i}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {item.content ? renderInlineContent(item.content) : item.text}
        </a>
      );
    }

    const text = item.text || "";
    const styles = item.styles || {};

    if (styles.code) {
      return (
        <code key={i} className="px-1 py-0.5 bg-gray-100 rounded text-sm font-mono">
          {text}
        </code>
      );
    }

    let el: React.ReactNode = text;

    if (styles.bold) {
      el = <strong>{el}</strong>;
    }
    if (styles.italic) {
      el = <em>{el}</em>;
    }
    if (styles.underline) {
      el = <u>{el}</u>;
    }
    if (styles.strike) {
      el = <del>{el}</del>;
    }

    const color = styles.textColor as string | undefined;
    const bgColor = styles.backgroundColor as string | undefined;
    if (color || bgColor) {
      const style: React.CSSProperties = {};
      if (color && color !== "default") style.color = color;
      if (bgColor && bgColor !== "default") style.backgroundColor = bgColor;
      el = <span style={style}>{el}</span>;
    }

    return <span key={i}>{el}</span>;
  });
}

function renderBlock(block: BlockItem, onImageClick?: (url: string) => void): React.ReactNode {
  const { type, content, children } = block;
  const props = block.props || {};
  const alignment = props.textAlignment || "left";
  const alignClass =
    alignment === "center"
      ? "text-center"
      : alignment === "right"
      ? "text-right"
      : alignment === "justify"
      ? "text-justify"
      : "text-left";

  const bgColor = props.backgroundColor && props.backgroundColor !== "default"
    ? props.backgroundColor
    : undefined;
  const style: React.CSSProperties = bgColor ? { backgroundColor: bgColor } : {};

  const inlineContent = Array.isArray(content)
    ? renderInlineContent(content)
    : null;

  switch (type) {
    case "heading": {
      const level = props.level || 1;
      const id = `heading-${block.id}`;
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      const sizeClass =
        level === 1
          ? "text-2xl font-bold mt-6 mb-4"
          : level === 2
          ? "text-xl font-bold mt-5 mb-3"
          : "text-lg font-semibold mt-4 mb-2";
      return (
        <Tag key={block.id} id={id} className={`${sizeClass} ${alignClass}`} style={style}>
          {inlineContent}
        </Tag>
      );
    }

    case "paragraph":
      return (
        <p key={block.id} className={`my-3 leading-relaxed ${alignClass}`} style={style}>
          {inlineContent}
        </p>
      );

    case "bulletListItem":
      return (
        <li key={block.id} className={`ml-6 list-disc my-1 ${alignClass}`} style={style}>
          {inlineContent}
          {children && children.length > 0 && (
            <ul className="my-1">{children.map((c, i) => renderBlock(c, i))}</ul>
          )}
        </li>
      );

    case "numberedListItem":
      return (
        <li key={block.id} className={`ml-6 list-decimal my-1 ${alignClass}`} style={style}>
          {inlineContent}
          {children && children.length > 0 && (
            <ol className="my-1">{children.map((c, i) => renderBlock(c, i))}</ol>
          )}
        </li>
      );

    case "checkListItem":
      return (
        <li
          key={block.id}
          className={`ml-6 my-1 flex items-start gap-2 ${alignClass}`}
          style={style}
        >
          <input
            type="checkbox"
            checked={props.checked || false}
            readOnly
            className="mt-1 w-4 h-4 flex-shrink-0"
          />
          <span className={props.checked ? "line-through text-gray-400" : ""}>
            {inlineContent}
          </span>
          {children && children.length > 0 && (
            <ul className="my-1 w-full">{children.map((c, i) => renderBlock(c, i))}</ul>
          )}
        </li>
      );

    case "quote":
      return (
        <blockquote
          key={block.id}
          className="border-l-4 border-gray-300 pl-4 my-4 italic text-gray-600"
          style={style}
        >
          {inlineContent}
        </blockquote>
      );

    case "codeBlock": {
      const codeText = Array.isArray(content)
        ? content.map((c) => c.text || "").join("")
        : "";
      return (
        <pre
          key={block.id}
          className="bg-gray-900 text-gray-100 rounded-lg p-4 my-4 overflow-x-auto text-sm font-mono"
        >
          {props.language && (
            <div className="text-xs text-gray-400 mb-2 border-b border-gray-700 pb-1">
              {props.language}
            </div>
          )}
          <code>{codeText}</code>
        </pre>
      );
    }

    case "table": {
      const tableContent = content as TableContent | undefined;
      if (!tableContent || tableContent.type !== "tableContent") {
        return null;
      }
      /* 判断是否为"布局表格"（只有一行，用于左右分栏） */
      const isLayout = tableContent.rows.length === 1;
      return (
        <div key={block.id} className="overflow-x-auto my-4">
          <table className={`w-full text-sm ${isLayout ? "" : "border-collapse border border-gray-300"}`}>
            <tbody>
              {tableContent.rows.map((row, rowIdx) => (
                <tr key={rowIdx} className={isLayout ? "" : rowIdx === 0 ? "bg-gray-50" : ""}>
                  {row.cells.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className={isLayout
                        ? "px-3 py-2 align-top"
                        : "border border-gray-300 px-3 py-2 min-w-[80px]"
                      }
                    >
                      {Array.isArray(cell) ? cell.map((inline, inlineIdx) => (
                        <span key={inlineIdx}>
                          {renderInlineContent(Array.isArray(inline) ? inline : [inline])}
                        </span>
                      )) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "image": {
      const imageUrl = props.url || "";
      if (!imageUrl) {
        return (
          <figure key={block.id} className={`my-4 ${alignClass}`}>
            <div className="bg-gray-100 rounded-lg p-8 text-center text-gray-400 text-sm">
              图片地址缺失
            </div>
            {props.caption && (
              <figcaption className="text-center text-sm text-gray-500 mt-2">
                {props.caption}
              </figcaption>
            )}
          </figure>
        );
      }
      return (
        <figure key={block.id} className={`my-4 ${alignClass}`}>
          <ImageWithFallback
            src={imageUrl}
            alt={props.caption || ""}
            onClick={() => onImageClick?.(imageUrl)}
          />
          {props.caption && (
            <figcaption className="text-center text-sm text-gray-500 mt-2">
              {props.caption}
            </figcaption>
          )}
        </figure>
      );
    }

    case "video":
      return (
        <figure key={block.id} className={`my-4 ${alignClass}`}>
          <video
            src={props.url}
            controls
            className="max-w-full rounded-lg"
            preload="metadata"
          />
          {props.caption && (
            <figcaption className="text-center text-sm text-gray-500 mt-2">
              {props.caption}
            </figcaption>
          )}
        </figure>
      );

    case "divider":
      return <hr key={block.id} className="my-6 border-t border-gray-200" />;

    case "file":
      return (
        <a
          key={block.id}
          href={props.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 my-3 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-blue-600 hover:bg-gray-100"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {props.name || "下载文件"}
        </a>
      );

    case "audio":
      return (
        <div key={block.id} className="my-4">
          <audio src={props.url} controls className="w-full" />
          {props.caption && (
            <p className="text-center text-sm text-gray-500 mt-1">{props.caption}</p>
          )}
        </div>
      );

    default:
      return (
        <p key={block.id} className="my-3 text-gray-400">
          [不支持的块类型: {type}]
        </p>
      );
  }
}

function wrapListBlocks(blocks: BlockItem[], onImageClick?: (url: string) => void): React.ReactNode {
  const result: React.ReactNode[] = [];
  let currentBulletList: BlockItem[] = [];
  let currentNumberedList: BlockItem[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.type === "bulletListItem") {
      currentNumberedList = [];
      currentBulletList.push(block);
    } else if (block.type === "numberedListItem") {
      currentBulletList = [];
      currentNumberedList.push(block);
    } else {
      if (currentBulletList.length > 0) {
        result.push(
          <ul key={`ul-${i}`} className="my-2">
            {currentBulletList.map((b) => renderBlock(b, onImageClick))}
          </ul>
        );
        currentBulletList = [];
      }
      if (currentNumberedList.length > 0) {
        result.push(
          <ol key={`ol-${i}`} className="my-2">
            {currentNumberedList.map((b) => renderBlock(b, onImageClick))}
          </ol>
        );
        currentNumberedList = [];
      }
      result.push(renderBlock(block, onImageClick));
    }
  }

  if (currentBulletList.length > 0) {
    result.push(
      <ul key="ul-end" className="my-2">
        {currentBulletList.map((b) => renderBlock(b, onImageClick))}
      </ul>
    );
  }
  if (currentNumberedList.length > 0) {
    result.push(
      <ol key="ol-end" className="my-2">
        {currentNumberedList.map((b) => renderBlock(b, onImageClick))}
      </ol>
    );
  }

  return result;
}

/* 带错误处理的图片组件 */
function ImageWithFallback({
  src,
  alt,
  onClick,
}: {
  src: string;
  alt: string;
  onClick?: () => void;
}) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="bg-gray-100 rounded-lg p-6 text-center max-w-md mx-auto">
        <svg className="w-10 h-10 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sm text-gray-500 mb-1">图片加载失败</p>
        <p className="text-xs text-gray-400 break-all">{src}</p>
      </div>
    );
  }

  return (
    <div className="inline-block relative" onClick={onClick}>
      <img
        src={src}
        alt={alt}
        className="max-w-full rounded-lg cursor-zoom-in"
        onError={() => setError(true)}
      />
      {/* 移动端触摸提示 */}
      <div className="absolute bottom-2 right-2 bg-black/40 text-white rounded-full p-1.5 sm:hidden pointer-events-none">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
        </svg>
      </div>
    </div>
  );
}

/* 图片预览弹窗 */
function ImagePreview({ url, caption, onClose }: { url: string; caption?: string; onClose: () => void }) {
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  /* 触摸滑动关闭 */
  function handleTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    /* 向上/向下滑动超过 80px 关闭 */
    if (Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 关闭按钮 — 移动端加大点击区域 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 sm:top-4 sm:right-4 text-white/80 hover:text-white p-3 sm:p-2 rounded-lg hover:bg-white/10 transition-colors z-10"
        title="关闭"
      >
        <svg className="w-7 h-7 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <img
        src={url}
        alt={caption || ""}
        className="max-w-[95vw] sm:max-w-[90vw] max-h-[80vh] sm:max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {/* 移动端操作提示 */}
      <div className="absolute bottom-6 left-0 right-0 text-center text-white/50 text-xs sm:hidden">
        <p>上下滑动或点击空白处关闭</p>
      </div>

      {caption && (
        <div className="absolute bottom-12 sm:bottom-6 left-0 right-0 text-center text-white/70 text-sm px-4">
          {caption}
        </div>
      )}
    </div>
  );
}

export function BlockNoteRenderer({ blocks }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewCaption, setPreviewCaption] = useState<string>("");

  const handleImageClick = useCallback((url: string) => {
    setPreviewUrl(url);
    setPreviewCaption("");
  }, []);

  const handleClose = useCallback(() => {
    setPreviewUrl(null);
  }, []);

  if (!blocks || blocks.length === 0) {
    return <p className="text-gray-400">暂无内容</p>;
  }

  return (
    <>
      <div className="blocknote-content">{wrapListBlocks(blocks, handleImageClick)}</div>
      {previewUrl && <ImagePreview url={previewUrl} caption={previewCaption} onClose={handleClose} />}
    </>
  );
}
