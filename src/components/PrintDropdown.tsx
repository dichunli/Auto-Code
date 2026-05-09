"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

interface Props {
  orderId: string;
}

const printOptions = [
  { label: "接车单", href: "?type=reception" },
  { label: "派工单", href: "?type=dispatch" },
  { label: "领料单", href: "?type=picking" },
  { label: "退料单", href: "?type=return" },
  { label: "结算单", href: "?type=settlement" },
  { label: "报销单", href: "?type=reimbursement" },
];

export default function PrintDropdown({ orderId }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        打印
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg border border-gray-200 shadow-lg z-50 overflow-hidden">
          {printOptions.map((opt) => (
            <Link
              key={opt.href}
              href={`/work-orders/${orderId}/print${opt.href}`}
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              onClick={() => setOpen(false)}
            >
              {opt.label}
            </Link>
          ))}
          <div className="border-t border-gray-100" />
          <Link
            href={`/work-orders/${orderId}/reimbursement`}
            className="block px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 transition-colors"
            onClick={() => setOpen(false)}
          >
            编辑报销单 →
          </Link>
        </div>
      )}
    </div>
  );
}
