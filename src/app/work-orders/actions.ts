"use server";

import { clearWorkOrderDataCache } from "@/lib/workOrderData";

/**
 * 清除指定工单的详情页缓存。
 * 编辑需求/项目等媒体后调用，确保 router.refresh() 能拿到最新数据，
 * 避免 30 秒缓存导致刚上传的视频/图片下次打开不显示。
 */
export async function 清除工单缓存(orderId: string): Promise<void> {
  clearWorkOrderDataCache(orderId);
}
