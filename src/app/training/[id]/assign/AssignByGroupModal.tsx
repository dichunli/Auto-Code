"use client";

import { useMemo } from "react";

interface 员工 {
  id: string;
  full_name: string;
  group_id?: string | null;
}

interface 分组 {
  id: string;
  name: string;
  description: string | null;
  memberIds: string[];
}

interface 按组分配弹窗属性 {
  open: boolean;
  onClose: () => void;
  groups: 分组[];
  employees: 员工[];
  selectedEmployees: string[];
  onChangeSelected: (selected: string[]) => void;
}

export default function AssignByGroupModal({
  open,
  onClose,
  groups,
  employees,
  selectedEmployees,
  onChangeSelected,
}: 按组分配弹窗属性) {
  const groupStates = useMemo(() => {
    return groups.map((group) => {
      const members = group.memberIds;
      const selectedCount = members.filter((id) => selectedEmployees.includes(id)).length;
      const checked = members.length > 0 && selectedCount === members.length;
      const indeterminate = selectedCount > 0 && selectedCount < members.length;
      return { ...group, checked, indeterminate, selectedCount, totalCount: members.length };
    });
  }, [groups, selectedEmployees]);

  function toggleGroup(memberIds: string[]) {
    const allSelected = memberIds.every((id) => selectedEmployees.includes(id));
    if (allSelected) {
      onChangeSelected(selectedEmployees.filter((id) => !memberIds.includes(id)));
    } else {
      const next = new Set(selectedEmployees);
      memberIds.forEach((id) => next.add(id));
      onChangeSelected([...next]);
    }
  }

  function selectAll() {
    onChangeSelected(employees.map((e) => e.id));
  }

  function clearAll() {
    onChangeSelected([]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50">
      <div className="bg-white rounded-t-xl md:rounded-xl shadow-2xl w-full md:max-w-2xl md:mx-4 flex flex-col h-[80vh] md:h-auto md:max-h-[80vh]">
        {/* 标题栏 */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">按分组选择学员</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              已选 {selectedEmployees.length} 人
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* 快捷操作 */}
        <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={selectAll}
            className="text-xs px-3 py-1.5 rounded-lg bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
          >
            全选所有员工
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs px-3 py-1.5 rounded-lg bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
          >
            清空选择
          </button>
        </div>

        {/* 分组列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {groupStates.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-12">暂无员工分组</div>
          ) : (
            <div className="space-y-2">
              {groupStates.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => toggleGroup(group.memberIds)}
                  className={`w-full text-left border rounded-lg p-3 transition-colors ${
                    group.checked
                      ? "border-blue-500 bg-blue-50"
                      : group.indeterminate
                      ? "border-blue-300 bg-blue-50/50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        group.checked
                          ? "bg-blue-600 border-blue-600"
                          : group.indeterminate
                          ? "bg-blue-600 border-blue-600"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {group.checked && (
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                        </svg>
                      )}
                      {group.indeterminate && !group.checked && (
                        <div className="w-2 h-0.5 bg-white rounded" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900">{group.name}</span>
                        <span className="text-xs text-gray-500">
                          {group.selectedCount}/{group.totalCount} 人
                        </span>
                      </div>
                      {group.description && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{group.description}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
