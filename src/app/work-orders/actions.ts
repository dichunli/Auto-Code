"use server";

import { revalidatePath } from "next/cache";
import { clearWorkOrderDataCache } from "@/lib/workOrderData";

/**
 * 清除指定工单的详情页缓存。
 * 编辑需求/项目等媒体后调用，确保 router.refresh() 能拿到最新数据，
 * 避免 30 秒缓存导致刚上传的视频/图片下次打开不显示。
 */
export async function 清除工单缓存(orderId: string): Promise<void> {
  clearWorkOrderDataCache(orderId);
}

/* ═════════════════════════════════════════════════════════════════
 * 工单详情刷新 Server Action
 *
 * 客户端组件（如添加需求弹窗）保存数据后调用本函数，
 * 让工单详情页真正显示最新数据，而不是停留在旧缓存上。
 *
 * 为什么需要它：
 * - workOrderData.ts 有 30 秒内存缓存。客户端单纯调 router.refresh()
 *   会让服务端重新渲染，但 getWorkOrderData 仍命中旧缓存 → 看起来「没更新」。
 * - 这里先清掉该工单的缓存，再 revalidatePath 让 Next.js 重新拉取并渲染。
 * ═════════════════════════════════════════════════════════════════ */
export async function 刷新工单详情(工单id: string) {
  /* 1. 清掉该工单的服务端数据缓存，确保下次查询取最新数据 */
  clearWorkOrderDataCache(工单id);
  /* 2. 让工单详情页路径失效并重新验证，客户端 router.refresh() 时会拿到新数据 */
  revalidatePath(`/work-orders/${工单id}`);
}
