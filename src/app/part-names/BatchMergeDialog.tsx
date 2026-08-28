"use client";

import {useState, useEffect} from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 合并配件名称 } from "./actions";

interface Props {
  open: boolean;
  selectedNames: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchMergeDialog({ open, selectedNames, onClose, onSuccess }: Props) {
  const router = useRouter();
  const [targetId, setTargetId] = useState<string>("");
  const [finalName, setFinalName] = useState("");
  const [merging, setMerging] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  useEffect(() => {
    if (open && selectedNames.length > 0) {
      setTargetId(selectedNames[0].id);
      setFinalName(selectedNames[0].name);
    }
  }, [open, selectedNames]);

  useEffect(() => {
    const target = selectedNames.find((n) => n.id === targetId);
    if (target) {
      setFinalName(target.name);
    }
  }, [targetId, selectedNames]);

  async function handleMerge() {
    if (!targetId) {
      alert("请选择要保留的配件名称");
      return;
    }
    if (!finalName.trim()) {
      alert("请输入合并后的名称");
      return;
    }

    const targetName = selectedNames.find((n) => n.id === targetId)?.name;
    const otherNames = selectedNames
      .filter((n) => n.id !== targetId)
      .map((n) => n.name)
      .join("」、「");

    if (
      !(await 请求确认(
        `确定要将「${otherNames}」合并到「${targetName}」吗？\n\n合并后名称为：${finalName.trim()}\n\n所有关联数据将转移到保留项，其他项将被删除。`
      ))
    ) {
      return;
    }

    setMerging(true);

    /* 合并走 Server Action + RPC merge_part_names 一个事务：
     * 品牌/规格关联去重合并 + 4 张引用表换主 + 删除源名称，要么全成要么全败 */
    const result = await 合并配件名称({
      targetId,
      sourceIds: selectedNames.filter((n) => n.id !== targetId).map((n) => n.id),
      finalName: finalName.trim(),
    });
    setMerging(false);
    if (!result.success) {
      alert("合并失败: " + (result.error || "未知错误"));
      return;
    }

    onSuccess();
    router.refresh();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
        <h3 className="text-base font-semibold text-gray-900 mb-2">合并配件名称</h3>
        <p className="text-sm text-gray-500 mb-4">
          请选择要保留的配件名称，并确认合并后的最终名称。其他选中的配件将被删除，所有关联数据将转移到保留项。
        </p>

        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {selectedNames.map((n) => (
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

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">合并后的名称</label>
          <input
            type="text"
            value={finalName}
            onChange={(e) => setFinalName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入合并后的名称"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={merging || !targetId || !finalName.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50"
          >
            {merging ? "合并中..." : "确认合并"}
          </button>
        </div>
      </div>
      {确认弹窗}
    </div>
  );
}
