"use client";

import { useState, useEffect, useCallback, useRef, type ComponentProps } from "react";
import { BlockNoteRenderer } from "./BlockNoteRenderer";

interface BlockProps {
  level?: number;
}

interface InlineContent {
  type: string;
  text?: string;
  content?: InlineContent[];
}

interface BlockItem {
  id: string;
  type: string;
  props: BlockProps;
  content?: InlineContent[] | { type: string; rows: unknown[] };
  children?: BlockItem[];
}

interface Props {
  blocks: BlockItem[];
  title: string;
  autoOpen?: boolean;
  userGroupId?: string;
  isAdmin?: boolean;
}

/* 页码选择器 */
function PageSelector({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const [showSelector, setShowSelector] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSelector(false);
      }
    }
    if (showSelector) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSelector]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setShowSelector(!showSelector)}
        className="text-xs text-gray-500 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 transition-colors min-w-[80px] text-center"
      >
        第 {currentPage + 1} / {totalPages} 页
      </button>

      {showSelector && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg p-2 max-h-48 overflow-y-auto w-20">
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onChange(i);
                setShowSelector(false);
              }}
              className={`w-full text-xs px-2 py-1 rounded text-center transition-colors ${
                i === currentPage
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function splitIntoPages(blocks: BlockItem[]): BlockItem[][] {
  const pages: BlockItem[][] = [];
  let currentPage: BlockItem[] = [];

  for (const block of blocks) {
    if (block.type === "divider") {
      if (currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
      }
      /* 连续多个 divider 不产生空页 */
    } else {
      currentPage.push(block);
    }
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  /* 没有 divider 时整篇作为一页 */
  if (pages.length === 0 && blocks.length > 0) {
    pages.push(blocks);
  }

  return pages;
}

export function PresentationView({
  blocks,
  title,
  autoOpen,
  userGroupId,
  isAdmin,
}: Props) {
  const [isOpen, setIsOpen] = useState(autoOpen || false);
  const [currentPage, setCurrentPage] = useState(0);

  const pages = splitIntoPages(blocks);

  const goNext = useCallback(() => {
    setCurrentPage((p) => Math.min(p + 1, pages.length - 1));
  }, [pages.length]);

  const goPrev = useCallback(() => {
    setCurrentPage((p) => Math.max(p - 1, 0));
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setCurrentPage(0);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goNext, goPrev, handleClose]);

  /* 内容区点击捕获页内跳转链接 #page=3 */
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const el = contentRef.current;
    if (!el) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;

      /* 页内跳转: #page=3 */
      const pageMatch = href.match(/^#page=(\d+)$/);
      if (pageMatch) {
        e.preventDefault();
        const pageNum = parseInt(pageMatch[1], 10);
        if (pageNum >= 1 && pageNum <= pages.length) {
          setCurrentPage(pageNum - 1);
        }
      }
    }

    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [isOpen, pages.length]);

  /* 打开演示模式时禁止背景滚动 */
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (pages.length === 0) return null;

  return (
    <>
      {/* 演示按钮 */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="text-sm px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors flex-shrink-0 flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        演示
      </button>

      {/* 全屏演示覆盖层 */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col">
          {/* 顶部栏 */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              关闭
            </button>
            <h2 className="text-sm font-semibold text-gray-900 truncate max-w-md">{title}</h2>
            <div className="w-12" />
          </div>

          {/* 内容区 */}
          <div className="flex-1 flex items-center justify-center overflow-auto px-4 py-4" ref={contentRef}>
            <div className="w-full max-w-4xl">
              <BlockNoteRenderer
                blocks={pages[currentPage] as unknown as ComponentProps<typeof BlockNoteRenderer>["blocks"]}
                userGroupId={userGroupId}
                isAdmin={isAdmin}
              />
            </div>
          </div>

          {/* 底部导航 */}
          <div className="flex items-center justify-center gap-4 px-4 py-2 border-t border-gray-200 flex-shrink-0">
            <button
              type="button"
              onClick={goPrev}
              disabled={currentPage === 0}
              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              上一页
            </button>

            <PageSelector currentPage={currentPage} totalPages={pages.length} onChange={setCurrentPage} />

            <button
              type="button"
              onClick={goNext}
              disabled={currentPage === pages.length - 1}
              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              下一页
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
