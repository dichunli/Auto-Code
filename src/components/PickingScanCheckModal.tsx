"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BarcodeScanModal from "@/components/BarcodeScanModal";
import { useToast } from "@/components/Toast";

/* 待核对配件（同一配件多分支/多批次已合并，只扫一次） */
export interface 待核配件 {
  part_id: string;
  名称: string;
  part_number: string | null;
  barcode: string | null;
  /* 本次出库合计数量 */
  数量: number;
}

interface Props {
  open: boolean;
  待核清单: 待核配件[];
  /* 全部核对完成，回传 {part_id: 扫到的码文本} */
  on完成: (扫码记录: Record<string, string>) => void;
  onClose: () => void;
}

/* 扫码核对窗（2026-09-11 出库管控）：含"需扫码出库"配件的领料单提交前，
   必须逐个扫码核对（相机连续扫 / 扫码枪 / 手动输入三通道）。
   匹配口径与打印一致：barcode || part_number || part_id */
export default function PickingScanCheckModal({ open, 待核清单, on完成, onClose }: Props) {
  const { showToast } = useToast();
  /* 已核对：part_id → 扫到的码 */
  const [已核对, 设已核对] = useState<Record<string, string>>({});
  const [相机开, 设相机开] = useState(false);
  const 已核对Ref = useRef(已核对);
  /* ref 同步放 effect（渲染期更新 ref 违反 react-hooks/refs） */
  useEffect(() => {
    已核对Ref.current = 已核对;
  }, [已核对]);

  /* 打开/关闭时重置进度 */
  useEffect(() => {
    if (open) {
      设已核对({});
      设相机开(false);
    }
  }, [open]);

  const 处理扫码 = useCallback(
    (原始码: string) => {
      const 码 = 原始码.trim();
      if (!码) return;
      const 命中 = 待核清单.find(
        (x) => 码 === x.barcode || 码 === x.part_number || 码 === x.part_id
      );
      if (!命中) {
        showToast(`码「${码}」不在本次出库清单里，请核对配件`, "warning");
        return;
      }
      if (已核对Ref.current[命中.part_id]) {
        showToast(`「${命中.名称}」已核对过了`, "warning");
        return;
      }
      设已核对((prev) => ({ ...prev, [命中.part_id]: 码 }));
      showToast(`「${命中.名称}」核对成功`, "success");
    },
    [待核清单, showToast]
  );

  /* 扫码枪通道：靠输入速度判定（每字符<40ms 且回车结尾）。
     复刻 PartPickerModal 的全局监听，相机开着也能用（扫码枪是硬件键盘输入） */
  useEffect(() => {
    if (!open) return;
    let buffer = "";
    let lastTime = 0;
    let fastCount = 0;
    function onKeyDown(e: KeyboardEvent) {
      /* 在输入框里手动打字时不拦截（慢速输入本就不会触发，这里双保险） */
      const 目标 = e.target as HTMLElement | null;
      const 在输入框 = 目标?.tagName === "INPUT" || 目标?.tagName === "TEXTAREA";
      const now = Date.now();
      const gap = now - lastTime;
      lastTime = now;
      if (e.key === "Enter") {
        if (buffer.length >= 3 && fastCount >= buffer.length - 1) {
          e.preventDefault();
          const code = buffer;
          buffer = "";
          fastCount = 0;
          处理扫码(code);
        } else {
          buffer = "";
          fastCount = 0;
        }
        return;
      }
      if (e.key.length === 1) {
        if (gap > 100) {
          buffer = "";
          fastCount = 0;
        }
        buffer += e.key;
        if (gap < 40) {
          fastCount++;
          /* 快速连击（扫码枪）→拦截，避免字符落入其他输入框污染 */
          if (!在输入框) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, 处理扫码]);

  const 全部核对完 = 待核清单.length > 0 && 待核清单.every((x) => 已核对[x.part_id]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">扫码核对出库配件</h3>
          <p className="text-xs text-gray-500 mt-1">
            以下配件设置了「必须扫码才能出库」，请拿到实物后逐个扫码核对，全部核对成功才能提交
          </p>
        </div>

        {/* 待核对清单 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {待核清单.map((x) => {
            const 已扫 = 已核对[x.part_id];
            return (
              <div
                key={x.part_id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                  已扫 ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0 ${
                    已扫 ? "bg-green-500 text-white" : "bg-gray-200 text-gray-400"
                  }`}
                >
                  {已扫 ? "✓" : "?"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {x.名称}
                    <span className="ml-2 text-xs text-gray-500">× {x.数量}</span>
                  </div>
                  <div className="text-xs text-gray-400 truncate">
                    {[x.barcode, x.part_number].filter(Boolean).join(" / ") || "无条码编码（扫配件ID码）"}
                  </div>
                  {已扫 && <div className="text-[10px] text-green-600 mt-0.5">已扫：{已扫}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底栏：三个扫码通道 + 提交 */}
        <div className="border-t border-gray-100 px-5 py-4 space-y-2.5">
          <button
            type="button"
            onClick={() => 设相机开(true)}
            className="w-full px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
          >
            相机扫码（可连续扫）
          </button>
          <p className="text-center text-xs text-gray-400">
            也可以直接用扫码枪扫，或在相机扫码里选手动输入
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => on完成(已核对)}
              disabled={!全部核对完}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40"
            >
              {全部核对完 ? "核对完成，提交出库" : `还差 ${待核清单.filter((x) => !已核对[x.part_id]).length} 个未核对`}
            </button>
          </div>
        </div>
      </div>

      {/* 相机扫码（连续模式，扫一个回调一个） */}
      <BarcodeScanModal
        open={相机开}
        onClose={() => 设相机开(false)}
        onScan={处理扫码}
        连续模式
        标题="扫码核对配件"
      />
    </div>
  );
}
