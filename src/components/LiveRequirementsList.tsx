"use client";

import { useEffect, useState, type ReactNode } from "react";
import RequirementTitle from "./RequirementTitle";
import RequirementActions from "./RequirementActions";
import AddRequirementItemsButton from "./AddRequirementItemsButton";
import AssignmentBadge from "./AssignmentBadge";
import LiveItemsList from "./LiveItemsList";

interface 组信息 {
  id: string;
  name: string;
  members: unknown[];
}

interface 新需求 {
  id: string;
  seq: number;
  description?: string | null;
  submitted_by?: string | null;
}

interface 新媒体 {
  media_type: "image" | "video" | "audio";
  storage_path: string;
}

interface Props {
  orderId: string;
  vehicleModelId?: number | null;
  实际锁定: boolean;
  profiles: { id: string; full_name: string }[];
  /* 服务端渲染的现有需求 id 列表：整页刷新后用于清理已入库的追加卡片，防止重复显示 */
  已有需求IDs: string[];
  /* 以下 4 项用于追加需求卡片里的 LiveItemsList（添加项目后立即显示，不整页刷新） */
  mechanicGroups: 组信息[];
  vehicleVin?: string;
  suppliers?: unknown[];
  logisticsCompanies?: unknown[];
  children: ReactNode;
}

/* 需求列表容器（局部更新）：
 * 现有需求由服务端渲染（children 传入），新建需求保存后监听"wo-requirement-added"
 * 事件立即追加卡片，不整页刷新（与配件添加同一模式）。
 * 整页刷新后新需求已在服务端数据中，追加卡片按 id 去重自动移除。 */
export default function LiveRequirementsList({
  orderId,
  vehicleModelId,
  实际锁定,
  profiles,
  已有需求IDs,
  mechanicGroups,
  vehicleVin,
  suppliers = [],
  logisticsCompanies = [],
  children,
}: Props) {
  const [追加需求, 设置追加需求] = useState<{ req: 新需求; media: 新媒体[] }[]>([]);

  // 监听新建需求事件，立即追加卡片
  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as { requirement: 新需求; media?: 新媒体[] };
      设置追加需求((prev) => {
        if (prev.some((r) => r.req.id === detail.requirement.id)) return prev;
        return [...prev, { req: detail.requirement, media: detail.media || [] }];
      });
    }
    window.addEventListener("wo-requirement-added", handle as EventListener);
    return () => window.removeEventListener("wo-requirement-added", handle as EventListener);
  }, []);

  // 监听删除需求事件，追加的卡片也立即移除
  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as { requirementId: string };
      设置追加需求((prev) => prev.filter((r) => r.req.id !== detail.requirementId));
    }
    window.addEventListener("wo-requirement-deleted", handle as EventListener);
    return () => window.removeEventListener("wo-requirement-deleted", handle as EventListener);
  }, []);

  // 整页刷新后：新需求已进服务端数据，从追加列表移除（去重防重复显示）
  const 已有IDs拼串 = 已有需求IDs.join(",");
  useEffect(() => {
    设置追加需求((prev) => prev.filter((r) => !已有需求IDs.includes(r.req.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [已有IDs拼串]);

  const 初始需求数 = 已有需求IDs.length;

  return (
    <div className="divide-y divide-gray-300">
      {children}
      {追加需求.map(({ req, media }, idx) => (
        <div
          key={req.id}
          className="bg-white rounded-xl border border-gray-200 shadow-sm mb-4 overflow-hidden"
        >
          <div className="flex items-center gap-2 flex-wrap px-4 py-3 md:px-6 md:py-4 border-b border-gray-100 bg-gray-50/50">
            <RequirementTitle
              req={req}
              orderId={orderId}
              profiles={profiles}
              media={media}
              项目数={0}
              displaySeq={初始需求数 + idx + 1}
            />
            <AssignmentBadge reqId={req.id} 初始姓名={null} 初始类型={null} />
            <span className="hidden md:inline text-xs text-gray-400">
              提交: {profiles.find((p) => p.id === req.submitted_by)?.full_name || "-"}
            </span>
            {!实际锁定 && (
              <div className="flex items-center gap-2 ml-auto">
                <RequirementActions requirement={req} profiles={profiles} />
                <AddRequirementItemsButton
                  orderId={orderId}
                  requirementId={req.id}
                  vehicleModelId={vehicleModelId}
                />
              </div>
            )}
          </div>
          <div className="px-4 py-3 md:px-6 md:py-4">
            {/* 追加需求也要挂 LiveItemsList：否则"+项目"添加成功后没人接收事件，
             * 界面一直显示"暂无项目"，用户误以为没添加成功，重复添加被"已存在"拦截 */}
            <LiveItemsList
              reqId={req.id}
              需求序号={初始需求数 + idx + 1}
              初始项目数={0}
              已有项目IDs={[]}
              orderId={orderId}
              实际锁定={实际锁定}
              profiles={profiles}
              mechanicGroups={mechanicGroups}
              vehicleModelId={vehicleModelId}
              vehicleVin={vehicleVin}
              suppliers={suppliers}
              logisticsCompanies={logisticsCompanies}
              emptyFallback={
                <p className="text-sm text-gray-400">暂无项目，点右上角&quot;+项目&quot;添加</p>
              }
            />
          </div>
        </div>
      ))}
      {初始需求数 + 追加需求.length === 0 && (
        <div className="px-6 py-8 text-center text-gray-400">暂无需求记录</div>
      )}
    </div>
  );
}
