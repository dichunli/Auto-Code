"use client";

import {useState} from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 合并配件名称 } from "./actions";

export function MergeButton({ id, name, allNames }: { id: string; name: string; allNames: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [merging, setMerging] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  const candidates = allNames.filter((n) => n.id !== id);

  async function handleMerge() {
    if (!targetId) {
      alert("请选择要合并到的目标配件名称");
      return;
    }
    const targetName = candidates.find((n) => n.id === targetId)?.name;
    if (!(await 请求确认(`确定要将「${name}」合并到「${targetName}」吗？合并后「${name}」将被删除，所有关联数据将转移到「${targetName}」。`))) {
      return;
    }
    setMerging(true);

    /* 合并走 Server Action + RPC merge_part_names 一个事务（不改名） */
    const result = await 合并配件名称({ targetId, sourceIds: [id] });
    if (!result.success) {
      alert("合并失败: " + (result.error || "未知错误"));
      setMerging(false);
      return;
    }

    setOpen(false);
    setTargetId("");
    setMerging(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-orange-600 hover:text-orange-700 font-medium"
      >
        合并
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-gray-900 mb-2">合并配件名称</h3>
            <p className="text-sm text-gray-500 mb-4">
              将「{name}」合并到以下目标，合并后原名称将被删除，所有关联数据将转移到目标名称。
            </p>

            <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
              {candidates.length === 0 && (
                <div className="text-sm text-gray-400">没有其他配件名称可供合并</div>
              )}
              {candidates.map((n) => (
                <label
                  key={n.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    targetId === n.id
                      ? "border-blue-300 bg-blue-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="mergeTarget"
                    value={n.id}
                    checked={targetId === n.id}
                    onChange={() => setTargetId(n.id)}
                    className="text-blue-600"
                  />
                  <span className="text-sm text-gray-900">{n.name}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setOpen(false); setTargetId(""); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleMerge}
                disabled={merging || !targetId}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {merging ? "合并中..." : "确认合并"}
              </button>
            </div>
          </div>
        </div>
      )}
      {确认弹窗}
    </>
  );
}
