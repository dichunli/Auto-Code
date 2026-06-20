"use client";

import { useState, useCallback, useEffect, useRef, type JSX } from "react";
import { createPortal } from "react-dom";
import { 是抖音链接, 抖音视频卡片 } from "./DouyinVideo";

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
  pdfUrl?: string;
  allowedGroups?: string | string[];
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
  userGroupId?: string;
  isAdmin?: boolean;
}

/* 根据 allowedGroups 过滤块：无权限的块及子块均隐藏 */
function 过滤权限块(blocks: BlockItem[], userGroupId?: string, isAdmin?: boolean): BlockItem[] {
  if (isAdmin) return blocks;

  return blocks
    .filter((block) => {
      const rawAllowed = block.props?.allowedGroups;
      if (!rawAllowed || (Array.isArray(rawAllowed) && rawAllowed.length === 0) || (typeof rawAllowed === "string" && rawAllowed === "")) {
        return true;
      }
      if (!userGroupId) return false;
      const allowedList = Array.isArray(rawAllowed)
        ? rawAllowed
        : String(rawAllowed).split(",").filter(Boolean);
      return allowedList.includes(userGroupId);
    })
    .map((block) => ({
      ...block,
      children: block.children
        ? 过滤权限块(block.children, userGroupId, isAdmin)
        : undefined,
    }));
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

function renderBlock(block: BlockItem, onImageClick?: (url: string, caption: string) => void, onPdfPreview?: (url: string) => void): React.ReactNode {
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
            <ul className="my-1">{children.map((c) => renderBlock(c, onImageClick, onPdfPreview))}</ul>
          )}
        </li>
      );

    case "numberedListItem":
      return (
        <li key={block.id} className={`ml-6 list-decimal my-1 ${alignClass}`} style={style}>
          {inlineContent}
          {children && children.length > 0 && (
            <ol className="my-1">{children.map((c) => renderBlock(c, onImageClick, onPdfPreview))}</ol>
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
            <ul className="my-1 w-full">{children.map((c) => renderBlock(c, onImageClick, onPdfPreview))}</ul>
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
            onClick={() => onImageClick?.(imageUrl, props.caption || "")}
          />
          {props.caption && (
            <figcaption className="text-center text-sm text-gray-500 mt-2">
              {props.caption}
            </figcaption>
          )}
        </figure>
      );
    }

    case "video": {
      const videoUrl = props.url || "";
      /* 抖音链接用卡片渲染 */
      if (videoUrl && 是抖音链接(videoUrl)) {
        return (
          <div key={block.id} className={alignClass}>
            <抖音视频卡片 url={videoUrl} caption={props.caption || ""} />
          </div>
        );
      }
      return (
        <figure key={block.id} className={`my-4 ${alignClass}`}>
          <VideoPlayer src={videoUrl} caption={props.caption || ""} />
          {props.caption && (
            <figcaption className="text-center text-sm text-gray-500 mt-2">
              {props.caption}
            </figcaption>
          )}
        </figure>
      );
    }

    case "divider":
      return <hr key={block.id} className="my-6 border-t border-gray-200" />;

    case "file": {
      const fileUrl = props.url || "";
      const fileName = props.name || "文件";
      const pdfUrl = props.pdfUrl || "";
      const isOffice = pdfUrl || /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(fileUrl);
      return (
        <div key={block.id} className="my-3 inline-flex items-center gap-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
          <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-gray-700 truncate max-w-[200px] sm:max-w-xs">{fileName}</span>
          {pdfUrl ? (
            <button
              type="button"
              onClick={() => onPdfPreview?.(pdfUrl)}
              className="ml-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 text-xs flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              预览
            </button>
          ) : isOffice ? (
            <span className="ml-1 text-xs text-gray-400">(未生成预览)</span>
          ) : null}
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="ml-1 text-gray-400 hover:text-blue-600"
            title="下载"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        </div>
      );
    }

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

function wrapListBlocks(blocks: BlockItem[], onImageClick?: (url: string, caption: string) => void, onPdfPreview?: (url: string) => void): React.ReactNode {
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
            {currentBulletList.map((b) => renderBlock(b, onImageClick, onPdfPreview))}
          </ul>
        );
        currentBulletList = [];
      }
      if (currentNumberedList.length > 0) {
        result.push(
          <ol key={`ol-${i}`} className="my-2">
            {currentNumberedList.map((b) => renderBlock(b, onImageClick, onPdfPreview))}
          </ol>
        );
        currentNumberedList = [];
      }
      result.push(renderBlock(block, onImageClick, onPdfPreview));
    }
  }

  if (currentBulletList.length > 0) {
    result.push(
      <ul key="ul-end" className="my-2">
        {currentBulletList.map((b) => renderBlock(b, onImageClick, onPdfPreview))}
      </ul>
    );
  }
  if (currentNumberedList.length > 0) {
    result.push(
      <ol key="ol-end" className="my-2">
        {currentNumberedList.map((b) => renderBlock(b, onImageClick, onPdfPreview))}
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

interface 拖拽起点 {
  x: number;
  y: number;
  px: number;
  py: number;
}

interface 双指缩放起点 {
  distance: number;
  scale: number;
  centerX: number;
  centerY: number;
  positionX: number;
  positionY: number;
}

/* 图片预览弹窗：支持缩放、拖拽平移、滚轮缩放、双击放大 */
function ImagePreview({ url, caption, onClose }: { url: string; caption?: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<拖拽起点>({ x: 0, y: 0, px: 0, py: 0 });
  const pinchStartRef = useRef<双指缩放起点 | null>(null);
  const touchStartYRef = useRef(0);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") handleZoomIn();
      if (e.key === "-") handleZoomOut();
      if (e.key === "0") handleReset();
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose, scale, position]);

  function getImageCenter(): { x: number; y: number } | null {
    if (!imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function zoomTo(newScale: number, centerX: number, centerY: number) {
    const clamped = Math.min(Math.max(newScale, 0.5), 5);
    if (clamped === scale) return;
    const center = getImageCenter();
    if (!center) {
      setScale(clamped);
      return;
    }
    const ratio = clamped / scale;
    const newX = position.x - (centerX - center.x) * (ratio - 1);
    const newY = position.y - (centerY - center.y) * (ratio - 1);
    setScale(clamped);
    setPosition({ x: newX, y: newY });
  }

  function handleZoomIn() {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    zoomTo(scale * 1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function handleZoomOut() {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    zoomTo(scale * 0.8, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function handleReset() {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomTo(scale * delta, e.clientX, e.clientY);
  }

  function handleDoubleClick() {
    if (scale > 1.2) {
      handleReset();
    } else if (imgRef.current) {
      const rect = imgRef.current.getBoundingClientRect();
      zoomTo(2.5, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, px: position.x, py: position.y };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPosition({ x: dragStartRef.current.px + dx, y: dragStartRef.current.py + dy });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      touchStartYRef.current = e.touches[0].clientY;
      setIsDragging(true);
      pinchStartRef.current = null;
      dragStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        px: position.x,
        py: position.y,
      };
    } else if (e.touches.length === 2) {
      setIsDragging(false);
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const center = getImageCenter();
      pinchStartRef.current = {
        distance,
        scale,
        centerX: center?.x ?? 0,
        centerY: center?.y ?? 0,
        positionX: position.x,
        positionY: position.y,
      };
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - dragStartRef.current.x;
      const dy = e.touches[0].clientY - dragStartRef.current.y;
      setPosition({ x: dragStartRef.current.px + dx, y: dragStartRef.current.py + dy });
    } else if (e.touches.length === 2 && pinchStartRef.current) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const info = pinchStartRef.current;
      const newScale = Math.min(Math.max(info.scale * (distance / info.distance), 0.5), 5);
      const ratio = newScale / info.scale;
      const centerX = (t1.clientX + t2.clientX) / 2;
      const centerY = (t1.clientY + t2.clientY) / 2;
      const newX = info.positionX - (centerX - info.centerX) * (ratio - 1);
      const newY = info.positionY - (centerY - info.centerY) * (ratio - 1);
      setScale(newScale);
      setPosition({ x: newX, y: newY });
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length === 0) {
      setIsDragging(false);
      pinchStartRef.current = null;
      /* 单指滑动关闭：仅在未缩放状态下生效，避免误操作 */
      if (scale <= 1) {
        const dy = e.changedTouches[0].clientY - touchStartYRef.current;
        if (Math.abs(dy) > 80) {
          onClose();
        }
      }
    } else if (e.touches.length === 1) {
      /* 双指缩放后松开一指，切换为单指拖拽 */
      pinchStartRef.current = null;
      setIsDragging(true);
      dragStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        px: position.x,
        py: position.y,
      };
    }
  }

  function handleFullscreen() {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      mozRequestFullScreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
      el.mozRequestFullScreen();
    } else if (el.msRequestFullscreen) {
      el.msRequestFullscreen();
    }
  }

  const toolbarBtnClass =
    "bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors flex items-center justify-center";

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center touch-none"
      onClick={onClose}
      onWheel={handleWheel}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 顶部工具栏 */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleZoomOut(); }}
            className={toolbarBtnClass}
            title="缩小"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="text-white text-xs min-w-[3rem] text-center">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleZoomIn(); }}
            className={toolbarBtnClass}
            title="放大"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleReset(); }}
            className={`${toolbarBtnClass} text-xs px-3`}
            title="重置"
          >
            重置
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleFullscreen(); }}
            className={toolbarBtnClass}
            title="全屏"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className={toolbarBtnClass}
            title="关闭"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <img
        ref={imgRef}
        src={url}
        alt={caption || ""}
        className="max-w-[95vw] sm:max-w-[90vw] max-h-[80vh] sm:max-h-[90vh] object-contain select-none"
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          cursor: isDragging ? "grabbing" : "grab",
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); handleDoubleClick(); }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        draggable={false}
      />

      {/* 移动端操作提示 */}
      <div className="absolute bottom-6 left-0 right-0 text-center text-white/50 text-xs sm:hidden">
        <p>双击放大 · 双指缩放 · 拖拽移动</p>
      </div>

      {caption && (
        <div className="absolute bottom-12 sm:bottom-6 left-0 right-0 text-center text-white/70 text-sm px-4">
          {caption}
        </div>
      )}
    </div>
  );
}

