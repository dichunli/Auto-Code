"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import ToolQrCode from "./components/ToolQrCode";
import ToolScanButton from "./components/ToolScanButton";
import ToolBorrowReturnModal from "./components/ToolBorrowReturnModal";

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
  const [借还弹窗打开, set借还弹窗打开] = useState(false);
  const [选中工具, set选中工具] = useState<工具 | null>(null);
  const [显示移动端搜索, set显示移动端搜索] = useState(false);
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
        try {
          const { data: 记录数据, error: 记录错误 } = await supabase
            .from("tool_borrow_records")
            .select("*")
            .in(
              "tool_id",
              tools.map((t) => t.id)
            );

          if (!记录错误) {
            const map = new Map<string, 借用记录>();
            ((记录数据 as 借用记录[]) || []).filter(r => r.returned_at === null).forEach((r) => {
              map.set(r.tool_id, r);
            });
            set未归还记录(map);
          } else {
            console.log("未归还记录查询失败，继续执行", 记录错误);
            set未归还记录(new Map());
          }
        } catch (e) {
          console.log("查询错误，继续执行", e);
          set未归还记录(new Map());
        }
      } else {
        set未归还记录(new Map());
      }

      /* 检查当前用户是否为管理员（通过 profile_roles） */
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: roleData } = await supabase
          .from("profile_roles")
          .select("roles(name)")
          .eq("profile_id", user.id);
        interface 角色关联 {
          roles: { name: string } | null;
        }
        const roleNames = (roleData || [])
          .map((r: 角色关联) => r.roles?.name)
          .filter(Boolean) as string[];
        set是管理员(roleNames.includes("admin"));
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
      {/* 桌面版头部（大屏幕显示） */}
      <div className="hidden lg:block">
        <PageHeader
          title="工具管理"
          description="管理维修工具台账，支持扫码借用和归还"
          action={{ href: "/tools/management/new", label: "新建工具" }}
        />
      </div>

      {/* 移动端头部（默认显示） */}
      <div className="lg:hidden sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-gray-900">工具管理</h1>
            <p className="text-xs text-gray-500">共 {工具列表.length} 个工具</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => set显示移动端搜索((v) => !v)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${显示移动端搜索 ? "bg-blue-50 text-blue-600" : "text-gray-500 hover:text-blue-600"}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            <ToolScanButton />
            <Link
              href="/tools/management/new"
              className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center active:scale-95 transition-transform"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </Link>
          </div>
        </div>

        {/* 移动端搜索栏 */}
        {显示移动端搜索 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={搜索词}
                onChange={(e) => set搜索词(e.target.value)}
                placeholder="搜索工具编码或名称"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              {搜索词 && (
                <button
                  onClick={() => {
                    set搜索词("");
                    set防抖搜索词("");
                    set当前页(1);
                  }}
                  className="px-3 py-2 text-sm text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100"
                >
                  重置
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 桌面版搜索栏 */}
      <div className="hidden lg:block">
        {错误 && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            查询出错：{错误}
          </div>
        )}

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
      </div>

      {/* 桌面版表格视图 */}
      <div className="hidden lg:block">
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
                          <button
                            type="button"
                            onClick={() => {
                              set选中工具(工具);
                              set借还弹窗打开(true);
                            }}
                            className="text-xs px-2 py-1 text-white bg-blue-600 rounded hover:bg-blue-700"
                          >
                            {工具.status === "borrowed" ? "归还" : "借用"}
                          </button>
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

        {/* 桌面版分页 */}
        {总页数 > 1 && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-gray-500">
              共 {工具列表.length} 条，第 {安全页码}/{总页数} 页
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => set当前页((p) => Math.max(1, p - 1))}
                disabled={安全页码 <= 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 移动端卡片视图（默认显示） */}
      <div className="lg:hidden px-3 py-3 space-y-2">
        {错误 && (
          <div className="px-3 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            查询出错：{错误}
          </div>
        )}

        {加载中 ? (
          <div className="text-center text-gray-400 py-12 text-sm">加载中...</div>
        ) : 当前页数据.length > 0 ? (
          <>
            {当前页数据.map((工具) => {
              const 未归还 = 未归还记录.get(工具.id);
              return (
                <div
                  key={工具.id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm"
                >
                  {/* 卡片主体：横向布局 */}
                  <div className="p-3 flex gap-3">
                    {/* 左侧图片 */}
                    {工具.image_url ? (
                      <img
                        src={工具.image_url}
                        alt={工具.name}
                        className="w-20 h-20 rounded-lg object-cover border border-gray-100 flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-400 flex-shrink-0">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                    )}

                    {/* 右侧内容区 */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* 第一行：工具名称 + 编辑按钮 */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/tools/management/${工具.id}`}
                            className="font-semibold text-gray-900 text-sm truncate hover:text-blue-600"
                          >
                            {工具.name}
                          </Link>
                        </div>
                        {是管理员 && (
                          <Link
                            href={`/tools/management/${工具.id}/edit`}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-blue-50 active:scale-95 transition-transform flex-shrink-0"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </Link>
                        )}
                      </div>

                      {/* 第二行：状态 + 当前借用人 */}
                      <div className="flex items-center gap-2 text-xs">
                        {状态显示(工具.status)}
                        {未归还?.employees?.name && (
                          <span className="text-amber-600">
                            <span className="text-gray-400">借用人：</span>{未归还.employees.name}
                          </span>
                        )}
                      </div>

                      {/* 第三行：存放位置 */}
                      {工具.location && (
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span>{工具.location}</span>
                        </div>
                      )}

                      {/* 第四行：使用说明 + 借/还按钮 */}
                      <div className="flex items-center justify-between gap-2 pt-1">
                        {/* 使用说明 */}
                        {工具.knowledge_article_id ? (
                          <Link
                            href={`/knowledge/${工具.knowledge_article_id}`}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 flex-1 min-w-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                            <span className="truncate">查看使用说明</span>
                          </Link>
                        ) : (
                          <Link
                            href={`/tools/management/${工具.id}/edit`}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 flex-1 min-w-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                            <span className="truncate">暂无使用说明，点击添加</span>
                          </Link>
                        )}

                        {/* 借用/归还按钮 */}
                        <button
                          type="button"
                          onClick={() => {
                            set选中工具(工具);
                            set借还弹窗打开(true);
                          }}
                          className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors flex-shrink-0 ${
                            工具.status === "borrowed"
                              ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                              : "bg-blue-600 text-white hover:bg-blue-700"
                          }`}
                        >
                          {工具.status === "borrowed" ? "归还" : "借用"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 移动端分页 */}
            {总页数 > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2 pb-4">
                <button
                  onClick={() => set当前页((p) => Math.max(1, p - 1))}
                  disabled={安全页码 <= 1}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <span className="text-sm text-gray-600 px-2">
                  {安全页码} / {总页数}
                </span>
                <button
                  onClick={() => set当前页((p) => Math.min(总页数, p + 1))}
                  disabled={安全页码 >= 总页数}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center text-gray-400 py-12 text-sm">
            暂无工具数据
          </div>
        )}
      </div>

      <ToolBorrowReturnModal
        工具={选中工具}
        未归还记录={选中工具 ? 未归还记录.get(选中工具.id) || null : null}
        open={借还弹窗打开}
        onClose={() => {
          set借还弹窗打开(false);
          set选中工具(null);
        }}
        onSuccess={加载数据}
      />
    </div>
  );
}
