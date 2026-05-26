"use client";

import { useState } from "react";
import RequirementBatchModal from "./RequirementBatchModal";
import RequirementActions from "./RequirementActions";
import AddRequirementItemsButton from "./AddRequirementItemsButton";

interface Profile {
  id: string;
  full_name?: string | null;
}

interface Requirement {
  id: string;
  seq: number;
  description?: string | null;
  assigned_to?: string | null;
  assigned_to_profile?: { full_name?: string | null } | null;
  assignment_type?: string | null;
}

interface MediaItem {
  id?: string;
  media_type: "image" | "video" | "audio";
  storage_path: string;
}

interface Props {
  req: Requirement;
  orderId: string;
  profiles: Profile[];
  media: MediaItem[];
  isLocked: boolean;
  children?: React.ReactNode;
}

export default function RequirementCard({ req, orderId, profiles, media, isLocked, children }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="px-4 py-3 md:px-6 md:py-4">
        {/* 需求标题行 - 可点击 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-left text-sm text-gray-900 hover:text-blue-600 transition-colors"
          >
            <span className="text-blue-600 mr-1">需求{req.seq}</span>
            <span className="font-medium">{req.description}</span>
          </button>

          {/* 指派状态标签 */}
          {req.assigned_to_profile && req.assignment_type === 'claimed' && (
            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px]">
              领单: {req.assigned_to_profile.full_name}
            </span>
          )}
          {req.assigned_to_profile && req.assignment_type === 'assigned' && (
            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px]">
              指派: {req.assigned_to_profile.full_name}
            </span>
          )}

          {/* 操作按钮 */}
          {!isLocked && (
            <div className="flex items-center gap-2 ml-auto">
              <RequirementActions
                requirement={req}
                profiles={profiles || []}
              />
              <AddRequirementItemsButton orderId={orderId} requirementId={req.id} />
            </div>
          )}
        </div>

        {/* 需求下的项目列表 */}
        {children && <div className="mt-2">{children}</div>}
      </div>

      {/* 详情/编辑弹窗 */}
      <RequirementBatchModal
        open={editing}
        onClose={() => setEditing(false)}
        orderId={orderId}
        requirement={req}
        initialMedia={media || []}
        profiles={profiles}
      />
    </>
  );
}
