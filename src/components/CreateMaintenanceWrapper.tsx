"use client";

import { useState } from "react";
import { createClient, 确保有session } from "@/lib/supabase/client";
import { 标记本机操作 } from "@/lib/localEditSignal";
import { 保养单草稿前缀 } from "@/lib/maintenance";

interface Props {
  vehicleId: string;
  customerId: string;
  orderId: string;
  orderNo: string;
  plateNumber: string;
  modelInfo: string;
  customerName: string;
}

export function CreateMaintenanceWrapper({
  vehicleId,
  customerId,
  orderId,
  plateNumber,
  modelInfo,
  customerName,
}: Props) {
  const supabase = createClient();
  const [已有保养单, 设置已有保养单] = useState<{ id: string; order_no: string } | null>(null);
  const [处理中, 设置处理中] = useState(false);

  // 点击：先同步打开空白窗口（防止浏览器拦截弹窗），再异步复制创建
  async function 点击创建() {
    // 必须在用户点击的同步上下文中打开窗口，否则会被浏览器拦截
    const 新窗口 = window.open("", "_blank");
    if (!新窗口) {
      alert("浏览器拦截了新窗口，请允许本站弹窗后重试");
      return;
    }

    设置处理中(true);
    try {
      // 检查是否已有正式保养单（排除 DRAFT- 草稿）
      const { data: 已有 } = await supabase
        .from("work_orders")
        .select("id, order_no")
        .eq("vehicle_id", vehicleId)
        .eq("order_type", "maintenance")
        .not("order_no", "like", 保养单草稿前缀 + "%")
        .limit(1);

      if (已有 && 已有.length > 0) {
        新窗口.close();
        设置已有保养单(已有[0]);
        设置处理中(false);
        return;
      }

      await 确保有session();
      标记本机操作();

      // 删除该车辆旧的未保存草稿（上次创建后直接关窗口残留的）
      await supabase
        .from("work_orders")
        .delete()
        .eq("vehicle_id", vehicleId)
        .eq("order_type", "maintenance")
        .like("order_no", 保养单草稿前缀 + "%");

      // 获取源工单信息
      const { data: 当前工单 } = await supabase
        .from("work_orders")
        .select("mileage_in, customer_complaint")
        .eq("id", orderId)
        .single();

      // 草稿单号：DRAFT- 前缀，保存时才换成正式 BY- 单号
      // 列表和导入都排除 DRAFT- 前缀，直接关窗口的残留等于不存在
      const 草稿单号 = 保养单草稿前缀 + Date.now();

      // 创建保养单草稿（复制工单基本信息）
      const { data: 新工单, error: 创建错误 } = await supabase
        .from("work_orders")
        .insert({
          order_no: 草稿单号,
          vehicle_id: vehicleId,
          customer_id: customerId,
          order_type: "maintenance",
          status: "pending_diagnosis",
          mileage_in: (当前工单 as { mileage_in?: number } | null)?.mileage_in || 0,
          customer_complaint: (当前工单 as { customer_complaint?: string | null } | null)?.customer_complaint || null,
        })
        .select("id")
        .single();

      if (创建错误 || !新工单) {
        新窗口.close();
        alert("创建失败: " + (创建错误?.message || "未返回工单信息"));
        设置处理中(false);
        return;
      }

      const 新工单ID = 新工单.id;

      // ── 复制源工单内容：需求 → 项目 → 配件（白名单列）──

      // 复制需求
      const { data: 源需求列表 } = await supabase
        .from("work_order_requirements")
        .select("id, seq, description, diagnosis, remarks, submitted_by, assigned_to, assignment_type")
        .eq("work_order_id", orderId)
        .order("seq", { ascending: true })
        .order("created_at", { ascending: true });

      const 需求ID映射: Record<string, string> = {};
      if (源需求列表 && 源需求列表.length > 0) {
        for (const 源需求 of 源需求列表) {
          const { data: 新需求 } = await supabase
            .from("work_order_requirements")
            .insert({
              work_order_id: 新工单ID,
              seq: 源需求.seq,
              description: 源需求.description,
              diagnosis: 源需求.diagnosis,
              remarks: 源需求.remarks,
              submitted_by: 源需求.submitted_by,
              assigned_to: 源需求.assigned_to,
              assignment_type: 源需求.assignment_type,
            })
            .select("id")
            .single();
          if (新需求) {
            需求ID映射[源需求.id] = 新需求.id;
          }
        }
      }

      // 复制项目
      const { data: 源项目列表 } = await supabase
        .from("work_order_items")
        .select("id, requirement_id, service_item_id, name, alias_name, item_type, description, quantity, unit_price, mechanic_id, status, customer_opinion, is_outsourced, outsourced_supplier_id, business_type, rework_source_item_id, rework_reason, rework_loss_amount, sort_order, require_qc")
        .eq("work_order_id", orderId)
        .order("created_at", { ascending: true });

      const 项目ID映射: Record<string, string> = {};
      if (源项目列表 && 源项目列表.length > 0) {
        for (const 源项目 of 源项目列表) {
          const 新项目数据: Record<string, unknown> = {
            work_order_id: 新工单ID,
            service_item_id: 源项目.service_item_id,
            name: 源项目.name,
            alias_name: 源项目.alias_name,
            item_type: 源项目.item_type,
            description: 源项目.description,
            quantity: 源项目.quantity,
            unit_price: 源项目.unit_price,
            mechanic_id: 源项目.mechanic_id,
            status: 源项目.status,
            customer_opinion: 源项目.customer_opinion,
            is_outsourced: 源项目.is_outsourced,
            outsourced_supplier_id: 源项目.outsourced_supplier_id,
            business_type: 源项目.business_type,
            rework_source_item_id: 源项目.rework_source_item_id,
            rework_reason: 源项目.rework_reason,
            rework_loss_amount: 源项目.rework_loss_amount,
            sort_order: 源项目.sort_order,
            /* 复制时保留原项目的"必须质检"设置 */
            require_qc: 源项目.require_qc,
          };
          if (源项目.requirement_id && 需求ID映射[源项目.requirement_id]) {
            新项目数据.requirement_id = 需求ID映射[源项目.requirement_id];
          }
          const { data: 新项目 } = await supabase
            .from("work_order_items")
            .insert(新项目数据)
            .select("id")
            .single();
          if (新项目) {
            项目ID映射[源项目.id] = 新项目.id;
          }
        }
      }

      // 复制配件
      const 源项目ID列表 = (源项目列表 || []).map((i: { id: string }) => i.id);
      if (源项目ID列表.length > 0) {
        const { data: 源配件列表 } = await supabase
          .from("work_order_item_parts")
          .select("id, work_order_item_id, part_name_id, part_id, batch_id, part_number, name, alias_name, unit, brand, specification, unit_cost, unit_price, quantity, customer_opinion, is_purchased, is_arrived, supplier_name, logistics_agreement, status, notes, cost_price, is_selected, sort_order, revoke_reason, branch_group_id")
          .in("work_order_item_id", 源项目ID列表)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });

        if (源配件列表 && 源配件列表.length > 0) {
          /* 目录ID映射：源目录 → 新目录。
           * 保养单是新工单，配件目录必须重新生成，不能沿用源工单的目录ID——
           * 否则两单共用目录，切换选中分支/加减分支会跨单互串（已踩坑：BY-20260720-001 等 3 单）。
           * 同组的多个分支仍映射到同一个新目录，保持组内关系。 */
          const 目录映射 = new Map<string, string>();
          const 新配件列表 = 源配件列表
            .filter((源配件) => 项目ID映射[源配件.work_order_item_id])
            .map((源配件) => {
              let 新目录id: string | null = null;
              if (源配件.branch_group_id) {
                if (!目录映射.has(源配件.branch_group_id)) {
                  目录映射.set(源配件.branch_group_id, crypto.randomUUID());
                }
                新目录id = 目录映射.get(源配件.branch_group_id)!;
              }
              return {
              work_order_item_id: 项目ID映射[源配件.work_order_item_id],
              part_name_id: 源配件.part_name_id,
              part_id: 源配件.part_id,
              batch_id: 源配件.batch_id,
              part_number: 源配件.part_number,
              name: 源配件.name,
              alias_name: 源配件.alias_name,
              unit: 源配件.unit,
              brand: 源配件.brand,
              specification: 源配件.specification,
              unit_cost: 源配件.unit_cost,
              unit_price: 源配件.unit_price,
              quantity: 源配件.quantity,
              customer_opinion: 源配件.customer_opinion,
              is_purchased: 源配件.is_purchased,
              is_arrived: 源配件.is_arrived,
              supplier_name: 源配件.supplier_name,
              logistics_agreement: 源配件.logistics_agreement,
              status: 源配件.status,
              notes: 源配件.notes,
              cost_price: 源配件.cost_price,
              is_selected: 源配件.is_selected,
              sort_order: 源配件.sort_order,
              revoke_reason: 源配件.revoke_reason,
              branch_group_id: 新目录id,
            };
            });

          for (let i = 0; i < 新配件列表.length; i += 50) {
            const 批次 = 新配件列表.slice(i, i + 50);
            await supabase.from("work_order_item_parts").insert(批次);
          }
        }
      }

      // 空白窗口跳转到保养单详情页（创建模式 + 编辑模式）
      新窗口.location.href = `/work-orders/${新工单ID}?creating=1&edit=1&from_work_order=${orderId}`;
      设置处理中(false);
    } catch (err: unknown) {
      新窗口.close();
      alert("创建失败: " + (err instanceof Error ? err.message : String(err)));
      设置处理中(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={点击创建}
        disabled={处理中}
        className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
      >
        {处理中 ? "创建中..." : "创建保养单"}
      </button>

      {/* 已有保养单提示 */}
      {已有保养单 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-1">该车辆已有保养单</h3>
            <p className="text-xs text-gray-500 mb-4">
              每辆车只能创建一个保养单，您可以查看或编辑已有的保养单
            </p>

            <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-1 text-sm">
              <div>
                <span className="text-gray-400">车牌: </span>
                <span className="text-gray-800 font-medium">{plateNumber || "—"}</span>
              </div>
              <div>
                <span className="text-gray-400">车型: </span>
                <span className="text-gray-800">{modelInfo || "—"}</span>
              </div>
              <div>
                <span className="text-gray-400">客户: </span>
                <span className="text-gray-800">{customerName || "—"}</span>
              </div>
              <div>
                <span className="text-gray-400">已有保养单: </span>
                <span className="text-gray-800 font-medium">{已有保养单.order_no}</span>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => 设置已有保养单(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  设置已有保养单(null);
                  window.open(`/work-orders/${已有保养单.id}`, "_blank");
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                查看保养单
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
