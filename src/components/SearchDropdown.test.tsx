import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchDropdown } from "./SearchDropdown";

/* 通用搜索下拉（待办#11 收敛的基座组件）：
 * 核心行为——防抖搜索/键盘导航/点外关闭/受控值/清除按钮/有值聚焦展开 */

interface 项 {
  id: string;
  name: string;
}

const 测试数据: 项[] = [
  { id: "1", name: "机油滤芯" },
  { id: "2", name: "机油4升" },
];

function 假搜索(q: string): Promise<项[]> {
  return Promise.resolve(测试数据.filter((x) => x.name.includes(q)));
}

function 渲染(额外props: Record<string, unknown> = {}) {
  return render(
    <SearchDropdown<项>
      searchFn={假搜索}
      renderItem={(x) => x.name}
      getKey={(x) => x.id}
      onSelect={vi.fn()}
      {...额外props}
    />
  );
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("SearchDropdown 通用搜索下拉", () => {
  it("输入后防抖搜索并展开结果", async () => {
    渲染();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("搜索..."), "机油");
    await waitFor(() => expect(screen.getByText("机油滤芯")).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText("机油4升")).toBeInTheDocument();
  });

  it("太短/空白输入不搜索", async () => {
    const fn = vi.fn(假搜索);
    render(
      <SearchDropdown<项> searchFn={fn} renderItem={(x) => x.name} getKey={(x) => x.id} onSelect={vi.fn()} />
    );
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("搜索...");
    await user.type(input, " ");
    await new Promise((r) => setTimeout(r, 500));
    expect(fn).not.toHaveBeenCalled();
  });

  it("点击结果触发 onSelect", async () => {
    const onSelect = vi.fn();
    render(
      <SearchDropdown<项> searchFn={假搜索} renderItem={(x) => x.name} getKey={(x) => x.id} onSelect={onSelect} />
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("搜索..."), "机油");
    await waitFor(() => expect(screen.getByText("机油滤芯")).toBeInTheDocument(), { timeout: 3000 });
    await user.click(screen.getByText("机油滤芯"));
    expect(onSelect).toHaveBeenCalledWith(测试数据[0]);
  });

  it("受控模式：value 由外部控制，onQueryChange 通知外部", async () => {
    const onQueryChange = vi.fn();
    render(
      <SearchDropdown<项>
        searchFn={假搜索}
        renderItem={(x) => x.name}
        getKey={(x) => x.id}
        onSelect={vi.fn()}
        value="初始值"
        onQueryChange={onQueryChange}
      />
    );
    expect(screen.getByDisplayValue("初始值")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByDisplayValue("初始值"), "x");
    expect(onQueryChange).toHaveBeenCalled();
  });

  it("showClear：有内容时显示清除按钮，点击清空并回调 onClear", async () => {
    const onClear = vi.fn();
    const onQueryChange = vi.fn();
    render(
      <SearchDropdown<项>
        searchFn={假搜索}
        renderItem={(x) => x.name}
        getKey={(x) => x.id}
        onSelect={vi.fn()}
        value="已选的品牌"
        onQueryChange={onQueryChange}
        showClear
        onClear={onClear}
      />
    );
    const user = userEvent.setup();
    /* 挂载时会先按初始值搜一次（loading 期间清除按钮隐藏），等加载完再点 */
    await waitFor(() => expect(screen.getByTitle("清除")).toBeInTheDocument(), { timeout: 3000 });
    await user.click(screen.getByTitle("清除"));
    expect(onQueryChange).toHaveBeenCalledWith("");
    expect(onClear).toHaveBeenCalled();
  });

  it("Escape 关闭下拉", async () => {
    渲染();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("搜索..."), "机油");
    await waitFor(() => expect(screen.getByText("机油滤芯")).toBeInTheDocument(), { timeout: 3000 });
    await user.keyboard("{Escape}");
    expect(screen.queryByText("机油滤芯")).not.toBeInTheDocument();
  });

  it("键盘上下键移动高亮，回车选中", async () => {
    const onSelect = vi.fn();
    render(
      <SearchDropdown<项> searchFn={假搜索} renderItem={(x) => x.name} getKey={(x) => x.id} onSelect={onSelect} />
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("搜索..."), "机油");
    await waitFor(() => expect(screen.getByText("机油滤芯")).toBeInTheDocument(), { timeout: 3000 });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(测试数据[0]);
  });
});
