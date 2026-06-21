"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

interface 分组 {
  id: string;
  name: string;
}

interface 属性 {
  open: boolean;
  onClose: () => void;
  allowedGroups: string[];
  onSave: (groups: string[]) => void;
}

export default function BlockPermissionModal({ open, onClose, allowedGroups, onSave }: 属性) {
  const supabase = useMemo(() => createClient(), []);
  const [groups, setGroups] = useState<分组[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(allowedGroups));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(allowedGroups));
    setLoading(true);
    supabase
      .from("employee_groups")
      .select("id, name")
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        const list = (data || []).map((g) => ({ id: String(g.id), name: String(g.name || "") }));
        setGroups(list);
        /* 当前段落未设置过权限时，默认选中"管理层"分组 */
        if (allowedGroups.length === 0) {
          const 管理层 = list.find((g) => g.name === "管理层");
          if (管理层) {
            setSelected(new Set([管理层.id]));
          }
        }
        setLoading(false);
      });
  }, [open, allowedGroups, supabase]);

  function toggleGroup(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleSave() {
    setSaving(true);
    onSave([...selected]);
    setSaving(false);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">设置可见分组</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-3">
          未选择任何分组时，该段落对所有可查看本文章的人可见。
        </p>

        <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-2 mb-4">
          {loading ? (
            <div className="text-center text-sm text-gray-400 py-4">加载中...</div>
          ) : groups.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-4">暂无员工分组</div>
          ) : (
            <div className="space-y-1">
              {groups.map((group) => (
                <label
                  key={group.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(group.id)}
                    onChange={() => toggleGroup(group.id)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">{group.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
