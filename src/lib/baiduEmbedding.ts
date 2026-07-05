/* 百度千帆 Embedding-V1 客户端
 * 使用千帆 OpenAI 兼容接口 + Bearer Token 鉴权
 * 用途：将文字转成 768 维向量，用于语义搜索
 */

const 千帆AK = process.env.QIANFAN_API_KEY || "";

interface Embedding响应 {
  data: Array<{ embedding: number[]; index: number }>;
}

/* 单条文本转向量 */
export async function 文字转向量(文本: string): Promise<number[]> {
  const 向量数组 = await 批量文字转向量([文本]);
  return 向量数组[0] || [];
}

/* 批量文字转向量（最多 16 条，每条 ≤ 512 字符） */
export async function 批量文字转向量(文本数组: string[]): Promise<number[][]> {
  if (文本数组.length === 0) return [];
  if (文本数组.length > 16) {
    throw new Error(`每次最多 16 条文本，收到 ${文本数组.length} 条`);
  }

  if (!千帆AK) throw new Error("缺少千帆 API Key（QIANFAN_API_KEY）");

  const 截断文本 = 文本数组.map((t) => t.slice(0, 512));

  /* 千帆 OpenAI 兼容接口：qianfan.baidubce.com/v2/embeddings */
  const res = await fetch("https://qianfan.baidubce.com/v2/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${千帆AK}`,
    },
    body: JSON.stringify({
      model: "embedding-v1",
      input: 截断文本,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding 请求失败 [${res.status}]: ${errText}`);
  }

  const data: Embedding响应 = await res.json();
  return (data.data || []).map((d) => d.embedding);
}

/* 生成文章嵌入用的文本（标题 + 内容摘要，≤ 512 字符） */
export function 生成嵌入文本(标题: string, 内容: string, 内容块?: unknown): string {
  let 拼接 = 标题 || "";
  if (内容) {
    拼接 += " " + 内容;
  } else if (内容块) {
    拼接 += " " + 提取纯文本(内容块);
  }
  return 拼接.slice(0, 512).trim();
}

function 提取纯文本(块: unknown): string {
  try {
    const 文本数组: string[] = [];
    const 递归提取 = (obj: unknown) => {
      if (typeof obj === "string") { 文本数组.push(obj); return; }
      if (Array.isArray(obj)) { for (const i of obj) 递归提取(i); return; }
      if (typeof obj === "object" && obj !== null) {
        const o = obj as Record<string, unknown>;
        if (o.text && typeof o.text === "string") 文本数组.push(o.text);
        if (o.content) 递归提取(o.content);
        if (o.children) 递归提取(o.children);
      }
    };
    递归提取(块);
    return 文本数组.join(" ").slice(0, 500);
  } catch { return ""; }
}
