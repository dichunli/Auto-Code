"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import ToolQrCode from "./components/ToolQrCode";
import ToolScanButton from "./components/ToolScanButton";

interface 工具 {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
  instructions: string | null;
  knowledge_article_id: string | null;
  location: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
}

interface 知识文章 {
  id: string;
  title: string;
}

interface 员工 {
  id: string;
  name: string;
}

interface 借用记录 {
  id: string;
  tool_id: string;
  borrower_id: string | null;
  borrowed_at: string;
  returner_id: string | null;
  returned_at: string | null;
  notes: string | null;
  employees?: 员工 | null;
}

const 状态标签: Record<string, { label: string; className: string }> = {
  available: { label: "在库", className: "bg-green-50 text-green-700" },
  borrowed: { label: "借出", className: "bg-amber-50 text-amber-700" },
  scrapped: { label: "报废", className: "bg-gray-100 text-gray-500" },
};

const 每页条数 = 20;

export default function ToolManagementPage() {
  const supabase = useMemo(() => createClient(), []);
  const [工具列表, set工具列表] = useState<工具[]>([]);
  const [知识库映射, set知识库映射] = useState<Map<string, string>>(new Map());
  const [未归还记录, set未归还记录] = useState<Map<string, 借用记录>>(new Map());
  const [加载中, set加载中] = useState(true);
  const [错误, set错误] = useState("");
  const [搜索词, set搜索词] = useState("");
  const [防抖搜索词, set防抖搜索词] = useState("");
  const [当前页, set当前页] = useState(1);
  const [是管理员, set是管理员] = useState(false);
  const [删除中, set删除中] = useState<string | null>(null);
  const 搜索定时器 = useRef<ReturnType<typeof setTimeout> | null>(null);

  const 加载数据 = useCallback(async () => {
    set加载中(true);
    set错误("");
    try {
      let query = supabase
        .from("tools")
        .select("*")
        .order("created_at", { ascending: false });

      const keyword = 防抖搜索词.trim();
      if (keyword) {
        query = query.or(`code.ilike.%${keyword}%,name.ilike.%${keyword}%`);
      }

      const { data: 工具数据, error: 工具错误 } = await query;
      if (工具错误) throw 工具错误;

      const tools = (工具数据 as 工具[]) || [];
      set工具列表(tools);

      /* 加载知识库标题 */
      const knowledgeIds = tools.map((t) => t.knowledge_article_id).filter(Boolean) as string[];
      if (knowledgeIds.length > 0) {
        const { data: kData } = await supabase
          .from("knowledge_articles")
          .select("id, title")
          .in("id", [...new Set(knowledgeIds)]);
        const map = new Map<string, string>();
        ((kData as 知识文章[]) || []).forEach((k) => map.set(k.id, k.title));
        set知识库映射(map);
      } else {
        set知识库映射(new Map());
      }

      /* 加载未归还记录 */
      if (tools.length > 0) {
        const { data: 记录数据 } = await supabase
          .from("tool_borrow_records")
          .select("*, employees(name)")
          .in(
            "tool_id",
            tools.map((t) => t.id)
          )
          .is("returned_at", null);
        const map = new Map<string, 借用记录>();
        ((记录数据 as 借用记录[]) || []).forEach((r) => {
          map.set(r.tool_id, r);
        });
        set未归还记录(map);
      } else {
        set未归还记录(new Map());
      }

      /* 检查当前用户是否为管理员 */
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        set是管理员(profile?.role === "admin");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set错误(msg);
    } finally {
      set加载中(false);
    }
  }, [supabase, 防抖搜索词]);

  useEffect(() => {
    加载数据();
  }, [加载数据]);

  useEffect(() => {
    if (搜索定时器.current) clearTimeout(搜索定时器.current);
    搜索定时器.current = setTimeout(() => {
      set防抖搜索词(搜索词);
      set当前页(1);
    }, 300);
    return () => {
      if (搜索定时器.current) clearTimeout(搜索定时器.current);
    };
  }, [搜索词, 搜索定时器]);

  const 总页数 = Math.max(1, Math.ceil(工具列表.length / 每页条数));
  const 安全页码 = Math.min(当前页, 总页数);
  const 当前页数据 = 工具列表.slice((安全页码 - 1) * 每页条数, 安全页码 * 每页条数);

  async function 删除工具(id: string, name: string) {
    if (!confirm(`确定删除工具「${name}」吗？删除后不可恢复。`)) return;
    set删除中(id);
    try {
      const { error } = await supabase.from("tools").delete().eq("id", id);
      if (error) throw error;
      set工具列表((prev) => prev.filter((t) => t.id !== id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("删除失败: " + msg);
    } finally {
      set删除中(null);
    }
  }

  function 状态显示(status: string) {
    const config = 状态标签[status] || { label: status, className: "bg-gray-100 text-gray-600" };
    return (
      <span className={`text-xs px-2 py-0.5 rounded ${config.className}`}>
        {config.label}
      </span>
    );
  }

  return (
    <div>
      <PageHeader
        title="工具管理"
        description="管理维修工具台账，支持扫码借用和归还"
        action={{ href: "/tools/management/new", label: "新建工具" }}
      />

      {错误 && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          查询出错: {错误}
        </div>
      )}

      {/* 搜索栏 */}
      <div className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={搜索词}
            onChange={(e) => set搜索词(e.target.value)}
            placeholder="搜索工具编码或名称"
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            onClick={() => {
              set搜索词("");
              set防抖搜索词("");
              set当前页(1);
            }}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            重置
          </button>
          <ToolScanButton />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">图片</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">编码</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">名称</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">存放位置</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">当前借用人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">知识库</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {当前页数据.map((工具) => {
                const 未归还 = 未归还记录.get(工具.id);
                return (
                  <tr key={工具.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {工具.image_url ? (
                        <img
                          src={工具.image_url}
                          alt={工具.name}
                          className="w-10 h-10 rounded object-cover border border-gray-200"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400 text-xs">无图</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{工具.code}</td>
                    <td className="px-4 py-3 text-gray-700">{工具.name}</td>
                    <td className="px-4 py-3">{状态显示(工具.status)}</td>
                    <td className="px-4 py-3 text-gray-600">{工具.location || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {未归还?.employees?.name || "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {工具.knowledge_article_id ? (
                        <Link
                          href={`/knowledge/${工具.knowledge_article_id}`}
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {知识库映射.get(工具.knowledge_article_id) || "查看"}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/tools/borrow-scan?id=${工具.id}`}
                          className="text-xs px-2 py-1 text-white bg-blue-600 rounded hover:bg-blue-700"
                        >
                          {工具.status === "borrowed" ? "归还" : "借用"}
                        </Link>
                        <ToolQrCode toolId={工具.id} toolName={工具.name} toolCode={工具.code} />
                        {是管理员 && (
                          <>
                            <Link
                              href={`/tools/management/${工具.id}/edit`}
                              className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              编辑
                            </Link>
                            <button
                              type="button"
                              onClick={() => 删除工具(工具.id, 工具.name)}
                              disabled={删除中 === 工具.id}
                              className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                            >
                              {删除中 === 工具.id ? "删除中..." : "删除"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {当前页数据.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                    {加载中 ? "加载中..." : "暂无工具数据"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 */}
      {总页数 > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">
            共 {工具列表.length} 条，第 {安全页码}/{总页数} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => set当前页((p) => Math.max(1, p - 1))}
              disabled={安全页码 <= 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            {Array.from({ length: 总页数 }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => set当前页(page)}
                className={`px-3 py-1.5 text-sm rounded-lg ${
                  page === 安全页码
                    ? "bg-blue-600 text-white"
                    : "border border-gray-300 hover:bg-gray-50"
                }`}
              >
                {page}
              </button>
            ))}
            <button
              onClick={() => set当前页((p) => Math.min(总页数, p + 1))}
              disabled={安全页码 >= 总页数}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