/* 视频播放器：支持原生全屏，不支持时 fallback 到弹窗全屏 */
function VideoPlayer({ src, caption }: { src: string; caption: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showModal, setShowModal] = useState(false);

  async function handleFullscreen() {
    const v = videoRef.current;
    if (!v) return;
    const el = v as HTMLVideoElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      mozRequestFullScreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else if (el.mozRequestFullScreen) {
        await el.mozRequestFullScreen();
      } else if (el.msRequestFullscreen) {
        await el.msRequestFullscreen();
      } else {
        throw new Error("不支持全屏");
      }
    } catch {
      setShowModal(true);
      try {
        await videoRef.current?.play();
      } catch {
        /* 自动播放可能被浏览器阻止，用户可手动点击播放 */
      }
    }
  }

  return (
    <>
      <div className="relative inline-block group">
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          className="max-w-full rounded-lg"
          preload="metadata"
        />
        <button
          type="button"
          onClick={handleFullscreen}
          className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-opacity opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          title="全屏播放"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>
      {showModal && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center touch-none"
          onClick={() => setShowModal(false)}
          onTouchMove={(e) => e.preventDefault()}
        >
          <video
            src={src}
            controls
            autoPlay
            className="max-w-[95vw] max-h-[95vh] rounded"
            onClick={(e) => e.stopPropagation()}
          />
          {caption && (
            <div className="absolute bottom-6 left-0 right-0 text-center text-white/70 text-sm px-4">
              {caption}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowModal(false)}
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10"
            title="关闭"
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

/* PDF 预览弹窗 */
function PdfPreview({ url, onClose }: { url: string; onClose: () => void }) {
  const touchStartY = useRef(0);

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

  function handleTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dy) > 100) {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex flex-col"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white">
        <span className="text-sm truncate max-w-[60%]">PDF 预览</span>
        <div className="flex items-center gap-3">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-300 hover:text-blue-200 flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            新窗口打开
          </a>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* PDF 内容区 */}
      <div className="flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>
        <iframe
          src={url}
          className="w-full h-full border-0"
          title="PDF 预览"
        />
      </div>
    </div>
  );
}

export function BlockNoteRenderer({ blocks, userGroupId, isAdmin }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewCaption, setPreviewCaption] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const handleImageClick = useCallback((url: string, caption: string) => {
    setPreviewUrl(url);
    setPreviewCaption(caption);
  }, []);

  const handlePdfPreview = useCallback((url: string) => {
    setPdfUrl(url);
  }, []);

  const handleCloseImage = useCallback(() => {
    setPreviewUrl(null);
  }, []);

  const handleClosePdf = useCallback(() => {
    setPdfUrl(null);
  }, []);

  const visibleBlocks = 过滤权限块(blocks, userGroupId, isAdmin);

  if (!visibleBlocks || visibleBlocks.length === 0) {
    return <p className="text-gray-400">暂无可见内容</p>;
  }

  return (
    <>
      <div className="blocknote-content">{wrapListBlocks(visibleBlocks, handleImageClick, handlePdfPreview)}</div>
      {previewUrl && <ImagePreview url={previewUrl} caption={previewCaption} onClose={handleCloseImage} />}
      {pdfUrl && <PdfPreview url={pdfUrl} onClose={handleClosePdf} />}
    </>
  );
}
