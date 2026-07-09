"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 借用记录 {
  id: string;
  tool_id: string;
  borrower_id: string | null;
  borrowed_at: string;
  returner_id: string | null;
  returned_at: string | null;
  notes: string | null;
  tools?: { code: string; name: string } | null;
  borrower_profile?: { full_name: string } | null;
  returner_profile?: { full_name: string } | null;
}

interface 归还照片 {
  id: string;
  borrow_record_id: string;
  photo_url: string;
}

export default function BorrowRecordsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [记录列表, set记录列表] = useState<借用记录[]>([]);
  const [照片映射, set照片映射] = useState<Map<string, 归还照片[]>>(new Map());
  const [加载中, set加载中] = useState(true);
  const [当前页, set当前页] = useState(1);
  const [照片弹窗, set照片弹窗] = useState<归还照片[] | null>(null);
  const [搜索词, set搜索词] = useState("");
  const [仅未归还, set仅未归还] = useState(true);
  const 每页条数 = 30;

  useEffect(() => {
    async function 加载() {
      set加载中(true);
      const { data } = await supabase
        .from("tool_borrow_records")
        .select("*, tools(code, name)")
        .order("borrowed_at", { ascending: false })
        .limit(500);

      const records = (data || []) as 借用记录[];
      set记录列表(records);

      /* 加载借用人 / 归还人姓名 */
      const userIds = [...new Set(records.flatMap((r) => [r.borrower_id, r.returner_id].filter(Boolean)))] as string[];
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        const map = new Map((profiles || []).map((p) => [p.id, p]));
        set记录列表((prev) =>
          prev.map((r) => ({
            ...r,
            borrower_profile: (r.borrower_id ? map.get(r.borrower_id) : null) as { full_name: string } | null,
            returner_profile: (r.returner_id ? map.get(r.returner_id) : null) as { full_name: string } | null,
          }))
        );
      }

      /* 加载归还照片 */
      const recordIds = records.map((r) => r.id);
      if (recordIds.length > 0) {
        const { data: photos } = await supabase
          .from("tool_return_photos")
          .select("id, borrow_record_id, photo_url")
          .in("borrow_record_id", recordIds)
          .order("created_at", { ascending: true });
        const photoMap = new Map<string, 归还照片[]>();
        (photos || []).forEach((p) => {
          const arr = photoMap.get(p.borrow_record_id) || [];
          arr.push(p as 归还照片);
          photoMap.set(p.borrow_record_id, arr);
        });
        set照片映射(photoMap);
      }

      set加载中(false);
    }
    加载();
  }, [supabase]);

  /* 筛选 */
  const 筛选后 = 记录列表.filter((r) => {
    const keyword = 搜索词.trim().toLowerCase();
    if (keyword) {
      const toolInfo = `${r.tools?.code || ""} ${r.tools?.name || ""} ${r.borrower_profile?.full_name || ""}`.toLowerCase();
      if (!toolInfo.includes(keyword)) return false;
    }
    if (仅未归还 && r.returned_at) return false;
    return true;
  });

  const 总页数 = Math.max(1, Math.ceil(筛选后.length / 每页条数));
  const 安全页码 = Math.min(当前页, 总页数);
  const 当前页数据 = 筛选后.slice((安全页码 - 1) * 每页条数, 安全页码 * 每页条数);

  return (
    <div>
      <PageHeader title="工具借还记录" description="所有工具的借用与归还记录" />

      {加载中 ? (
        <div className="text-center text-gray-400 py-12">加载中...</div>
      ) : (
        <>
        {/* 搜索和筛选 */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="text"
            value={搜索词}
            onChange={(e) => { set搜索词(e.target.value); set当前页(1); }}
            placeholder="搜索工具编码、名称或借用人..."
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={仅未归还}
              onChange={(e) => { set仅未归还(e.target.checked); set当前页(1); }}
              className="w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            仅显示未归还
          </label>
          <span className="text-sm text-gray-400">
            共 {筛选后.length} 条{仅未归还 ? "（未归还）" : ""}
          </span>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">工具</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">借用人</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">借用时间</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">归还人</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">归还时间</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">归还照片</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {当前页数据.map((r) => {
                  const photos = 照片映射.get(r.id);
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/tools/management/${r.tool_id}`} className="text-blue-600 hover:underline">
                          {r.tools?.code} {r.tools?.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {r.borrower_profile?.full_name || "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {new Date(r.borrowed_at).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {r.returned_at ? (r.returner_profile?.full_name || "-") : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {r.returned_at ? (
                          <span className="text-gray-600">{new Date(r.returned_at).toLocaleString("zh-CN")}</span>
                        ) : (
                          <span className="text-amber-600 font-medium">未归还</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {photos && photos.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => set照片弹窗(photos)}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            查看 {photos.length} 张
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {当前页数据.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                      暂无借还记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {总页数 > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-sm text-gray-500">共 {记录列表.length} 条</span>
              <div className="flex items-center gap-2">
                <button onClick={() => set当前页(1)} disabled={当前页 <= 1} className="px-2 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-30">首页</button>
                <button onClick={() => set当前页((p) => Math.max(1, p - 1))} disabled={当前页 <= 1} className="px-2 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-30">上一页</button>
                <span className="text-sm text-gray-600 px-2">{当前页} / {总页数}</span>
                <button onClick={() => set当前页((p) => Math.min(总页数, p + 1))} disabled={当前页 >= 总页数} className="px-2 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-30">下一页</button>
                <button onClick={() => set当前页(总页数)} disabled={当前页 >= 总页数} className="px-2 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-30">末页</button>
              </div>
            </div>
          )}
        </div>
        </>
      )}

      {/* 照片弹窗 */}
      {照片弹窗 && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => set照片弹窗(null)}>
          <div className="bg-white rounded-xl p-4 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">归还验收照片</h3>
              <button onClick={() => set照片弹窗(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {照片弹窗.map((p, i) => (
                <img key={p.id} src={p.photo_url} alt={`照片 ${i + 1}`} className="w-full rounded-lg object-cover border border-gray-200" loading="lazy" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
