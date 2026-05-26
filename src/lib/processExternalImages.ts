/* 扫描 content_blocks，将外部图片 URL 下载到本地 */

interface BlockItem {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children?: BlockItem[];
}

/* 判断是否为外部图片 URL */
function 是外部图片(url: string): boolean {
  if (!url) return false;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  /* 排除本地上传的 /api/media 路径（虽然是 http 开头，但属于同一域名） */
  try {
    const parsed = new URL(url);
    /* 如果是当前域名下的 /api/media，不算外部 */
    if (parsed.pathname.startsWith("/api/media/")) return false;
    return true;
  } catch {
    return false;
  }
}

/* 递归扫描并替换外部图片 */
export async function 处理外部图片(blocks: BlockItem[]): Promise<BlockItem[]> {
  const result: BlockItem[] = [];

  for (const block of blocks) {
    const newBlock: BlockItem = { ...block };

    if (block.type === "image" && typeof block.props?.url === "string") {
      const url = block.props.url as string;
      if (是外部图片(url)) {
        try {
          const res = await fetch("/api/proxy-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = await res.json();
          if (res.ok && data.path) {
            newBlock.props = { ...block.props, url: data.path };
          }
        } catch {
          /* 下载失败保留原 URL */
        }
      }
    }

    if (block.children && block.children.length > 0) {
      newBlock.children = await 处理外部图片(block.children);
    }

    result.push(newBlock);
  }

  return result;
}
