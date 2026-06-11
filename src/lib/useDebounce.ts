"use client";

import { useState, useEffect } from "react";

/**
 * 防抖 Hook：输入值变化后延迟指定时间才更新返回值
 * @param value 需要防抖的输入值
 * @param delay 延迟毫秒数，默认 300ms
 * @returns 防抖后的值
 *
 * 用法示例：
 * const [keyword, setKeyword] = useState("");
 * const debouncedKeyword = useDebounce(keyword, 300);
 *
 * useEffect(() => {
 *   // debouncedKeyword 变化 300ms 后才执行
 *   doSearch(debouncedKeyword);
 * }, [debouncedKeyword]);
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
