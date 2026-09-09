"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { 直领开单 } from "@/app/picking-orders/actions";

export interface 员工选项 {
  id: string;
  full_name: string | null;
}

interface Props {
  分支id: string;
  名称: string;
  剩余需领: number;
  /* 在职员工列表（服务端注入，领料人点选用） */
  员工列表: 员工选项[];
}

/* 急件直领按钮（待入库未入账的配件）：弹窗确认数量/领料人 → 直领开单 RPC。
   登记后库存不动，确认入库时自动即入即出轧平。
   领料人交互（2026-09-09 用户拍板）：PC 端点选技师（和派工同样式，单选）；
   移动端不用选，领料人就是当前操作者本人 */
export function DirectPickButton({ 分支id, 名称, 剩余需领, 员工列表 }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { showToast } = useToast();
  const [打开, set打开] = useState(false);
  const [数量, set数量] = useState("");
  const [选中领料人id, set选中领料人id] = useState("");
  const [领料人搜索, set领料人搜索] = useState("");
  const [备注, set备注] = useState("");
  const [loading, setLoading] = useState(false);
  /* 移动端标记 + 移动端操作者姓名（本人即领料人） */
  const [是移动端, set是移动端] = useState(false);
  const [操作者姓名, set操作者姓名] = useState("");

  /* 打开时判定端别；移动端直接取当前登录人姓名作为领料人 */
  useEffect(() => {
    if (!打开) return;
    const 手机 = window.innerWidth < 768;
    set是移动端(手机);
    if (手机) {
      (async () => {
        /* getSession 本地读不联网 */
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        const 本人 = 员工列表.find((p) => p.id === uid);
        set操作者姓名(本人?.full_name || "");
      })();
    }

  }, [打开, supabase, 员工列表]);

  function 打开弹窗() {
    set数量(String(剩余需领));
    set选中领料人id("");
    set领料人搜索("");
    set备注("");
    set打开(true);
  }

  /* 实际提交的领料人姓名：移动端=操作者本人，PC=点选的人 */
  function 当前领料人(): string {
    if (是移动端) return 操作者姓名;
    return 员工列表.find((p) => p.id === 选中领料人id)?.full_name || "";
  }

  /* 领料人列表：搜索过滤（姓名包含即可） */
  const 过滤后员工 = 领料人搜索.trim()
    ? 员工列表.filter((p) => (p.full_name || "").includes(领料人搜索.trim()))
    : 员工列表;

  async function 提交() {
    const n = parseInt(数量);
    /* 提示走全局轻提示条（不用浏览器自带弹窗）；校验失败不关弹窗，改完可再点 */
    if (!Number.isInteger(n) || n <= 0) {
      showToast("直领数量必须是大于 0 的整数", "warning");
      return;
    }
    if (n > 剩余需领) {
      showToast(`该配件剩余需领 ${剩余需领} 件，不能超领`, "warning");
      return;
    }
    if (!是移动端 && !选中领料人id) {
      showToast("请选择领料人", "warning");
      return;
    }
    setLoading(true);
    try {
      const r = await 直领开单(
        [{ work_order_item_part_id: 分支id, quantity: n }],
        当前领料人(),
        备注
      );
      if (!r.success) {
        showToast("直领失败: " + (r.error || "未知错误"), "error");
        return;
      }
      set打开(false);
      showToast(`直领成功，领料单号 ${r.data?.no || ""}（入库确认时自动入账）`, "success");
      router.refresh();
    } catch (err: unknown) {
      showToast("直领失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={打开弹窗}
        className="text-xs px-2 py-1 rounded bg-orange-500 text-white hover:bg-orange-600 whitespace-nowrap"
      >
        急件直领
      </button>

      {/* 弹窗：固定定位 + 半透明遮罩 */}
      {打开 && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-gray-900 mb-1">急件直领</h3>
            <p className="text-xs text-gray-500 mb-4">
              {名称} · 剩余需领 {剩余需领} 件。货在待入库还没入账，直领后直接给技师，
              等确认入库时库存账自动轧平。
            </p>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 w-16">数量</label>
                <input
                  type="number"
                  min={1}
                  max={剩余需领}
                  value={数量}
                  onChange={(e) => set数量(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>

              {/* 领料人：PC 点选（单选，同派工样式）；移动端固定为操作者本人 */}
              {是移动端 ? (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 w-16">领料人</label>
                  <span className="text-sm text-gray-900">{操作者姓名 || "加载中..."}（本人）</span>
                </div>
              ) : (
                <div>
                  <label className="text-sm text-gray-600 block mb-1.5">领料人（点选）</label>
                  <input
                    type="text"
                    value={领料人搜索}
                    onChange={(e) => set领料人搜索(e.target.value)}
                    placeholder="搜索姓名"
                    className="w-full px-3 py-1.5 mb-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                  />
                  <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg p-1.5 space-y-0.5">
                    {过滤后员工.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-3">没有匹配的人员</p>
                    )}
                    {过滤后员工.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="直领领料人"
                          checked={选中领料人id === p.id}
                          onChange={() => set选中领料人id(p.id)}
                          className="accent-orange-500"
                        />
                        <span className="text-sm">{p.full_name || "-"}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 w-16">备注</label>
                <input
                  type="text"
                  value={备注}
                  onChange={(e) => set备注(e.target.value)}
                  placeholder="可空"
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => set打开(false)}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={提交}
                disabled={loading || (是移动端 && !操作者姓名)}
                className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {loading ? "开单中..." : "确认直领"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
