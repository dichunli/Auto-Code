"use client";

import {useState, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { 批量关联配件名称 } from "./actions";
import { SearchDropdown } from "@/components/SearchDropdown";

interface 关联项 {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  type: "brand" | "specification";
  selectedIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchLinkDialog({ open, type, selectedIds, onClose, onSuccess }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [linking, setLinking] = useState(false);

  const isBrand = type === "brand";
  const title = isBrand ? "批量关联品牌" : "批量关联规格";
  const placeholder = isBrand ? "搜索品牌名称..." : "搜索规格名称...";
  const table = isBrand ? "part_brands" : "part_specifications";
  const linkTable = isBrand ? "part_name_brands" : "part_name_specifications";

  /* 联想查询（查询条件与原防抖块一致，仅换成 SearchDropdown 的 searchFn） */
  async function 搜索关联目标(q: string): Promise<关联项[]> {
    const { data } = await supabase
      .from(table)
      .select("id, name")
      .ilike("name", `%${q}%`)
      .order("name")
      .limit(10);
    return data || [];
  }

  async function handleLink(targetId: string) {
    if (selectedIds.length === 0) return;
    setLinking(true);

    /* 写库走 Server Action（逐条关联在服务端完成） */
    const result = await 批量关联配件名称({
      partNameIds: Array.from(selectedIds),
      linkTable,
      targetId,
    });
    if (!result.success) {
      alert(`关联失败: ${result.error || "未知错误"}`);
      setLinking(false);
      return;
    }

    setLinking(false);
    onSuccess();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
        <h3 className="text-base font-semibold text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-500 mb-4">已选择 {selectedIds.length} 个配件名称，搜索并选择要关联的{isBrand ? "品牌" : "规格"}：</p>

        <div className="mb-3">
          {/* 非受控用法：弹窗关闭时组件卸载，内部查询词自动重置；选中即关联并关闭弹窗 */}
          <SearchDropdown<关联项>
            searchFn={搜索关联目标}
            getKey={(r) => r.id}
            onSelect={(r) => handleLink(r.id)}
            placeholder={placeholder}
            disabled={linking}
            renderItem={(r) => <span className="text-sm text-gray-900">{r.name}</span>}
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
        </div>
      </div>
    </div>
  );
}
