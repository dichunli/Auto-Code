interface Props {
  code: string;
}

/**
 * 扫码结果展示组件
 * 在预览区域居中显示识别到的条码内容
 */
export default function ScanResult({ code }: Props) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
      <div className="text-center py-2">
        <div className="text-xs text-white/50 mb-1">识别结果</div>
        <div className="inline-flex items-center gap-2 bg-green-600/20 border border-green-500/40 rounded-lg px-4 py-2">
          <span className="text-lg font-bold text-green-400 tracking-wider font-mono">{code}</span>
        </div>
      </div>
    </div>
  );
}
