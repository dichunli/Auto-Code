import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDebounce } from "./useDebounce";

describe("useDebounce", () => {
  it("初始值立即返回", () => {
    const { result } = renderHook(() => useDebounce("hello", 300));
    expect(result.current).toBe("hello");
  });

  it("值变化后延迟更新", async () => {
    let value = "a";
    const { result, rerender } = renderHook(() => useDebounce(value, 100));

    expect(result.current).toBe("a");

    value = "b";
    rerender();
    expect(result.current).toBe("a"); // 还没更新

    await waitFor(() => expect(result.current).toBe("b"), { timeout: 200 });
  });

  it("连续变化只取最后一次", async () => {
    let value = "a";
    const { result, rerender } = renderHook(() => useDebounce(value, 50));

    value = "b";
    rerender();
    value = "c";
    rerender();
    value = "d";
    rerender();

    await waitFor(() => expect(result.current).toBe("d"), { timeout: 300 });
  });
});
