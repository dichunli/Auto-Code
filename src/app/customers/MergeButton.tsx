"use client";

import {useState, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { CustomerSearchDropdown, Customer } from "@/components/CustomerSearchDropdown";

export function MergeButton() {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [sourceCustomer, setSourceCustomer] = useState<Customer | null>(null);
  const [targetCustomer, setTargetCustomer] = useState<Customer | null>(null);
  const [mergedName, setMergedName] = useState("");
  const [merging, setMerging] = useState(false);

  function handleOpen() {
    setOpen(true);
    setSourceCustomer(null);
    setTargetCustomer(null);
    setMergedName("");
  }

  async function handleMerge() {
    if (!sourceCustomer || !targetCustomer) {
      alert("请同时选择被合并客户和保留客户");
      return;
    }
    if (sourceCustomer.id === targetCustomer.id) {
      alert("不能选择同一个客户");
      return;
    }

    const keepName = mergedName.trim() || targetCustomer.name;
    const confirmMsg = `确定要合并吗？\n\n被合并：${sourceCustomer.name}（${sourceCustomer.phone}）\n保留为：${keepName}（${targetCustomer.phone}）\n\n合并后「${sourceCustomer.name}」将被删除，所有数据归属到保留客户。`;
    if (!confirm(confirmMsg)) return;

    setMerging(true);

    /* 先更新保留客户的名称（如果需要） */
    if (mergedName.trim() && mergedName.trim() !== targetCustomer.name) {
      const { error: nameErr } = await supabase
        .from("customers")
        .update({ name: mergedName.trim() })
        .eq("id", targetCustomer.id);
      if (nameErr) {
        alert("更新客户名称失败: " + nameErr.message);
        setMerging(false);
        return;
      }
    }

    const { data, error } = await supabase.rpc("merge_customers", {
      source_id: sourceCustomer.id,
      target_id: targetCustomer.id,
    });
    if (error) {
      alert("合并失败: " + error.message);
      setMerging(false);
      return;
    }
    const result = data as { success?: boolean; error?: string };
    if (!result?.success) {
      alert("合并失败: " + (result?.error || "未知错误"));
      setMerging(false);
      return;
    }
    alert("合并成功");
    setOpen(false);
    setSourceCustomer(null);
    setTargetCustomer(null);
    setMergedName("");
    setMerging(false);
    window.location.reload();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="px-4 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
      >
        合并客户
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">合并客户</h2>
              <p className="text-sm text-gray-500 mt-1">
                选择两个客户进行合并，被合并客户的所有数据将归属到保留客户。
              </p>
            </div>

            {/* 被合并客户 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">被合并客户（将被删除）*</label>
              {sourceCustomer ? (
                <div className="flex items-center justify-between bg-red-50 px-4 py-3 rounded-lg">
                  <div>
                    <span className="font-medium text-gray-900">{sourceCustomer.name}</span>
                    <span className="text-sm text-gray-500 ml-2">{sourceCustomer.phone}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSourceCustomer(null); }}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    更换
                  </button>
                </div>
              ) : (
                <CustomerSearchDropdown
                  onSelect={(c) => setSourceCustomer(c)}
                  placeholder="搜索要合并的客户"
                />
              )}
            </div>

            {/* 保留客户 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">保留客户 *</label>
              {targetCustomer ? (
                <div className="flex items-center justify-between bg-green-50 px-4 py-3 rounded-lg">
                  <div>
                    <span className="font-medium text-gray-900">{targetCustomer.name}</span>
                    <span className="text-sm text-gray-500 ml-2">{targetCustomer.phone}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetCustomer(null);
                      setMergedName("");
                    }}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    更换
                  </button>
                </div>
              ) : (
                <CustomerSearchDropdown
                  onSelect={(c) => {
                    setTargetCustomer(c);
                    setMergedName(c.name);
                  }}
                  placeholder="搜索要保留的客户"
                />
              )}
            </div>

            {/* 合并后名称 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">合并后客户名称</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="默认使用保留客户的名称"
                value={mergedName}
                onChange={(e) => setMergedName(e.target.value)}
              />
              <p className="text-xs text-gray-400">不填则保留「{targetCustomer?.name || "保留客户"}」的名称</p>
            </div>

            <div className="bg-orange-50 px-4 py-3 rounded-lg text-sm text-orange-700">
              合并后「被合并客户」将被删除，其车辆、工单、会员等所有数据将归属到保留客户。
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSourceCustomer(null);
                  setTargetCustomer(null);
                  setMergedName("");
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleMerge}
                disabled={merging || !sourceCustomer || !targetCustomer}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {merging ? "合并中..." : "确认合并"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
