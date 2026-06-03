interface Props {
  hint?: string;
}

/**
 * 扫码取景框组件
 * 显示四角边框、扫描线动画和提示文字
 */
export default function ScanOverlay({ hint = "将条形码对准框内" }: Props) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="relative w-72 h-32">
        {/* 四角边框 */}
        <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-green-400" />
        <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-green-400" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-green-400" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-green-400" />
        {/* 提示文字 */}
        <div className="absolute -top-7 left-0 right-0 text-center">
          <span className="text-xs text-white/80 bg-black/40 px-2 py-0.5 rounded">{hint}</span>
        </div>
        {/* 扫描线动画 */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-green-400/80 animate-scan-line" />
      </div>
    </div>
  );
}
