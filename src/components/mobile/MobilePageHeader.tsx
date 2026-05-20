"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

interface Props {
  title: string;
  rightAction?: React.ReactNode;
}

export function MobilePageHeader({ title, rightAction }: Props) {
  const router = useRouter();

  return (
    <div className="sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-12 shrink-0">
      <button
        type="button"
        onClick={() => router.back()}
        className="flex items-center gap-1 text-gray-600 -ml-1 px-1"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span className="text-sm">返回</span>
      </button>
      <h1 className="text-base font-semibold text-gray-900 absolute left-1/2 -translate-x-1/2">{title}</h1>
      {rightAction ? (
        <div className="flex items-center gap-2">{rightAction}</div>
      ) : (
        <Link href="/m/" className="flex items-center justify-center w-9 h-9 text-gray-500 hover:text-blue-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </Link>
      )}
    </div>
  );
}
