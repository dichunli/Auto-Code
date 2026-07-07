"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ToolBorrowReturnModal from "../components/ToolBorrowReturnModal";
import LocationQrCode from "../components/LocationQrCode";
import { ImageViewer } from "@/components/ImageViewer";
import { BlockNoteRenderer } from "@/components/BlockNoteRenderer";

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

interface 借用记录 {
  id: string;
  tool_id: string;
  borrower_id: string | null;
  borrowed_at: string;
  returner_id: string | null;
  returned_at: string | null;
  notes: string | null;
  employees?: { name: string } | null;
}

const 状态标签: Record<string, { label: string; className: string }> = {
  available: { label: "在库", className: "bg-green-50 text-green-700" },
  borrowed: { label: "借出", className: "bg-amber-50 text-amber-700" },
  scrapped: { label: "报废", className: "bg-gray-100 text-gray-500" },
};

export default function ToolDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [工具, set工具] = useState<工具 | null>(null);
  const [知识标题, set知识标题] = useState("");
  const [未归还记录, set未归还记录] = useState<借用记录 | null>(null);
  const [加载中, set加载中] = useState(true);
  const [借还弹窗打开, set借还弹窗打开] = useState(false);
  const [是管理员, set是管理员] = useState(false);
  const [预览图索引, set预览图索引] = useState<number | null>(null);

  useEffect(() => {
    async function 加载() {
      set加载中(true);
      try {
        const { data, error } = await supabase
          .from("tools")
          .select("*")
          .eq("id", id)
          .single();

        if (error || !data) {
          alert("工具不存在");
          router.push("/tools/management");
          return;
        }

        set工具(data as 工具);

        /* 加载知识库标题 */
        if (data.knowledge_article_id) {
          const { data: kData } = await supabase
            .from("knowledge_articles")
            .select("title")
            .eq("id", data.knowledge_article_id)
            .single();
          if (kData) {
            set知识标题((kData as 知识文章).title);
          }
        }

        /* 加载当前借用人 */
        try {
          const { data: 记录 } = await supabase
            .from("tool_borrow_records")
            .select("*")
            .eq("tool_id", id)
            .maybeSingle();
          if (记录 && (记录 as 借用记录).returned_at === null) {
            set未归还记录(记录 as 借用记录);
          }
        } catch (e) {
          /* 忽略借用人查询错误 */
        }

        /* 检查管理员权限 */
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
        alert("加载失败: " + msg);
      } finally {
        set加载中(false);
      }
    }

    加载();
  }, [id, supabase, router]);

  function 状态显示(status: string) {
    const config = 状态标签[status] || { label: status, className: "bg-gray-100 text-gray-600" };
    return (
      <span className={`text-xs px-2 py-0.5 rounded ${config.className}`}>
        {config.label}
      </span>
    );
  }

  if (加载中) {
    return (
      <div className="px-4 py-8 text-center text-gray-500 text-sm">加载中...</div>
    );
  }

  if (!工具) {
    return null;
  }

  return (
    <div>
      {/* 移动端头部 */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-9 h-9 -ml-2 rounded-lg flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-gray-900">工具详情</h1>
          <div className="flex items-center gap-2">
            {是管理员 && (
              <Link
                href={`/tools/management/${工具.id}/edit`}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-blue-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* 工具图片（多图 + 点击放大） */}
        {(() => {
          const 图片列表 = 工具.image_url ? 工具.image_url.split(",").filter(Boolean) : [];
          if (图片列表.length === 0) {
            return (
              <div className="flex justify-center">
                <div className="w-full max-w-sm h-48 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                  <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              </div>
            );
          }
          return (
            <div className="flex flex-wrap gap-2 justify-center">
              {图片列表.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`${工具.name} ${i + 1}`}
                  className="w-full rounded-lg object-cover border border-gray-200 cursor-pointer hover:opacity-80"
                  style={{ maxWidth: 300 }}
                  onClick={() => set预览图索引(i)}
                />
              ))}
            </div>
          );
        })()}

        {/* 基本信息 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{工具.name}</h2>
            {状态显示(工具.status)}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-400 text-xs mb-0.5">工具编码</div>
              <div className="text-gray-900">{工具.code}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-0.5">存放位置</div>
              <div className="text-gray-900 flex items-center gap-1">
                {工具.location || "-"}
                {工具.location && <LocationQrCode location={工具.location} />}
              </div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-0.5">当前借用人</div>
              <div className="text-gray-900">{未归还记录?.employees?.name || "-"}</div>
            </div>
            {未归还记录 && (
              <div>
                <div className="text-gray-400 text-xs mb-0.5">借用时间</div>
                <div className="text-gray-900">
                  {new Date(未归还记录.borrowed_at).toLocaleString("zh-CN")}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 使用说明 */}
        {知识标题 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-sm font-medium text-gray-900 mb-2">使用说明</div>
            <Link
              href={`/knowledge/${工具.knowledge_article_id}`}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span>查看使用说明：{知识标题}</span>
            </Link>
          </div>
        )}

        {/* 工具说明 */}
        {工具.instructions && (() => {
          try {
            const blocks = JSON.parse(工具.instructions);
            if (Array.isArray(blocks) && blocks.length > 0) {
              return (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="text-sm font-medium text-gray-900 mb-2">工具说明</div>
                  <BlockNoteRenderer blocks={blocks} />
                </div>
              );
            }
          } catch {}
          return (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm font-medium text-gray-900 mb-2">工具说明</div>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{工具.instructions}</p>
            </div>
          );
        })()}

        {/* 借用/归还按钮 */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={() => set借还弹窗打开(true)}
            className={`w-full py-3 text-sm font-medium rounded-lg transition-colors ${
              工具.status === "borrowed"
                ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {工具.status === "borrowed" ? "归还工具" : "借用工具"}
          </button>
        </div>
      </div>

      <ToolBorrowReturnModal
        工具={工具}
        未归还记录={未归还记录}
        open={借还弹窗打开}
        onClose={() => set借还弹窗打开(false)}
        onSuccess={() => {
          router.push("/tools/management");
        }}
      />

      {/* 图片大图预览 */}
      {预览图索引 !== null && 工具.image_url && (
        <ImageViewer
          src={工具.image_url.split(",").filter(Boolean)[预览图索引]}
          images={工具.image_url.split(",").filter(Boolean)}
          currentIndex={预览图索引}
          onIndexChange={(i) => set预览图索引(i)}
          onClose={() => set预览图索引(null)}
        />
      )}
    </div>
  );
}
