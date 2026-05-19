"use client";

/* 故障灯图标 — 模拟汽车仪表警示灯形状 */
export default function FaultLightIcon({ type, className = "w-4 h-4" }: { type: string; className?: string }) {
  const common = { className, fill: "none", viewBox: "0 0 24 24" };

  switch (type) {
    case "engine":
      /* 发动机故障灯 — 典型引擎轮廓：顶部弧形+两侧凸起 */
      return (
        <svg {...common}>
          <path d="M4 10h1l1.5-3h5l1.5 3h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );

    case "abs":
      /* ABS灯 — 刹车盘+ABS文字 */
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 8l1.5 1.5M19 8l-1.5 1.5M5 16l1.5-1.5M19 16l-1.5-1.5" stroke="currentColor" strokeWidth="1.5" />
          <text x="12" y="16.5" textAnchor="middle" fontSize="5" fontWeight="bold" fill="currentColor" stroke="none">ABS</text>
        </svg>
      );

    case "airbag":
      /* 气囊灯 — 人形+前方气囊 */
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 22v-6l3-3 3 3v6" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );

    case "oil_pressure":
      /* 机油压力灯 — 油壶滴油 */
      return (
        <svg {...common}>
          <path d="M8 6h8v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V6z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 6l2-2h4l2 2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 17v3M12 21h.01" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );

    case "battery":
      /* 电池灯 — 长方形电池+两电极 */
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M13 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );

    case "coolant":
      /* 水温报警灯 — 温度计+水波纹 */
      return (
        <svg {...common}>
          <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="11.5" cy="17" r="1.5" fill="currentColor" stroke="none" />
          <path d="M5 21h13" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
        </svg>
      );

    case "tire":
      /* 胎压报警灯 — 轮胎截面+感叹号 */
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 0 1 9 9c0 4.97-4.03 9-9 9s-9-4.03-9-9a9 9 0 0 1 9-9z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.5 12h3M17.5 12h3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );

    case "emission":
      /* 排放故障灯 — 发动机轮廓（与发动机灯相同，实际车上就是这样） */
      return (
        <svg {...common}>
          <path d="M4 10h1l1.5-3h5l1.5 3h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );

    case "brake_system":
      /* 刹车系统灯 — 刹车盘（圆圈+括号） */
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 12h3M18 12h3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 9v6M9 12h6" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        </svg>
      );

    case "seatbelt":
      /* 安全带提示灯 — 人形+斜线（安全带） */
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 22v-5l4-3 4 3v5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 22l6-10 6 10" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );

    case "maintenance":
      /* 保养提示灯 — 扳手 */
      return (
        <svg {...common}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );

    case "esp":
      /* ESP/防滑灯 — 车辆+S形轨迹 */
      return (
        <svg {...common}>
          <path d="M8 16l2-4M16 16l-2-4M10 10l4-2 4 2M4 20h16" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 16c1-2 2-3 4-3M20 16c-1-2-2-3-4-3" stroke="currentColor" strokeWidth="1.5" />
          <text x="12" y="22" textAnchor="middle" fontSize="4" fontWeight="bold" fill="currentColor" stroke="none">ESP</text>
        </svg>
      );

    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
  }
}
