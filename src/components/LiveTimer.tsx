"use client";

import { useEffect, useState } from "react";
import { 格式化计时器 } from "@/lib/constructionTime";

/* 动态计时器：以服务端算好的秒数为起点，本地每秒 +1 实时跳动（HH:MM:SS 计时器样式）。
 * 起点秒数来自列表页服务端按施工日志配对计算（施工秒/中断秒）；
 * 挂载后按本地时钟累加，下次刷新页面时重新对齐服务端时间。
 * 仅用于"进行中"的状态（施工中段/中断段都在持续变长），已完成阶段不要用。 */
export default function LiveTimer({
  起始秒,
  className,
}: {
  起始秒: number;
  className?: string;
}) {
  const [已流逝秒, set已流逝秒] = useState(0);

  useEffect(() => {
    const 起点 = Date.now();
    const 定时器 = setInterval(() => {
      set已流逝秒(Math.floor((Date.now() - 起点) / 1000));
    }, 1000);
    return () => clearInterval(定时器);
  }, []);

  return <span className={className}>{格式化计时器(起始秒 + 已流逝秒)}</span>;
}
