import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 处理外部图片 } from "./processExternalImages";

/* 知识库文章的外部图片下载到本地：外链失效/被防盗链是历史痛点 */

interface 块 {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: 块[];
}

function 图块(id: string, url: string): 块 {
  return { id, type: "image", props: { url } };
}

const 原fetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = 原fetch;
});

describe("处理外部图片", () => {
  it("外部图片 → 调代理下载并替换为本地路径", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ path: "/api/media/knowledge/abc.jpg" }), { status: 200 })
    );
    const 结果 = await 处理外部图片([图块("b1", "https://other-site.com/pic.jpg")]);
    expect(结果[0].props.url).toBe("/api/media/knowledge/abc.jpg");
  });

  it("本站 /api/media 路径 → 不处理（排除同源）", async () => {
    const 结果 = await 处理外部图片([图块("b1", "http://localhost:3000/api/media/a.jpg")]);
    expect(结果[0].props.url).toBe("http://localhost:3000/api/media/a.jpg");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("相对路径/空值 → 不处理", async () => {
    const 结果 = await 处理外部图片([图块("b1", "/api/media/a.jpg"), 图块("b2", "")]);
    expect(结果[0].props.url).toBe("/api/media/a.jpg");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("下载失败 → 保留原 URL（不丢图）", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("网络断了"));
    const 结果 = await 处理外部图片([图块("b1", "https://other-site.com/pic.jpg")]);
    expect(结果[0].props.url).toBe("https://other-site.com/pic.jpg");
  });

  it("代理返回错误 → 保留原 URL", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("{}", { status: 500 }));
    const 结果 = await 处理外部图片([图块("b1", "https://other-site.com/pic.jpg")]);
    expect(结果[0].props.url).toBe("https://other-site.com/pic.jpg");
  });

  it("嵌套 children 递归处理", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ path: "/api/media/knowledge/x.jpg" }), { status: 200 })
    );
    const 结果 = await 处理外部图片([
      { id: "p", type: "paragraph", props: {}, children: [图块("c1", "https://other-site.com/deep.jpg")] },
    ]);
    expect(结果[0].children?.[0].props.url).toBe("/api/media/knowledge/x.jpg");
  });

  it("非图片块不动", async () => {
    const 结果 = await 处理外部图片([{ id: "t1", type: "text", props: { url: "https://x.com/a.jpg" } }]);
    expect(结果[0].props.url).toBe("https://x.com/a.jpg");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
