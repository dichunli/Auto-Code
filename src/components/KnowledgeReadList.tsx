"use client";

import { useState, useEffect, useCallback } from "react";
import { loadKnowledgeArticleReads } from "@/app/knowledge/actions";

interface 阅读记录 {
  user_id: string;
  read_date: string;
  created_at: string;
  full_name: string;
}

interface Props {
  articleId: string;
  readCount: number;
}

export function KnowledgeReadList({ articleId, readCount }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [reads, setReads] = useState<阅读记录[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReads = useCallback(async () => {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadKnowledgeArticleReads(articleId);
      if (result.success && result.reads) {
        setReads(result.reads);
        setLoaded(true);
      } else {
        setError(result.error || "加载失败");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载异常");
    } finally {
      setLoading(false);
    }
  }, [articleId, loaded, loading]);

  useEffect(() => {
    if (expanded && !loaded && !loading) {
      void loadReads();
    }
  }, [expanded, loaded, loading, loadReads]);

  return (
    <div className="mt-6 pt-6 border-t border-gray-100">
      <details
        className="bg-gray-50 rounded-lg border border-gray-200"
        onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      >
        <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center justify-between">
          <span>
            📖 阅读记录（{readCount} 次{reads.length > 0 ? ` · ${reads.length} 人` : ""}）
          </span>
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-4 pb-4 border-t border-gray-100">
          {loading ? (
            <p className="mt-3 text-sm text-gray-400">加载中...</p>
          ) : error ? (
            <p className="mt-3 text-sm text-red-500">{error}</p>
          ) : reads.length > 0 ? (
            <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
              {reads.map((record, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-white"
                >
                  <span className="text-gray-700">{record.full_name}</span>
                  <span className="text-gray-400 text-xs">
                    {new Date(record.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-400">暂无详细阅读记录</p>
          )}
        </div>
      </details>
    </div>
  );
}
