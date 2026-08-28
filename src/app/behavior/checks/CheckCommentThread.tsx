"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { 提交考核评论 } from "./actions";

interface 评论 {
  id: string;
  content: string;
  created_at: string;
  author_name: string;
}

interface Props {
  checkRecordId: string;
  initialCount: number;
  /* 发送成功后回调（父组件更新计数） */
  onPosted?: () => void;
}

/* 检查记录下的评论线程：默认收起只显示条数，展开时才加载明细 */
export default function CheckCommentThread({ checkRecordId, initialCount, onPosted }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState<评论[]>([]);
  const [count, setCount] = useState(initialCount);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function loadComments() {
    const { data } = await supabase
      .from("behavior_check_comments")
      .select("id, content, created_at, author:profiles!behavior_check_comments_author_id_fkey(full_name)")
      .eq("check_record_id", checkRecordId)
      .order("created_at", { ascending: true });
    const list: 评论[] = (data || []).map((c: unknown) => {
      const row = c as { id: string; content: string; created_at: string; author: { full_name: string }[] | { full_name: string } | null };
      const author = Array.isArray(row.author) ? row.author[0] : row.author;
      return { id: row.id, content: row.content, created_at: row.created_at, author_name: author?.full_name || "未知" };
    });
    setComments(list);
    setCount(list.length);
    setLoaded(true);
  }

  function toggle() {
    if (!expanded && !loaded) {
      loadComments();
    }
    setExpanded(!expanded);
  }

  async function handleSend() {
    const content = input.trim();
    if (!content) return;
    setSending(true);
    try {
      /* 写库走 Server Action，作者取服务端登录用户 */
      const result = await 提交考核评论({ checkRecordId, content });
      if (!result.success) throw new Error(result.error || "评论失败");
      setInput("");
      await loadComments();
      onPosted?.();
    } catch (err: unknown) {
      alert("评论失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <button onClick={toggle} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        评论（{count}）
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {!loaded ? (
            <p className="text-xs text-gray-400">加载中...</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-gray-400">暂无评论</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="text-sm bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-0.5">
                  <span className="font-medium text-gray-600">{c.author_name}</span>
                  <span>{new Date(c.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <p className="text-gray-800 whitespace-pre-wrap">{c.content}</p>
              </div>
            ))
          )}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              placeholder="写下评论..."
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
