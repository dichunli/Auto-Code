"use client";

interface FormActionsProps {
  loading: boolean;
  disabled: boolean;
  isEmbedded: boolean;
  isEditMode: boolean;
  hasCopyFrom: boolean;
  onSave: () => void;
  onCopyNew: () => void;
  onReload: () => void;
  onCancel: () => void;
}

export default function FormActions({
  loading,
  disabled,
  isEmbedded,
  isEditMode,
  hasCopyFrom,
  onSave,
  onCopyNew,
  onReload,
  onCancel,
}: FormActionsProps) {
  return (
    <div className={`${isEmbedded ? "absolute" : "fixed"} right-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2`}>
      <button
        type="submit"
        disabled={disabled}
        onClick={onSave}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-lg"
      >
        {loading ? (
          <span className="block text-center">保存中...</span>
        ) : (
          <span className="flex flex-col items-center leading-tight">
            <span>保存</span>
            <span className="text-[10px] opacity-80">Ctrl+S</span>
          </span>
        )}
      </button>
      {!isEmbedded && (
        <>
          <button
            type="button"
            disabled={!isEditMode && !hasCopyFrom}
            onClick={onCopyNew}
            className="px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 shadow-lg"
          >
            <span className="flex flex-col items-center leading-tight">
              <span>复制新建</span>
              <span className="text-[10px] opacity-80">Ctrl+Shift+D</span>
            </span>
          </button>
          <button
            type="button"
            onClick={onReload}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-lg"
          >
            <span className="flex flex-col items-center leading-tight">
              <span>重新输入</span>
              <span className="text-[10px] opacity-80">Ctrl+Shift+R</span>
            </span>
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-lg"
      >
        <span className="flex flex-col items-center leading-tight">
          <span>取消</span>
          <span className="text-[10px] opacity-80">Esc</span>
        </span>
      </button>
    </div>
  );
}
