/* ═════════════════════════════════════════════════════════════════
 * 本地嵌入模型客户端
 *
 * 使用 Transformers.js 在本地运行 multilingual-e5-small 模型
 * - 模型：384 维向量，支持中文，完全离线运行（首次需下载约 120MB）
 * - 替代百度千帆 Embedding-V1 API，不依赖任何外部服务
 * - 模型缓存目录：./.cache/transformers
 * ═════════════════════════════════════════════════════════════════ */

import type { FeatureExtractionPipeline } from "@xenova/transformers";

/* @xenova/transformers 含原生依赖(sharp/onnxruntime)，顶层静态引入会在 build 打包/收集
 * 页面数据时被加载，在部分环境(如 Node24/Windows)编译或加载失败导致 build 报错。
 * 改为"用到时才动态 import"：仅在真正生成向量时加载，build 不再触碰它，功能运行时不变。 */

/* 模型名称 */
const 模型名称 = "Xenova/multilingual-e5-small";

/* 单例缓存：模型只加载一次 */
let 嵌入管道: FeatureExtractionPipeline | null = null;
let 加载中: Promise<FeatureExtractionPipeline | null> | null = null;
let 加载失败: boolean = false;

/* 获取嵌入管道（懒加载 + 单例，避免重复加载） */
async function 获取嵌入管道(): Promise<FeatureExtractionPipeline | null> {
  if (加载失败) return null;
  if (嵌入管道) return 嵌入管道;
  if (加载中) return 加载中;

  加载中 = (async () => {
    /* 动态加载，避免 build 期静态打包原生依赖 */
    const { pipeline, env } = await import("@xenova/transformers");
    env.cacheDir = "./.cache/transformers";
    env.remoteHost = "https://hf-mirror.com"; // 国内用镜像下载模型
    return pipeline("feature-extraction", 模型名称);
  })()
    .then((pipe) => {
      嵌入管道 = pipe;
      加载中 = null;
      console.log("[localEmbedding] 模型加载完成：", 模型名称);
      return pipe;
    })
    .catch((err: unknown): null => {
      加载失败 = true;
      加载中 = null;
      const 错误信息 = err instanceof Error ? err.message : String(err);
      console.error("[localEmbedding] 模型加载失败：", 错误信息);
      return null;
    });

  return 加载中;
}

/* 清除模型缓存（仅用于调试/重置） */
export function 重置模型(): void {
  嵌入管道 = null;
  加载中 = null;
  加载失败 = false;
}

/* 单条文本转向量（查询用） */
export async function 文字转向量(文本: string): Promise<number[]> {
  const 向量数组 = await 批量文字转向量([文本]);
  return 向量数组[0] || [];
}

/* 批量文本转向量（查询用，最多 16 条，每条 ≤ 512 字符）
 * E5 模型：查询时加 "query: " 前缀 */
export async function 批量文字转向量(文本数组: string[]): Promise<number[][]> {
  if (文本数组.length === 0) return [];
  if (文本数组.length > 16) {
    throw new Error(`每次最多 16 条文本，收到 ${文本数组.length} 条`);
  }

  const pipe = await 获取嵌入管道();
  if (!pipe) throw new Error("嵌入模型未就绪，无法生成向量");

  const 带前缀文本 = 文本数组.map((t) => `query: ${t.slice(0, 512)}`);

  try {
    const 结果 = await pipe(带前缀文本, { pooling: "mean", normalize: true });

    /* 转换为 number[][] */
    return 带前缀文本.map((_, i) => {
      const 输出 = Array.isArray(结果) ? 结果[i] : 结果;
      if (!输出) return [];
      return Array.from(输出.data as Float32Array);
    });
  } catch (err: unknown) {
    const 错误信息 = err instanceof Error ? err.message : String(err);
    throw new Error(`向量生成失败：${错误信息}`);
  }
}

/* ═════════════════════════════════════════════════════════════════
 * 文档嵌入（保存文章时使用）
 *
 * 与查询嵌入的区别：使用 "passage: " 前缀（E5 模型区分查询/文档）
 * ═════════════════════════════════════════════════════════════════ */

export async function 文档转向量(文本: string): Promise<number[]> {
  if (!文本) return [];

  const pipe = await 获取嵌入管道();
  if (!pipe) return [];

  try {
    const 结果 = await pipe(`passage: ${文本.slice(0, 512)}`, {
      pooling: "mean",
      normalize: true,
    });
    return Array.from(结果.data as Float32Array);
  } catch (err: unknown) {
    console.warn(
      "[localEmbedding] 文档向量生成失败：",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

/* 生成文章嵌入用的文本（标题 + 内容摘要，≤ 512 字符） */
export function 生成嵌入文本(
  标题: string,
  内容: string,
  内容块?: unknown
): string {
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
      if (typeof obj === "string") {
        文本数组.push(obj);
        return;
      }
      if (Array.isArray(obj)) {
        for (const i of obj) 递归提取(i);
        return;
      }
      if (typeof obj === "object" && obj !== null) {
        const o = obj as Record<string, unknown>;
        if (o.text && typeof o.text === "string") 文本数组.push(o.text);
        if (o.content) 递归提取(o.content);
        if (o.children) 递归提取(o.children);
      }
    };
    递归提取(块);
    return 文本数组.join(" ").slice(0, 500);
  } catch {
    return "";
  }
}
