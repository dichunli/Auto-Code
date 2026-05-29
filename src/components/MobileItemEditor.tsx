"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/imageCompress";
import ItemImageUploader from "./ItemImageUploader";
import { PartPickerModal } from "./PartPickerModal";
import { OutsourceModal } from "./OutsourceModal";
import BarcodeScanModal from "./BarcodeScanModal";

/* ==================== 类型定义 ==================== */

interface Profile {
  id: string;
  full_name: string;
}

interface MechanicGroup {
  id: string;
  name: string;
  members: { mechanic_id: string; profiles?: { full_name?: string } | null }[];
}

interface ExistingMechanic {
  mechanic_id: string;
  share_pct?: number;
  profiles?: { full_name?: string } | null;
}

interface ConstructionLog {
  id: string;
  action: "start" | "pause" | "resume" | "complete";
  created_at: string;
  mechanic_id: string | null;
}

interface OutsourceOrderItem {
  id: string;
  service_name?: string;
  amount?: number;
}

interface ItemData {
  id: string;
  name: string;
  alias_name?: string | null;
  item_type: string;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  description?: string | null;
  customer_opinion?: string | null;
  is_outsourced?: boolean | null;
  is_customer_part?: boolean | null;
  status?: string | null;
  mechanic_id?: string | null;
  submitter_id?: string | null;
  inspector_id?: string | null;
  service_item_id?: string | null;
  service_items?: { service_name_id?: string | null } | null;
  outsourced_supplier?: { name?: string } | null;
  outsource_order_items?: OutsourceOrderItem[] | null;
}

interface ItemPart {
  id: string;
  name: string;
  part_number: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit: string;
  brand: string;
  specification: string;
  unit_cost?: number | null;
  customer_opinion?: string | null;
  notes?: string | null;
  part_id?: string | null;
  part_name_id?: string | null;
  category?: string | null;
}

interface PartImageRecord {
  storage_path?: string;
  media_type?: string;
}

interface PartNameResult {
  id: string;
  name: string;
  unit: string | null;
  default_quantity: number | null;
}

interface SelectedPartName {
  part_name_id: string;
  name: string;
  unit: string;
  quantity: number | null;
}

interface SelectedRealPart {
  part_id: string;
  part_name_id: string | null;
  name: string;
  part_number: string;
  unit: string;
  brand: string;
  specification: string;
  unit_cost: number | null;
  unit_price: number | null;
  quantity: number | null;
}

interface PresetPart {
  part_name_id: string;
  name: string;
  unit: string;
  quantity: number | null;
}

interface ExistingOrder {
  id: string;
  order_no: string;
  supplier_id: string;
  total_amount: number;
  is_paid: boolean;
  payment_method?: string | null;
  notes?: string | null;
  created_at?: string | null;
  suppliers?: { name: string } | null;
  outsource_order_items?: Array<{
    id: string;
    work_order_item_id: string;
    service_item_id: string;
    service_name: string;
    amount: number;
  }>;
}

interface ExistingItem {
  id: string;
  service_item_id: string;
  service_name: string;
  amount: number;
}

interface PickerPart {
  id: string;
  part_name_id: string | null;
  name: string;
  part_number: string | null;
  unit: string | null;
  part_brands: { name: string } | { name: string }[] | null;
  specification_text: string | null;
  part_specifications: { name: string } | null;
  unit_cost: number | null;
  unit_price: number | null;
  selectedQuantity?: number | null;
}

interface Props {
  item: ItemData;
  orderId: string;
  orderStatus: string;
  profiles: Profile[];
  mechanicGroups: MechanicGroup[];
  existingMechanics: ExistingMechanic[];
  images: string[];
  knowledgeUrl?: string;
  isLocked: boolean;
  parts: ItemPart[];
  vehicleModelId?: string | null;
  existingOrder?: ExistingOrder | null;
  existingItem?: ExistingItem | null;
  partInventory?: Record<string, number>;
  partImages?: Record<string, PartImageRecord[]>;
}

/* ==================== 工具函数 ==================== */

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTime(d: Date) {
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function getConstructionStatus(logs: ConstructionLog[]): "idle" | "running" | "paused" | "completed" {
  if (logs.length === 0) return "idle";
  const last = logs[logs.length - 1];
  if (last.action === "complete") return "completed";
  if (last.action === "pause") return "paused";
  if (last.action === "start" || last.action === "resume") return "running";
  return "idle";
}

function calculateTotalSeconds(logs: ConstructionLog[], now: Date): number {
  let total = 0;
  let startTime: Date | null = null;
  for (const log of logs) {
    const t = new Date(log.created_at);
    if (log.action === "start" || log.action === "resume") {
      startTime = t;
    } else if (log.action === "pause" || log.action === "complete") {
      if (startTime) {
        total += (t.getTime() - startTime.getTime()) / 1000;
        startTime = null;
      }
    }
  }
  if (startTime) {
    total += (now.getTime() - startTime.getTime()) / 1000;
  }
  return Math.max(0, total);
}

function canCancelLastStart(logs: ConstructionLog[]): boolean {
  if (logs.length === 0) return false;
  const last = logs[logs.length - 1];
  if (last.action !== "start" && last.action !== "resume") return false;
  const now = new Date();
  const startTime = new Date(last.created_at);
  return now.getTime() - startTime.getTime() < 60 * 1000;
}

/* ==================== 主组件 ==================== */

export default function MobileItemEditor({
  item,
  orderId,
  orderStatus,
  profiles,
  mechanicGroups,
  existingMechanics,
  images,
  knowledgeUrl,
  isLocked,
  parts,
  vehicleModelId,
  existingOrder,
  existingItem,
  partInventory,
  partImages,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  /* 计时状态 */
  const [logs, setLogs] = useState<ConstructionLog[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  /* 批量草稿 */
  const [draftOpinion, setDraftOpinion] = useState(item.customer_opinion || "pending");
  const [draftCustomerPart, setDraftCustomerPart] = useState(!!item.is_customer_part);

  /* 备注 */
  const [notes, setNotes] = useState(item.description || "");

  /* 施工人子弹窗 */
  const [showMechanicModal, setShowMechanicModal] = useState(false);
  const [mechanicMode, setMechanicMode] = useState<"person" | "group">("person");
  const [selectedPersons, setSelectedPersons] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [commissionRule, setCommissionRule] = useState<"equal" | "byLevel" | "manual">("equal");
  const [manualRatios, setManualRatios] = useState<Record<string, string>>({});
  const [showClaimChoice, setShowClaimChoice] = useState(false);
  const [levelPreview, setLevelPreview] = useState<{ id: string; name: string; coeff: number; ratio: number }[]>([]);
  const [mechanicSortAsc, setMechanicSortAsc] = useState(true);

  /* 配件子弹窗 */
  const [showPartModal, setShowPartModal] = useState(false);
  const [partSearchQuery, setPartSearchQuery] = useState("");
  const [partSearchResults, setPartSearchResults] = useState<PartNameResult[]>([]);
  const [partSearching, setPartSearching] = useState(false);
  const [selectedPartNames, setSelectedPartNames] = useState<SelectedPartName[]>([]);
  const [selectedRealParts, setSelectedRealParts] = useState<SelectedRealPart[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [partTab, setPartTab] = useState<"name" | "inventory">("name");
  const [presetParts, setPresetParts] = useState<PresetPart[]>([]);
  const [presetLoading, setPresetLoading] = useState(false);

  /* 配件库选择 */
  interface InventoryPart {
    id: string;
    part_number: string | null;
    name: string;
    quantity: number;
    unit_price: number | null;
    part_name_id: string | null;
  }
  const [inventoryParts, setInventoryParts] = useState<InventoryPart[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [activeFilterTag, setActiveFilterTag] = useState<string | null>(null);
  const [linkedPartIds, setLinkedPartIds] = useState<Set<string>>(new Set());

  /* 配件库列表搜索 */
  const [inventorySearchQuery, setInventorySearchQuery] = useState("");
  const [inventorySearchResults, setInventorySearchResults] = useState<InventoryPart[]>([]);
  const [inventorySearching, setInventorySearching] = useState(false);
  const [commonTags, setCommonTags] = useState<{ part_name_id: string; name: string }[]>([]);
  const inventorySearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const partSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 外包弹窗 */
  const [showOutsourceModal, setShowOutsourceModal] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);

  /* 弹窗内标签切换 */
  const [activeTab, setActiveTab] = useState<"main" | "parts">("main");

  /* 配件列表展开状态 */
  const [partsExpanded, setPartsExpanded] = useState(false);

  /* 配件详情弹窗 */
  const [selectedPartForDetail, setSelectedPartForDetail] = useState<ItemPart | null>(null);
  const [detailActiveBranchId, setDetailActiveBranchId] = useState<string | null>(null);
  const [detailEditing, setDetailEditing] = useState(false);

  /* 替换配件弹窗 */
  const [replacePartTarget, setReplacePartTarget] = useState<ItemPart | null>(null);

  /* 配件详情弹窗图片上传 */
  const detailFileInputRef = useRef<HTMLInputElement>(null);

  /* 当前用户 */
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  /* 弹窗打开时同步草稿 */
  useEffect(() => {
    if (open) {
      setDraftOpinion(item.customer_opinion || "pending");
      setDraftCustomerPart(!!item.is_customer_part);
      setNotes(item.description || "");
      supabase.auth.getUser().then(({ data }) => {
        setCurrentUserId(data.user?.id || null);
      });
    }
  }, [open, item.customer_opinion, item.is_customer_part, item.description, supabase]);

  /* 加载计时记录 */
  useEffect(() => {
    if (!open || item.item_type !== "labor") return;
    supabase
      .from("work_order_item_construction_logs")
      .select("id, action, created_at, mechanic_id")
      .eq("work_order_item_id", item.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const loaded = (data || []) as ConstructionLog[];
        setLogs(loaded);
        setElapsed(calculateTotalSeconds(loaded, new Date()));
      });
  }, [open, item.id, item.item_type, supabase]);

  /* 实时计时 */
  useEffect(() => {
    const status = getConstructionStatus(logs);
    if (status === "running") {
      timerRef.current = setInterval(() => {
        setElapsed(calculateTotalSeconds(logs, new Date()));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [logs]);

  /* 初始化施工人编辑状态 */
  useEffect(() => {
    if (showMechanicModal) {
      setSelectedPersons(existingMechanics.map((m) => m.mechanic_id));
      setSelectedGroup("");
      setCommissionRule("equal");
      setManualRatios({});
      setLevelPreview([]);
      setShowClaimChoice(false);
      setMechanicMode("person");
    }
  }, [showMechanicModal, existingMechanics]);

  const mechanicIds = mechanicMode === "group" && selectedGroup
    ? (mechanicGroups.find((g) => g.id === selectedGroup)?.members.map((m) => m.mechanic_id) || [])
    : selectedPersons;

  const personCount = mechanicIds.length;
  const isMulti = personCount > 1;

  /* 初始化配件弹窗状态 */
  useEffect(() => {
    if (showPartModal) {
      setPartTab("name");
      setPartSearchQuery("");
      setSelectedPartNames([]);
      setSelectedRealParts([]);
      setPresetParts([]);
      doPartSearch("");

      const serviceNameId = item.service_items?.service_name_id;
      if (serviceNameId) {
        setPresetLoading(true);
        supabase
          .from("service_name_part_names")
          .select("part_name_id, quantity, part_names(id, name, unit, default_quantity)")
          .eq("service_name_id", serviceNameId)
          .order("sort_order", { ascending: true })
          .then(({ data }) => {
            const loaded = (data || [])
              .filter((row: { part_names: { id: string; name: string; unit: string | null; default_quantity: number | null } | null }) => row.part_names)
              .map((row: { part_name_id: string; quantity: number | null; part_names: { id: string; name: string; unit: string | null; default_quantity: number | null } | null }) => ({
                part_name_id: row.part_name_id,
                name: row.part_names!.name,
                unit: row.part_names!.unit || "件",
                quantity: row.quantity ?? row.part_names!.default_quantity ?? null,
              }));
            setPresetParts(loaded);
            setPresetLoading(false);
          });
      }

      /* 加载配件库列表（默认搜索空关键词，展示有库存优先） */
      setInventorySearching(true);
      supabase
        .from("parts")
        .select("id, part_number, name, quantity, unit_price, part_name_id")
        .limit(100)
        .then(({ data }) => {
          const results = (data || []) as InventoryPart[];
          results.sort((a, b) => {
            const aStock = (a.quantity || 0) > 0;
            const bStock = (b.quantity || 0) > 0;
            if (aStock && !bStock) return -1;
            if (!aStock && bStock) return 1;
            return a.name.localeCompare(b.name, "zh-CN");
          });
          setInventorySearchResults(results);
          setInventorySearching(false);
        });

      /* 加载通用常用配件标签（从工单配件记录统计） */
      supabase
        .from("work_order_item_parts")
        .select("part_name_id, name")
        .not("part_name_id", "is", null)
        .limit(200)
        .then(({ data }) => {
          const counts: Record<string, { part_name_id: string; name: string; count: number }> = {};
          for (const row of (data || [])) {
            const id = row.part_name_id as string;
            const name = row.name as string;
            if (!id) continue;
            if (!counts[id]) {
              counts[id] = { part_name_id: id, name, count: 0 };
            }
            counts[id].count++;
          }
          const sorted = Object.values(counts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
          setCommonTags(sorted.map((s) => ({ part_name_id: s.part_name_id, name: s.name })));
        });

      /* 加载与当前车型关联的配件ID */
      if (vehicleModelId) {
        supabase
          .from("part_vehicle_models")
          .select("part_id")
          .eq("vehicle_model_id", vehicleModelId)
          .then(({ data }) => {
            setLinkedPartIds(new Set((data || []).map((d: { part_id: string }) => d.part_id)));
          });
      } else {
        setLinkedPartIds(new Set());
      }
    }
  }, [showPartModal, item.service_items?.service_name_id, vehicleModelId, supabase]);

  /* 按技师等级分配预览 */
  useEffect(() => {
    async function calcPreview() {
      if (commissionRule !== "byLevel" || personCount <= 1) {
        setLevelPreview([]);
        return;
      }
      const ids = mechanicIds;
      if (ids.length === 0) return;
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, mechanic_levels(commission_weight)")
        .in("id", ids);
      const raw = (data || []) as unknown as { id: string; full_name: string; mechanic_levels?: { commission_weight: number } | null }[];
      const rows = raw.map((row) => ({
        id: row.id,
        name: row.full_name,
        coeff: row.mechanic_levels?.commission_weight || 1,
      }));
      const totalCoeff = rows.reduce((sum, r) => sum + r.coeff, 0);
      const preview = rows.map((r) => ({
        ...r,
        ratio: Math.round((r.coeff / totalCoeff) * 100 * 100) / 100,
      }));
      const sumRatio = preview.reduce((s, p) => s + p.ratio, 0);
      if (sumRatio !== 100 && preview.length > 0) {
        preview[0].ratio = Math.round((preview[0].ratio + (100 - sumRatio)) * 100) / 100;
      }
      setLevelPreview(preview);
    }
    calcPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commissionRule, selectedPersons, selectedGroup, mechanicMode]);

  /* 通用刷新 */
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  function togglePerson(id: string) {
    setSelectedPersons((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  /* 批量确认提交 */
  async function handleConfirm() {
    if (loading || isLocked) return;
    setLoading(true);

    const updateData: Record<string, unknown> = {
      customer_opinion: draftOpinion,
      is_customer_part: draftCustomerPart,
      description: notes.trim() || null,
    };

    if (draftCustomerPart !== !!item.is_customer_part && item.service_item_id) {
      const { data: si } = await supabase
        .from("service_items")
        .select("default_price, customer_parts_price")
        .eq("id", item.service_item_id)
        .single();
      if (si) {
        if (draftCustomerPart && si.customer_parts_price != null) {
          updateData.unit_price = si.customer_parts_price;
        } else if (!draftCustomerPart && si.default_price != null) {
          updateData.unit_price = si.default_price;
        }
      }
    }

    const { error } = await supabase.from("work_order_items").update(updateData).eq("id", item.id);
    setLoading(false);

    if (error) {
      alert("保存失败: " + error.message);
      return;
    }

    setOpen(false);
    refresh();
  }

  /* 计算分成比例 */
  function calculateRatios(): Record<string, number> | null {
    const ids = mechanicIds;
    if (ids.length === 0) return null;
    const ratios: Record<string, number> = {};

    if (commissionRule === "equal") {
      const ratio = 100 / ids.length;
      ids.forEach((id) => {
        ratios[id] = Math.round(ratio * 100) / 100;
      });
    } else if (commissionRule === "manual") {
      let total = 0;
      ids.forEach((id) => {
        const val = parseFloat(manualRatios[id]) || 0;
        ratios[id] = val;
        total += val;
      });
      if (Math.abs(total - 100) > 0.01) {
        alert(`分成比例合计为 ${total.toFixed(2)}%，必须为 100%`);
        return null;
      }
    } else {
      if (levelPreview.length > 0) {
        levelPreview.forEach((p) => {
          ratios[p.id] = p.ratio;
        });
      } else {
        const ratio = 100 / ids.length;
        ids.forEach((id) => {
          ratios[id] = Math.round(ratio * 100) / 100;
        });
      }
    }

    const sum = Object.values(ratios).reduce((a, b) => a + b, 0);
    if (sum !== 100 && ids.length > 0) {
      const diff = 100 - sum;
      ratios[ids[0]] = Math.round((ratios[ids[0]] + diff) * 100) / 100;
    }

    return ratios;
  }

  /* 保存施工人指派 */
  async function saveMechanics() {
    if (loading) return;
    const ids = mechanicIds;
    if (ids.length === 0) {
      alert("请选择施工人");
      return;
    }

    const ratios = calculateRatios();
    if (!ratios) return;

    setLoading(true);
    await supabase.from("work_order_item_mechanics").delete().eq("work_order_item_id", item.id);

    const records = ids.map((id) => ({
      work_order_item_id: item.id,
      mechanic_id: id,
      share_pct: ratios[id] ?? 100,
    }));

    const { error } = await supabase.from("work_order_item_mechanics").insert(records);
    setLoading(false);

    if (error) {
      alert("保存失败: " + error.message);
      return;
    }

    setShowMechanicModal(false);
    refresh();
  }

  /* 清除施工人 */
  async function clearMechanics() {
    if (!confirm("确定取消施工指派？")) return;
    setLoading(true);
    const { error } = await supabase
      .from("work_order_item_mechanics")
      .delete()
      .eq("work_order_item_id", item.id);
    setLoading(false);
    if (error) {
      alert("取消失败: " + error.message);
      return;
    }
    setShowMechanicModal(false);
    refresh();
  }

  /* 领单 — 独立完成 */
  async function handleSoloClaim() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert("未登录，无法领单");
      setLoading(false);
      return;
    }
    await supabase.from("work_order_item_mechanics").delete().eq("work_order_item_id", item.id);
    const { error } = await supabase.from("work_order_item_mechanics").insert({
      work_order_item_id: item.id,
      mechanic_id: user.id,
      share_pct: 100,
    });
    setLoading(false);
    if (error) {
      alert("领单失败: " + error.message);
      return;
    }
    setShowMechanicModal(false);
    refresh();
  }

  /* 领单 — 与人合作 */
  async function handleCollaborateClaim() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert("未登录，无法领单");
      return;
    }
    setMechanicMode("person");
    setSelectedPersons((prev) =>
      prev.includes(user.id) ? prev : [...prev, user.id]
    );
    setShowClaimChoice(false);
  }

  /* 放弃领单 */
  async function abandonClaim() {
    if (!currentUserId) return;
    if (!confirm("确定放弃领单？")) return;
    setLoading(true);

    await supabase
      .from("work_order_item_mechanics")
      .delete()
      .eq("work_order_item_id", item.id)
      .eq("mechanic_id", currentUserId);

    const { data: remaining } = await supabase
      .from("work_order_item_mechanics")
      .select("mechanic_id")
      .eq("work_order_item_id", item.id);

    if (remaining && remaining.length > 0) {
      const ratio = 100 / remaining.length;
      for (const r of remaining) {
        await supabase
          .from("work_order_item_mechanics")
          .update({ share_pct: Math.round(ratio * 100) / 100 })
          .eq("work_order_item_id", item.id)
          .eq("mechanic_id", (r as { mechanic_id: string }).mechanic_id);
      }
    }

    setLoading(false);
    refresh();
  }

  /* 计时操作 */
  async function timerAction(action: "start" | "pause" | "resume" | "complete") {
    if (loading) return;
    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const mechanicId = userData.user?.id || null;

    const { error } = await supabase.from("work_order_item_construction_logs").insert({
      work_order_item_id: item.id,
      action,
      mechanic_id: mechanicId,
    });

    if (!error && action === "complete") {
      await supabase.from("work_order_items").update({ status: "completed" }).eq("id", item.id);
    }

    setLoading(false);
    if (error) {
      alert("操作失败: " + error.message);
      return;
    }

    const { data } = await supabase
      .from("work_order_item_construction_logs")
      .select("id, action, created_at, mechanic_id")
      .eq("work_order_item_id", item.id)
      .order("created_at", { ascending: true });
    const loaded = (data || []) as ConstructionLog[];
    setLogs(loaded);
    setElapsed(calculateTotalSeconds(loaded, new Date()));
    refresh();
  }

  /* 取消计时（删除最后一条 start/resume） */
  async function cancelTimer() {
    if (loading) return;
    if (logs.length === 0) return;
    const lastLog = logs[logs.length - 1];
    if (lastLog.action !== "start" && lastLog.action !== "resume") return;

    setLoading(true);
    const { error } = await supabase
      .from("work_order_item_construction_logs")
      .delete()
      .eq("id", lastLog.id);
    setLoading(false);

    if (error) {
      alert("取消失败: " + error.message);
      return;
    }

    const { data } = await supabase
      .from("work_order_item_construction_logs")
      .select("id, action, created_at, mechanic_id")
      .eq("work_order_item_id", item.id)
      .order("created_at", { ascending: true });
    const loaded = (data || []) as ConstructionLog[];
    setLogs(loaded);
    setElapsed(calculateTotalSeconds(loaded, new Date()));
    refresh();
  }

  /* ========== 配件相关 ========== */

  async function doPartSearch(keyword: string) {
    setPartSearching(true);
    let query = supabase
      .from("part_names")
      .select("id, name, unit, default_quantity")
      .order("name")
      .limit(50);
    if (keyword.trim()) {
      query = query.ilike("name", `%${keyword.trim()}%`);
    }
    const { data } = await query;
    setPartSearchResults(data || []);
    setPartSearching(false);
  }

  function handlePartSearchChange(val: string) {
    setPartSearchQuery(val);
    if (partSearchTimer.current) clearTimeout(partSearchTimer.current);
    partSearchTimer.current = setTimeout(() => doPartSearch(val), 300);
  }

  function addPartNameFromSearch(part: PartNameResult) {
    const exists = selectedPartNames.some((sp) => sp.part_name_id === part.id);
    if (exists) {
      removeSelectedPartName(part.id);
      return;
    }
    setSelectedPartNames((prev) => [
      ...prev,
      {
        part_name_id: part.id,
        name: part.name,
        unit: part.unit || "件",
        quantity: part.default_quantity ?? 1,
      },
    ]);
    setPartSearchQuery("");
    setPartSearchResults([]);
  }

  function addPresetPart(preset: PresetPart) {
    const exists = selectedPartNames.some((sp) => sp.part_name_id === preset.part_name_id);
    if (exists) {
      removeSelectedPartName(preset.part_name_id);
      return;
    }
    setSelectedPartNames((prev) => [
      ...prev,
      {
        part_name_id: preset.part_name_id,
        name: preset.name,
        unit: preset.unit,
        quantity: preset.quantity ?? 1,
      },
    ]);
  }

  function removeSelectedPartName(partNameId: string) {
    setSelectedPartNames((prev) => prev.filter((sp) => sp.part_name_id !== partNameId));
  }

  function updatePartNameQuantity(partNameId: string, qty: number | null) {
    setSelectedPartNames((prev) =>
      prev.map((sp) => (sp.part_name_id === partNameId ? { ...sp, quantity: qty } : sp))
    );
  }

  function handlePickerConfirm(pickerParts: PickerPart[]) {
    setSelectedRealParts((prev) => {
      const next = [...prev];
      for (const part of pickerParts) {
        if (next.some((p) => p.part_id === part.id)) continue;
        const pb = part.part_brands;
        const brandName = (Array.isArray(pb) ? pb[0]?.name : pb?.name) || "";
        next.push({
          part_id: part.id,
          part_name_id: part.part_name_id,
          name: part.name,
          part_number: part.part_number || "",
          unit: part.unit || "件",
          brand: brandName,
          specification: part.specification_text || part.part_specifications?.name || "",
          unit_cost: part.unit_cost,
          unit_price: part.unit_price,
          quantity: part.selectedQuantity ?? 1,
        });
      }
      return next;
    });
    setPickerOpen(false);
  }

  function removeSelectedRealPart(partId: string) {
    setSelectedRealParts((prev) => prev.filter((sp) => sp.part_id !== partId));
  }

  /* 配件库搜索 */
  async function doInventorySearch(keyword: string) {
    setInventorySearching(true);
    let query = supabase
      .from("parts")
      .select("id, part_number, name, quantity, unit_price, part_name_id")
      .limit(100);
    if (keyword.trim()) {
      query = query.or(`name.ilike.%${keyword.trim()}%,part_number.ilike.%${keyword.trim()}%`);
    }
    const { data } = await query;
    const results = (data || []) as InventoryPart[];
    results.sort((a, b) => {
      const aStock = (a.quantity || 0) > 0;
      const bStock = (b.quantity || 0) > 0;
      if (aStock && !bStock) return -1;
      if (!aStock && bStock) return 1;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    setInventorySearchResults(results);
    setInventorySearching(false);
  }

  function handleInventorySearchChange(val: string) {
    setInventorySearchQuery(val);
    if (inventorySearchTimer.current) clearTimeout(inventorySearchTimer.current);
    inventorySearchTimer.current = setTimeout(() => doInventorySearch(val), 300);
  }

  /* 扫码成功回调 */
  async function handleBarcodeScan(barcode: string) {
    setShowBarcodeScanner(false);
    const trimmed = barcode.trim();
    if (!trimmed) return;

    setInventorySearchQuery(trimmed);
    setInventorySearching(true);

    /* 按编码精确匹配优先 */
    const query = supabase
      .from("parts")
      .select("id, part_number, name, quantity, unit_price, part_name_id")
      .or(`part_number.ilike.%${trimmed}%,name.ilike.%${trimmed}%`)
      .limit(20);

    const { data } = await query;
    const results = (data || []) as InventoryPart[];

    /* 有库存的排在前面 */
    results.sort((a, b) => {
      const aStock = (a.quantity || 0) > 0;
      const bStock = (b.quantity || 0) > 0;
      if (aStock && !bStock) return -1;
      if (!aStock && bStock) return 1;
      return a.name.localeCompare(b.name, "zh-CN");
    });

    setInventorySearchResults(results);
    setInventorySearching(false);

    /* 如果只有一条结果且未添加，自动选中 */
    if (results.length === 1) {
      const part = results[0];
      const alreadySelected = selectedRealParts.some((sp) => sp.part_id === part.id);
      if (!alreadySelected) {
        addInventoryPart(part);
      }
    }
  }

  function addInventoryPart(part: InventoryPart) {
    const exists = selectedRealParts.some((sp) => sp.part_id === part.id);
    if (exists) return;
    setSelectedRealParts((prev) => [
      ...prev,
      {
        part_id: part.id,
        part_name_id: part.part_name_id,
        name: part.name,
        part_number: part.part_number || "",
        unit: "件",
        brand: "",
        specification: "",
        unit_cost: null,
        unit_price: part.unit_price,
        quantity: 1,
      },
    ]);
  }

  function updateRealPartQuantity(partId: string, qty: number | null) {
    setSelectedRealParts((prev) =>
      prev.map((sp) => (sp.part_id === partId ? { ...sp, quantity: qty } : sp))
    );
  }

  /* 删除已有配件 */
  async function deletePart(partId: string, partName: string) {
    if (!confirm(`确定删除配件「${partName}」？`)) return;
    setLoading(true);
    const { error } = await supabase.from("work_order_item_parts").delete().eq("id", partId);
    setLoading(false);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    setSelectedPartForDetail(null);
    refresh();
  }

  /* 保存配件数量 */
  async function savePartQuantity(partId: string, qty: number) {
    if (qty < 1) {
      alert("数量至少为 1");
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("work_order_item_parts").update({ quantity: qty }).eq("id", partId);
    setLoading(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    if (selectedPartForDetail) {
      setSelectedPartForDetail({ ...selectedPartForDetail, quantity: qty });
    }
    refresh();
  }

  /* 保存配件客户意见 */
  async function savePartOpinion(partId: string, opinion: string) {
    setLoading(true);
    const { error } = await supabase.from("work_order_item_parts").update({ customer_opinion: opinion }).eq("id", partId);
    setLoading(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    if (selectedPartForDetail) {
      setSelectedPartForDetail({ ...selectedPartForDetail, customer_opinion: opinion });
    }
  }

  /* 保存配件备注 */
  async function savePartNotes(partId: string, notes: string) {
    setLoading(true);
    const { error } = await supabase.from("work_order_item_parts").update({ notes: notes.trim() || null }).eq("id", partId);
    setLoading(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    if (selectedPartForDetail) {
      setSelectedPartForDetail({ ...selectedPartForDetail, notes: notes.trim() || null });
    }
  }

  /* 通用保存配件字段 */
  async function savePartField(partId: string, field: string, value: unknown) {
    setLoading(true);
    const { error } = await supabase.from("work_order_item_parts").update({ [field]: value }).eq("id", partId);
    setLoading(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    if (selectedPartForDetail) {
      setSelectedPartForDetail({ ...selectedPartForDetail, [field]: value });
    }
    // 价格/数量变更时刷新工单金额
    if (field === "unit_price" || field === "unit_cost") {
      refresh();
    }
  }

  /* 替换配件 */
  async function handleReplacePart(oldPartId: string, newPart: PickerPart) {
    if (!confirm(`确定将配件替换为「${newPart.name}」？`)) return;
    setLoading(true);

    const pb = newPart.part_brands;
    const brandName = (Array.isArray(pb) ? pb[0]?.name : pb?.name) || "";

    const { error } = await supabase.from("work_order_item_parts").update({
      part_id: newPart.id,
      part_name_id: newPart.part_name_id,
      name: newPart.name,
      part_number: newPart.part_number || "",
      unit: newPart.unit || "件",
      brand: brandName,
      specification: newPart.specification_text || "",
      unit_cost: newPart.unit_cost,
      unit_price: newPart.unit_price,
    }).eq("id", oldPartId);

    setLoading(false);
    setReplacePartTarget(null);

    if (error) {
      alert("替换失败: " + error.message);
      return;
    }

    setSelectedPartForDetail(null);
    refresh();
  }

  /* 上传配件图片 */
  async function uploadPartImage(file: File, branchId: string) {
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }
    setLoading(true);
    try {
      const compressed = await compressImage(file, 300);
      const formData = new FormData();
      formData.append("file", compressed, file.name);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败");

      const { error: dbError } = await supabase.from("work_order_item_part_media").insert({
        work_order_item_part_id: branchId,
        media_type: "image",
        storage_path: result.path,
      });
      if (dbError) throw dbError;

      // 更新本地图片缓存
      if (partImages && result.path) {
        const updated = { ...partImages };
        if (!updated[branchId]) updated[branchId] = [];
        updated[branchId] = [...updated[branchId], { storage_path: result.path, media_type: "image" }];
      }
    } catch (err: unknown) {
      alert("图片上传失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }

  /* 删除配件图片 */
  async function removePartImage(branchId: string, storagePath: string, index: number) {
    setLoading(true);
    const { error } = await supabase
      .from("work_order_item_part_media")
      .delete()
      .eq("work_order_item_part_id", branchId)
      .eq("storage_path", storagePath);
    setLoading(false);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    // 更新本地图片缓存
    if (partImages) {
      const updated = { ...partImages };
      if (updated[branchId]) {
        updated[branchId] = updated[branchId].filter((_, i) => i !== index);
      }
    }
  }

  async function saveParts() {
    const totalCount = selectedPartNames.length + selectedRealParts.length;
    if (totalCount === 0) {
      alert("请至少选择一个配件");
      return;
    }
    setLoading(true);

    const inserts: Record<string, unknown>[] = [];
    for (const sp of selectedPartNames) {
      inserts.push({
        work_order_item_id: item.id,
        part_name_id: sp.part_name_id,
        name: sp.name,
        unit: sp.unit,
        quantity: sp.quantity,
        customer_opinion: "pending",
      });
    }
    for (const sp of selectedRealParts) {
      inserts.push({
        work_order_item_id: item.id,
        part_id: sp.part_id,
        part_name_id: sp.part_name_id,
        part_number: sp.part_number,
        name: sp.name,
        unit: sp.unit,
        brand: sp.brand,
        specification: sp.specification,
        unit_cost: sp.unit_cost,
        unit_price: sp.unit_price,
        quantity: sp.quantity,
        customer_opinion: "pending",
      });
    }

    const { error } = await supabase.from("work_order_item_parts").insert(inserts);
    setLoading(false);

    if (error) {
      alert("添加失败: " + error.message);
      return;
    }

    setShowPartModal(false);
    refresh();
  }

  /* 取消外包 */
  async function cancelOutsource() {
    if (!existingOrder || !existingItem) return;
    const otherItemsCount = (existingOrder.outsource_order_items?.length || 0) - 1;
    const willDeleteOrder = otherItemsCount <= 0;
    const msg = willDeleteOrder
      ? "本项目是外包单中最后一项，移除后将同时删除外包单和相关财务记录。确定吗？"
      : "确定将本项目从外包单中移除吗？";
    if (!confirm(msg)) return;

    setLoading(true);
    try {
      // 清理旧财务记录
      await supabase.from("supplier_transactions").delete().ilike("description", `%${existingOrder.order_no}%`);
      await supabase.from("accounts_payable").delete().ilike("notes", `%${existingOrder.order_no}%`);

      // 删除明细
      const { error: delErr } = await supabase.from("outsource_order_items").delete().eq("id", existingItem.id);
      if (delErr) throw new Error("移除外包项目失败: " + delErr.message);

      // 清理工单项目标记
      const { error: woErr } = await supabase.from("work_order_items").update({
        is_outsourced: false,
        outsourced_supplier_id: null,
      }).eq("id", item.id);
      if (woErr) throw new Error("更新工单项目失败: " + woErr.message);

      if (willDeleteOrder) {
        const { error: orderErr } = await supabase.from("outsource_orders").delete().eq("id", existingOrder.id);
        if (orderErr) throw new Error("删除外包单失败: " + orderErr.message);
      } else {
        const { data: remaining } = await supabase.from("outsource_order_items").select("amount").eq("outsource_order_id", existingOrder.id);
        const newTotal = (remaining as Array<{ amount: number | string }> | null || []).reduce(
          (sum, it) => sum + (parseFloat(String(it.amount)) || 0), 0
        );
        await supabase.from("outsource_orders").update({ total_amount: newTotal }).eq("id", existingOrder.id);
        if (newTotal > 0) {
          if (existingOrder.is_paid) {
            await supabase.from("supplier_transactions").insert({
              supplier_id: existingOrder.supplier_id,
              transaction_type: "payment",
              amount: newTotal,
              description: `外包服务单 ${existingOrder.order_no}`,
            });
          } else {
            await supabase.from("accounts_payable").insert({
              supplier_id: existingOrder.supplier_id,
              amount: newTotal,
              paid_amount: 0,
              status: "pending",
              notes: `外包服务单 ${existingOrder.order_no}`,
            });
          }
        }
      }

      refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  /* ========== 渲染 ========== */

  const status = getConstructionStatus(logs);
  const mechanicNames = existingMechanics.map((m) => m.profiles?.full_name).filter(Boolean);
  const submitterName = profiles.find((p) => p.id === item.submitter_id)?.full_name;
  const inspectorName = profiles.find((p) => p.id === item.inspector_id)?.full_name;
  const isClaimer = currentUserId ? existingMechanics.some((m) => m.mechanic_id === currentUserId) : false;

  const opinionLabel =
    item.customer_opinion === "agree" ? "同意" :
    item.customer_opinion === "reject" ? "拒绝" : "待确认";
  const opinionColor =
    item.customer_opinion === "agree" ? "text-green-600 bg-green-50" :
    item.customer_opinion === "reject" ? "text-red-600 bg-red-50" : "text-gray-600 bg-gray-100";

  const lastPauseLog = status === "paused"
    ? [...logs].reverse().find((l) => l.action === "pause") || null
    : null;

  const cancelable = canCancelLastStart(logs);

  return (
    <>
      {/* 移动端项目卡片 */}
      <div
        className="md:hidden bg-white rounded-lg border border-gray-200 p-3 active:bg-gray-50 transition-colors cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{item.alias_name || item.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${opinionColor}`}>{opinionLabel}</span>
            {item.is_outsourced && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">外包</span>}
            {item.is_customer_part && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700">自带</span>}
            {item.item_type === "labor" && status === "running" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">施工中</span>
            )}
          </div>
          <span className="text-sm font-medium text-gray-900">
            ¥{item.total_price ?? (item.unit_price || 0) * (item.quantity || 1)}
          </span>
        </div>
        {mechanicNames.length > 0 && (
          <div className="text-xs text-gray-500 mt-1">施工人: {mechanicNames.join("、")}</div>
        )}
        {parts.length > 0 ? (
          <div className="mt-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPartsExpanded((v) => !v);
              }}
              className="text-xs text-gray-500 flex items-center gap-1"
            >
              <span>配件: {parts.length} 项</span>
              <svg
                className={`w-3 h-3 transition-transform ${partsExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {partsExpanded && (
              <div className="mt-1.5 space-y-1 pl-2 border-l-2 border-gray-200">
                {parts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPartForDetail(p);
                      setDetailActiveBranchId(p.id);
                    }}
                    className="w-full flex items-center justify-between text-xs py-0.5 text-left"
                  >
                    <div className="min-w-0 flex-1 truncate text-gray-700">
                      {p.name}
                      {p.part_number && <span className="text-gray-400 ml-1">({p.part_number})</span>}
                      {p.brand && <span className="text-gray-400 ml-1">{p.brand}</span>}
                      {p.specification && <span className="text-gray-400 ml-1">{p.specification}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {p.customer_opinion && (
                        <span className={`text-[10px] px-1 py-0.5 rounded ${
                          p.customer_opinion === 'agree' ? 'bg-green-50 text-green-600' :
                          p.customer_opinion === 'reject' ? 'bg-red-50 text-red-600' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {p.customer_opinion === 'agree' ? '同意' : p.customer_opinion === 'reject' ? '拒绝' : '待确认'}
                        </span>
                      )}
                      <span className="text-gray-500">x{p.quantity}</span>
                      <span className="text-gray-500">¥{p.total_price || (p.unit_price * p.quantity)}</span>
                    </div>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                    setShowPartModal(true);
                  }}
                  className="w-full text-left text-xs text-green-600 font-medium py-1"
                >
                  + 配件
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
              setShowPartModal(true);
            }}
            className="mt-1 text-xs text-gray-400 hover:text-blue-600"
          >
            配件：无（点击添加）
          </button>
        )}
        {item.description && (
          <div className="text-xs text-gray-400 mt-1 line-clamp-1">备注: {item.description}</div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {open && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-end">
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />

          {/* 底部面板 */}
          <div className="relative bg-white rounded-t-2xl mx-2 mb-4 max-h-[85dvh] flex flex-col animate-slide-up">
            {/* 头部 */}
            <div className="px-4 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-gray-900 truncate">{item.alias_name || item.name}</h3>
                <div className="flex items-center justify-between text-xs text-gray-500 mt-0.5">
                  <span>
                    {item.item_type === "labor" ? "工时" : item.item_type === "part" ? "配件" : "其他"} · ¥{item.unit_price || 0}
                  </span>
                  <span className="font-medium text-gray-700">
                    小计 ¥{item.total_price || (item.unit_price || 0) * (item.quantity || 1)}
                  </span>
                </div>
                {/* 外包信息 */}
                {item.is_outsourced && item.outsource_order_items && item.outsource_order_items.length > 0 && (
                  <div className="mt-1.5 text-[11px] space-y-0.5">
                    {item.outsource_order_items.map((oi) => (
                      <div key={oi.id} className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">外包</span>
                        <span className="text-gray-600">{oi.service_name}</span>
                        <span className="text-gray-500">¥{oi.amount}</span>
                        {item.outsourced_supplier?.name && (
                          <span className="text-gray-400">{item.outsourced_supplier.name}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-xs text-gray-500 px-1"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={loading || isLocked}
                  className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
                >
                  {loading ? "保存中..." : "确认"}
                </button>
              </div>
            </div>

            {/* 可滚动内容 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
              {/* 施工人 */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-700">施工人</h4>
                </div>
                {existingMechanics.length > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {existingMechanics.map((m, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700">
                        {m.profiles?.full_name || "-"}
                        {m.share_pct != null && m.share_pct !== 100 ? ` ${m.share_pct}%` : ""}
                      </span>
                    ))}
                    {!isLocked && (
                      <>
                        {isClaimer ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setShowMechanicModal(true)}
                              className="text-xs text-green-600 hover:text-green-700"
                            >
                              添加施工人
                            </button>
                            <button
                              type="button"
                              onClick={abandonClaim}
                              disabled={loading}
                              className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                            >
                              放弃领单
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowMechanicModal(true)}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            {existingMechanics.length > 0 ? "修改" : "指派"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">未指派</span>
                    {!isLocked && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowMechanicModal(true)}
                          className="text-xs text-blue-600 hover:text-blue-700"
                        >
                          指派
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowMechanicModal(true); setShowClaimChoice(true); }}
                          className="text-xs text-green-600 hover:text-green-700"
                        >
                          领单
                        </button>
                      </>
                    )}
                  </div>
                )}
              </section>

              {/* 提交人 / 质检人 */}
              {(submitterName || inspectorName) && (
                <section className="flex gap-4 text-xs text-gray-500">
                  {submitterName && <span>提交人: {submitterName}</span>}
                  {inspectorName && <span>质检人: {inspectorName}</span>}
                </section>
              )}

              {/* 计时（仅限工时项目） */}
              {item.item_type === "labor" && !isLocked && (
                <section>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">施工计时</h4>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="text-xl font-mono font-semibold text-gray-900">{formatDuration(elapsed)}</div>
                    <div className="flex gap-2 flex-wrap">
                      {status === "idle" && (
                        <button
                          type="button"
                          onClick={() => timerAction("start")}
                          disabled={loading}
                          className="px-3 py-1.5 text-xs text-white bg-green-600 rounded-lg disabled:opacity-50"
                        >
                          开始
                        </button>
                      )}
                      {status === "running" && (
                        <>
                          <button
                            type="button"
                            onClick={() => timerAction("pause")}
                            disabled={loading}
                            className="px-3 py-1.5 text-xs text-white bg-amber-500 rounded-lg disabled:opacity-50"
                          >
                            暂停
                          </button>
                          <button
                            type="button"
                            onClick={() => timerAction("complete")}
                            disabled={loading}
                            className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
                          >
                            完工
                          </button>
                          {cancelable && (
                            <button
                              type="button"
                              onClick={cancelTimer}
                              disabled={loading}
                              className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg disabled:opacity-50"
                            >
                              取消
                            </button>
                          )}
                        </>
                      )}
                      {status === "paused" && (
                        <>
                          <button
                            type="button"
                            onClick={() => timerAction("resume")}
                            disabled={loading}
                            className="px-3 py-1.5 text-xs text-white bg-green-600 rounded-lg disabled:opacity-50"
                          >
                            继续
                          </button>
                          <button
                            type="button"
                            onClick={() => timerAction("complete")}
                            disabled={loading}
                            className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
                          >
                            完工
                          </button>
                        </>
                      )}
                      {status === "completed" && (
                        <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500">已完工</span>
                      )}
                    </div>
                  </div>
                  {/* 中断状态 */}
                  {status === "paused" && lastPauseLog && (
                    <div className="mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                      已中断 · {formatTime(new Date(lastPauseLog.created_at))}
                    </div>
                  )}
                </section>
              )}

              {/* 客户意见 */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">客户意见</h4>
                <div className="flex gap-2">
                  {(["agree", "pending", "reject"] as const).map((op) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => setDraftOpinion(op)}
                      disabled={isLocked}
                      className={`flex-1 py-2 text-xs rounded-lg border font-medium disabled:opacity-50 ${
                        draftOpinion === op
                          ? op === "agree" ? "bg-green-600 text-white border-green-600" :
                            op === "reject" ? "bg-red-600 text-white border-red-600" :
                            "bg-gray-600 text-white border-gray-600"
                          : "bg-white text-gray-600 border-gray-200"
                      }`}
                    >
                      {op === "agree" ? "同意" : op === "reject" ? "拒绝" : "待确认"}
                    </button>
                  ))}
                </div>
              </section>

              {/* 项目标记 */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">项目标记</h4>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => !isLocked && setShowOutsourceModal(true)}
                    disabled={isLocked}
                    className={`flex-1 py-2 text-xs rounded-lg border font-medium disabled:opacity-50 transition-colors ${
                      existingOrder
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-200"
                    }`}
                  >
                    外包项目
                  </button>
                  <button
                    type="button"
                    onClick={() => !isLocked && setDraftCustomerPart((v) => !v)}
                    disabled={isLocked}
                    className={`flex-1 py-2 text-xs rounded-lg border font-medium disabled:opacity-50 transition-colors ${
                      draftCustomerPart
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-white text-gray-600 border-gray-200"
                    }`}
                  >
                    自带配件
                  </button>
                </div>

                {/* 外包单信息 */}
                {existingOrder && (
                  <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 text-xs">
                    <button
                      type="button"
                      onClick={() => !isLocked && setShowOutsourceModal(true)}
                      disabled={isLocked}
                      className="w-full text-left px-3 py-2 disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-blue-700">{existingOrder.suppliers?.name || "外包供应商"}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${existingOrder.is_paid ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
                          {existingOrder.is_paid ? "已支付" : "未支付"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-blue-500">
                        <span>
                          {existingOrder.created_at
                            ? new Date(existingOrder.created_at).toLocaleDateString("zh-CN")
                            : ""}
                        </span>
                        <span className="font-medium">¥{existingOrder.total_amount}</span>
                      </div>
                    </button>
                    {!isLocked && (
                      <div className="flex border-t border-blue-100">
                        <button
                          type="button"
                          onClick={() => setShowOutsourceModal(true)}
                          className="flex-1 py-1.5 text-center text-blue-600 hover:bg-blue-100 transition-colors"
                        >
                          编辑
                        </button>
                        <div className="w-px bg-blue-100" />
                        <button
                          type="button"
                          onClick={cancelOutsource}
                          disabled={loading}
                          className="flex-1 py-1.5 text-center text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          {loading ? "处理中..." : "取消外包"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* 项目备注 */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">项目备注</h4>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isLocked}
                  rows={2}
                  placeholder="添加备注..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50"
                />
              </section>

              {/* 项目图片 */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">项目图片</h4>
                <ItemImageUploader
                  itemId={item.id}
                  existingImages={images}
                  isLocked={isLocked}
                />
              </section>

              {/* 维修指导 */}
              {knowledgeUrl && (
                <section>
                  <a
                    href={knowledgeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2.5 border border-blue-300 rounded-lg text-sm text-blue-600 bg-blue-50 hover:bg-blue-100"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    查看维修指导
                  </a>
                </section>
              )}

              {/* 项目配件 — 移到底部并高亮 */}
              <section className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-amber-800">项目配件 <span className="text-amber-600 font-normal">({parts.length} 项)</span></h4>
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={() => setShowPartModal(true)}
                      className="text-xs text-blue-600 font-medium px-2 py-1 rounded hover:bg-blue-100 transition-colors"
                    >
                      + 添加配件
                    </button>
                  )}
                </div>
                {parts.length > 0 ? (
                  <div className="space-y-1.5">
                    {parts.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-amber-200 last:border-0">
                        <div className="min-w-0 flex-1">
                          <span className="text-gray-900">{p.name}</span>
                          {p.part_number && <span className="text-gray-500 ml-1">({p.part_number})</span>}
                          {p.brand && <span className="text-gray-500 ml-1">{p.brand}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-gray-600">x{p.quantity}</span>
                          <span className="text-gray-600">¥{p.total_price || (p.unit_price * p.quantity)}</span>
                          {!isLocked && (
                            <button
                              type="button"
                              onClick={() => deletePart(p.id, p.name)}
                              disabled={loading}
                              className="text-[10px] text-red-500 hover:text-red-600 px-1 py-0.5 rounded hover:bg-red-50 disabled:opacity-50"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">暂无配件，点击上方按钮添加</p>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* 施工人选择子弹窗 */}
      {showMechanicModal && (
        <div className="fixed inset-0 z-[110] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMechanicModal(false)} />
          <div className="relative bg-white rounded-t-2xl mx-2 mb-2 max-h-[85vh] flex flex-col animate-slide-up">
            {/* 头部 */}
            <div className="px-4 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="text-base font-semibold text-gray-900">指派施工人</h3>
              <button
                type="button"
                onClick={() => setShowMechanicModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
              >
                ✕
              </button>
            </div>

            {/* 内容 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {/* 领单选择 */}
              {showClaimChoice && (
                <div className="space-y-3 py-2">
                  <p className="text-xs text-gray-500 text-center">请选择领单方式</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={handleSoloClaim}
                      disabled={loading}
                      className="px-3 py-4 text-sm font-medium text-white bg-green-600 rounded-xl disabled:opacity-50"
                    >
                      独立完成
                    </button>
                    <button
                      type="button"
                      onClick={handleCollaborateClaim}
                      disabled={loading}
                      className="px-3 py-4 text-sm font-medium text-white bg-blue-600 rounded-xl disabled:opacity-50"
                    >
                      与人合作
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowClaimChoice(false)}
                    className="w-full px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg"
                  >
                    返回
                  </button>
                </div>
              )}

              {!showClaimChoice && (
                <>
                  {/* 模式切换 */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMechanicMode("person")}
                      className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${mechanicMode === "person" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200"}`}
                    >
                      按人派工
                    </button>
                    <button
                      type="button"
                      onClick={() => setMechanicMode("group")}
                      className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${mechanicMode === "group" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200"}`}
                    >
                      按组派工
                    </button>
                  </div>

                  {/* 按人派工 */}
                  {mechanicMode === "person" && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-gray-500">共 {profiles.length} 人</span>
                        <button
                          type="button"
                          onClick={() => setMechanicSortAsc((v) => !v)}
                          className="text-xs text-blue-600 flex items-center gap-0.5"
                        >
                          {mechanicSortAsc ? "按姓名升序" : "按姓名降序"}
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mechanicSortAsc ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                          </svg>
                        </button>
                      </div>
                      <div className="max-h-[55vh] overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                        {[...profiles].sort((a, b) => {
                          const cmp = a.full_name.localeCompare(b.full_name, "zh-CN");
                          return mechanicSortAsc ? cmp : -cmp;
                        }).map((p) => (
                          <label key={p.id} className="flex items-center gap-2.5 p-2 hover:bg-gray-50 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedPersons.includes(p.id)}
                              onChange={() => togglePerson(p.id)}
                              className="w-4 h-4 accent-blue-600"
                            />
                            <span className="text-sm">{p.full_name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 按组派工 */}
                  {mechanicMode === "group" && (
                    <div className="max-h-[55vh] overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                      {mechanicGroups.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4">暂无施工组</p>
                      )}
                      {mechanicGroups.map((g) => (
                        <label key={g.id} className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer">
                          <input
                            type="radio"
                            name="group"
                            checked={selectedGroup === g.id}
                            onChange={() => setSelectedGroup(g.id)}
                          />
                          <div>
                            <span className="text-sm font-medium">{g.name}</span>
                            <span className="text-xs text-gray-400 ml-2">
                              ({g.members.map((m) => m.profiles?.full_name || "-").join(", ")})
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* 多人分成 */}
                  {isMulti && (
                    <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                      <p className="text-xs font-medium text-yellow-800 mb-2">提成分配（共 {personCount} 人）</p>
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input type="radio" name="commission" checked={commissionRule === "equal"} onChange={() => setCommissionRule("equal")} />
                          <span>平均分配（每人 {Math.round(100 / personCount * 100) / 100}%）</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input type="radio" name="commission" checked={commissionRule === "byLevel"} onChange={() => setCommissionRule("byLevel")} />
                          <span>按技师等级分配</span>
                        </label>
                        {commissionRule === "byLevel" && levelPreview.length > 0 && (
                          <div className="mt-1 ml-5 space-y-0.5 text-xs text-gray-600">
                            {levelPreview.map((p) => (
                              <div key={p.id} className="flex items-center gap-2">
                                <span className="flex-1">{p.name}</span>
                                <span className="text-gray-400">系数 {p.coeff}</span>
                                <span className="text-blue-700 font-medium">{p.ratio}%</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input type="radio" name="commission" checked={commissionRule === "manual"} onChange={() => setCommissionRule("manual")} />
                          <span>手动输入比例</span>
                        </label>
                      </div>
                      {commissionRule === "manual" && (
                        <div className="mt-2 space-y-1.5">
                          {(mechanicMode === "group" && selectedGroup
                            ? mechanicGroups.find((g) => g.id === selectedGroup)?.members.map((m) => ({ id: m.mechanic_id, name: m.profiles?.full_name || "-" })) || []
                            : profiles.filter((p) => selectedPersons.includes(p.id)).map((p) => ({ id: p.id, name: p.full_name }))
                          ).map((m) => (
                            <div key={m.id} className="flex items-center gap-2">
                              <span className="text-xs flex-1">{m.name}</span>
                              <input
                                type="number"
                                className="w-16 px-2 py-1 border border-gray-300 rounded text-xs"
                                placeholder="%"
                                value={manualRatios[m.id] || ""}
                                onChange={(e) => setManualRatios((prev) => ({ ...prev, [m.id]: e.target.value }))}
                              />
                              <span className="text-xs text-gray-500">%</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 按钮 */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowMechanicModal(false)}
                      className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg"
                    >
                      取消
                    </button>
                    {existingMechanics.length > 0 && (
                      <button
                        type="button"
                        onClick={clearMechanics}
                        disabled={loading}
                        className="px-3 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg disabled:opacity-50"
                      >
                        清空
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setShowClaimChoice(true); }}
                      disabled={loading}
                      className="px-3 py-1.5 text-xs text-white bg-green-600 rounded-lg disabled:opacity-50"
                    >
                      领单
                    </button>
                    <button
                      type="button"
                      onClick={saveMechanics}
                      disabled={loading || mechanicIds.length === 0}
                      className="flex-1 px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
                    >
                      {loading ? "保存中..." : "确认"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 配件选择覆盖层（弹窗内滑动） */}
      {showPartModal && (
        <div className="fixed inset-0 z-[110] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPartModal(false)} />
          <div className="relative bg-white rounded-t-2xl mx-2 mb-2 max-h-[92dvh] flex flex-col animate-slide-up">
            {/* 顶部固定：项目信息 */}
            <div className="shrink-0 px-4 pt-4 pb-2 border-b border-gray-100 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowPartModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-gray-900 truncate">{item.alias_name || item.name}</h3>
                <p className="text-xs text-gray-500">
                  {item.item_type === "labor" ? "工时" : item.item_type === "part" ? "配件" : "其他"} ·
                  ¥{item.unit_price || 0} × {item.quantity || 1} = ¥{(item.unit_price || 0) * (item.quantity || 1)}
                </p>
              </div>
            </div>

            {/* Tab 切换 */}
            <div className="shrink-0 flex border-b border-gray-100">
              <button
                type="button"
                onClick={() => setPartTab("name")}
                className={`flex-1 py-2.5 text-xs font-medium text-center transition-colors ${
                  partTab === "name"
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                添加配件名称
              </button>
              <button
                type="button"
                onClick={() => setPartTab("inventory")}
                className={`flex-1 py-2.5 text-xs font-medium text-center transition-colors ${
                  partTab === "inventory"
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                从配件库中选择
              </button>
            </div>

            {/* 可滚动内容区：上半部分 Tab 内容 + 下半部分已选列表 */}
            <div className="flex-1 overflow-y-auto">
              {/* 上半：Tab 内容 */}
              <div className="px-4 py-3">
                {partTab === "name" && (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={partSearchQuery}
                      onChange={(e) => handlePartSearchChange(e.target.value)}
                      onFocus={(e) => {
                        setTimeout(() => {
                          e.target.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 300);
                      }}
                      placeholder="搜索配件名称..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                    {partSearching && <p className="text-xs text-gray-400">搜索中...</p>}
                    {partSearchQuery.trim() && !partSearching && partSearchResults.length === 0 && (
                      <p className="text-xs text-gray-400">未找到匹配配件</p>
                    )}

                    {/* 推荐配件 */}
                    {partSearchQuery.trim() === "" && (
                      <div>
                        {presetLoading ? (
                          <p className="text-xs text-gray-400">加载推荐配件...</p>
                        ) : presetParts.length > 0 ? (
                          <div className="space-y-1.5">
                            <p className="text-xs text-gray-500">推荐配件</p>
                            {presetParts.map((preset) => {
                              const alreadySelected = selectedPartNames.some((sp) => sp.part_name_id === preset.part_name_id);
                              return (
                                <button
                                  key={preset.part_name_id}
                                  type="button"
                                  onClick={() => addPresetPart(preset)}
                                  className={`w-full text-left px-3 py-2 text-sm rounded-lg border border-amber-200 ${
                                    alreadySelected ? "bg-blue-50 border-blue-300 hover:bg-blue-100" : "bg-amber-50 hover:bg-amber-100"
                                  }`}
                                >
                                  <span className="font-medium">{preset.name}</span>
                                  <span className="text-xs text-gray-400 ml-2">单位: {preset.unit}</span>
                                  {preset.quantity != null && <span className="text-xs text-gray-400 ml-2">默认数量: {preset.quantity}</span>}
                                  {alreadySelected && <span className="text-xs text-blue-600 ml-2">已选择 · 点击取消</span>}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* 全部配件 / 搜索结果 */}
                    {partSearchResults.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500">{partSearchQuery.trim() ? "搜索结果" : "配件名称"}</p>
                        {partSearchResults.map((part) => {
                          const alreadySelected = selectedPartNames.some((sp) => sp.part_name_id === part.id);
                          return (
                            <button
                              key={part.id}
                              type="button"
                              onClick={() => addPartNameFromSearch(part)}
                              className={`w-full text-left px-3 py-2 text-sm rounded-lg border-b border-gray-100 last:border-0 ${
                                alreadySelected ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-blue-50"
                              }`}
                            >
                              <span className="font-medium">{part.name}</span>
                              <span className="text-xs text-gray-400 ml-2">单位: {part.unit || "件"}</span>
                              {alreadySelected && <span className="text-xs text-blue-600 ml-2">已选择 · 点击取消</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {partSearchResults.length === 0 && !partSearching && partSearchQuery.trim() === "" && presetParts.length === 0 && (
                      <div className="text-center py-6">
                        <p className="text-xs text-gray-400">暂无配件名称</p>
                      </div>
                    )}
                  </div>
                )}
                {partTab === "inventory" && (
                  <div className="space-y-3">
                    {/* 搜索框 + 扫码 */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inventorySearchQuery}
                        onChange={(e) => handleInventorySearchChange(e.target.value)}
                        onFocus={(e) => {
                          setTimeout(() => {
                            e.target.scrollIntoView({ behavior: "smooth", block: "center" });
                          }, 300);
                        }}
                        placeholder="搜索配件编码或名称..."
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowBarcodeScanner(true)}
                        className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 whitespace-nowrap shrink-0"
                      >
                        扫码
                      </button>
                    </div>

                    {/* 快捷标签 */}
                    <div className="flex flex-wrap gap-1.5">
                      {(presetParts.length > 0 ? presetParts : commonTags).map((tag) => (
                        <button
                          key={tag.part_name_id}
                          type="button"
                          onClick={() => {
                            if (inventorySearchQuery === tag.name) {
                              setInventorySearchQuery("");
                              doInventorySearch("");
                            } else {
                              setInventorySearchQuery(tag.name);
                              doInventorySearch(tag.name);
                            }
                          }}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                            inventorySearchQuery === tag.name
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          {tag.name}
                        </button>
                      ))}
                      {presetParts.length === 0 && commonTags.length === 0 && (
                        <span className="text-xs text-gray-400">加载常用标签...</span>
                      )}
                    </div>

                    {/* 配件列表 */}
                    {inventorySearching ? (
                      <p className="text-xs text-gray-400 text-center py-4">加载中...</p>
                    ) : inventorySearchResults.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">未找到配件</p>
                    ) : (
                      <div className="space-y-1">
                        {inventorySearchResults.map((part) => {
                          const isLinked = linkedPartIds.has(part.id);
                          const hasStock = (part.quantity || 0) > 0;
                          const alreadySelected = selectedRealParts.some((sp) => sp.part_id === part.id);
                          return (
                            <button
                              key={part.id}
                              type="button"
                              onClick={() => !alreadySelected && addInventoryPart(part)}
                              disabled={alreadySelected}
                              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                                alreadySelected
                                  ? "bg-gray-100 border-gray-200 opacity-50"
                                  : isLinked
                                    ? "bg-blue-50 border-blue-200 hover:bg-blue-100"
                                    : "bg-white border-gray-100 hover:bg-gray-50"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium text-gray-900 truncate">
                                    {part.name}
                                    {isLinked && (
                                      <span className="ml-1 text-xs text-blue-600 font-normal">(匹配车型)</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    {part.part_number && <span>编码: {part.part_number} · </span>}
                                    库存:{" "}
                                    <span className={hasStock ? "text-green-600 font-medium" : "text-red-500"}>
                                      {part.quantity || 0}
                                    </span>
                                  </div>
                                </div>
                                <div className="shrink-0 ml-3 text-right">
                                  <div className="text-sm font-medium text-gray-900">
                                    ¥{part.unit_price || 0}
                                  </div>
                                  {alreadySelected && (
                                    <div className="text-[10px] text-gray-400">已添加</div>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 下半：已选配件列表 */}
              {(selectedPartNames.length > 0 || selectedRealParts.length > 0) && (
                <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
                  <p className="text-xs text-gray-500 mb-2">
                    已选择 ({selectedPartNames.length + selectedRealParts.length} 项)
                  </p>
                  <div className="space-y-1.5">
                    {selectedPartNames.map((sp) => (
                      <div key={sp.part_name_id} className="flex items-center gap-2 p-1.5 rounded border border-blue-200 bg-blue-50">
                        <div className="flex-1 min-w-0 text-sm text-gray-900 truncate">{sp.name}</div>
                        <input
                          type="number"
                          min={1}
                          value={sp.quantity ?? ""}
                          onChange={(e) => updatePartNameQuantity(sp.part_name_id, e.target.value === "" ? null : parseInt(e.target.value) || 1)}
                          className="w-12 px-1 py-0.5 border border-gray-200 rounded text-xs text-center"
                        />
                        <span className="text-xs text-gray-500">{sp.unit}</span>
                        <button
                          type="button"
                          onClick={() => removeSelectedPartName(sp.part_name_id)}
                          className="text-xs text-red-600 px-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {selectedRealParts.map((sp) => (
                      <div key={sp.part_id} className="flex items-center gap-2 p-1.5 rounded border border-green-200 bg-green-50">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-900 truncate">{sp.name}</div>
                          <div className="text-[10px] text-gray-500">
                            {sp.part_number && <span>{sp.part_number} · </span>}
                            {sp.brand}
                          </div>
                        </div>
                        <input
                          type="number"
                          min={1}
                          value={sp.quantity ?? ""}
                          onChange={(e) => updateRealPartQuantity(sp.part_id, e.target.value === "" ? null : parseInt(e.target.value) || 1)}
                          className="w-12 px-1 py-0.5 border border-gray-200 rounded text-xs text-center"
                        />
                        <span className="text-xs text-gray-500">{sp.unit}</span>
                        <button
                          type="button"
                          onClick={() => removeSelectedRealPart(sp.part_id)}
                          className="text-xs text-red-600 px-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="shrink-0 px-4 py-3 border-t border-gray-100 flex gap-2">
              <button
                type="button"
                onClick={() => setShowPartModal(false)}
                className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveParts}
                disabled={loading || (selectedPartNames.length === 0 && selectedRealParts.length === 0)}
                className="flex-1 px-4 py-2 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
              >
                {loading ? "保存中..." : "确认添加"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 外包弹窗 */}
      {showOutsourceModal && (
        <OutsourceModal
          open={showOutsourceModal}
          workOrderId={orderId}
          workOrderItemId={item.id}
          currentItemName={item.name}
          serviceItemId={item.service_item_id}
          existingOrder={existingOrder}
          existingItem={existingItem}
          onClose={() => setShowOutsourceModal(false)}
          onSuccess={() => {
            setShowOutsourceModal(false);
            refresh();
          }}
        />
      )}

      {/* 库存配件选择器（三级弹窗） */}
      <PartPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={handlePickerConfirm}
        vehicleModelId={vehicleModelId}
      />

      {/* 配件详情弹窗 */}
      {selectedPartForDetail && (() => {
        const branchParts = selectedPartForDetail.part_name_id
          ? parts.filter((p) => p.part_name_id === selectedPartForDetail.part_name_id)
          : [selectedPartForDetail];
        const activeBranch = branchParts.find((p) => p.id === detailActiveBranchId) || branchParts[0];
        return (
          <div className="fixed inset-0 z-[110] flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedPartForDetail(null)} />
            <div className="relative bg-white rounded-t-2xl mx-2 mb-4 max-h-[85dvh] flex flex-col animate-slide-up">
              {/* 头部 */}
              <div className="px-4 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between shrink-0">
                <h3 className="text-base font-bold text-gray-900 truncate">{activeBranch.name}</h3>
                <div className="flex items-center gap-2">
                  {!isLocked && !detailEditing && (
                    <button
                      type="button"
                      onClick={() => setDetailEditing(true)}
                      className="text-xs text-blue-600 px-2 py-1 rounded hover:bg-blue-50"
                    >
                      编辑
                    </button>
                  )}
                  {!isLocked && detailEditing && (
                    <button
                      type="button"
                      onClick={() => setDetailEditing(false)}
                      className="text-xs text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
                    >
                      取消
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setDetailEditing(false); setSelectedPartForDetail(null); }}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {/* 内容 */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
                {/* 分支选择（多分支时显示） */}
                {branchParts.length > 1 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">选择分支 ({branchParts.length} 个)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {branchParts.map((bp, idx) => (
                        <button
                          key={bp.id}
                          type="button"
                          onClick={() => setDetailActiveBranchId(bp.id)}
                          className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                            bp.id === activeBranch.id
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          分支 {idx + 1}
                          {bp.part_number && <span className="ml-1 opacity-80">({bp.part_number})</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 基本信息 */}
                <div className="space-y-2">
                  {/* 编码 */}
                  {detailEditing ? (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">编码</span>
                      <input
                        type="text"
                        key={activeBranch.id + "-pn"}
                        defaultValue={activeBranch.part_number || ""}
                        onBlur={(e) => {
                          const val = e.target.value.trim() || null;
                          if (val !== (activeBranch.part_number || null)) {
                            savePartField(activeBranch.id, "part_number", val);
                          }
                        }}
                        className="w-32 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                      />
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-gray-500 text-xs">编码</span>
                      <span className="text-gray-900 font-mono text-xs">{activeBranch.part_number || "-"}</span>
                    </div>
                  )}
                  {/* 数量 + 库存 */}
                  <div className="grid grid-cols-2 gap-3">
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">数量</span>
                        <input
                          type="number"
                          min={1}
                          key={activeBranch.id + "-qty"}
                          defaultValue={activeBranch.quantity}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val) && val !== activeBranch.quantity) {
                              savePartQuantity(activeBranch.id, val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">数量</span>
                        <span className="text-gray-900 text-xs">x{activeBranch.quantity}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">库存</span>
                      <span className={`font-medium text-xs ${activeBranch.part_id && partInventory && (partInventory[activeBranch.part_id] || 0) > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {activeBranch.part_id && partInventory ? (partInventory[activeBranch.part_id] || 0) : "-"}
                      </span>
                    </div>
                  </div>
                  {/* 采购价 + 销售价 */}
                  <div className="grid grid-cols-2 gap-3">
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">采购价</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          key={activeBranch.id + "-cost"}
                          defaultValue={activeBranch.unit_cost ?? ""}
                          onBlur={(e) => {
                            const val = e.target.value === "" ? null : parseFloat(e.target.value);
                            if (val !== activeBranch.unit_cost) {
                              savePartField(activeBranch.id, "unit_cost", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">采购价</span>
                        <span className="text-gray-900 text-xs">{activeBranch.unit_cost != null ? `¥${activeBranch.unit_cost}` : "-"}</span>
                      </div>
                    )}
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">销售价</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          key={activeBranch.id + "-price"}
                          defaultValue={activeBranch.unit_price}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val !== activeBranch.unit_price) {
                              savePartField(activeBranch.id, "unit_price", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">销售价</span>
                        <span className="text-gray-900 text-xs">¥{activeBranch.unit_price}</span>
                      </div>
                    )}
                  </div>
                  {/* 单位 + 分类 */}
                  <div className="grid grid-cols-2 gap-3">
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">单位</span>
                        <input
                          type="text"
                          key={activeBranch.id + "-unit"}
                          defaultValue={activeBranch.unit || ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim() || null;
                            if (val !== (activeBranch.unit || null)) {
                              savePartField(activeBranch.id, "unit", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">单位</span>
                        <span className="text-gray-900 text-xs">{activeBranch.unit || "-"}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">分类</span>
                      <span className="text-gray-900 text-xs">{activeBranch.category || "-"}</span>
                    </div>
                  </div>
                  {/* 品牌 + 规格 */}
                  <div className="grid grid-cols-2 gap-3">
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">品牌</span>
                        <input
                          type="text"
                          key={activeBranch.id + "-brand"}
                          defaultValue={activeBranch.brand || ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim() || null;
                            if (val !== (activeBranch.brand || null)) {
                              savePartField(activeBranch.id, "brand", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">品牌</span>
                        <span className="text-gray-900 text-xs">{activeBranch.brand || "-"}</span>
                      </div>
                    )}
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">规格</span>
                        <input
                          type="text"
                          key={activeBranch.id + "-spec"}
                          defaultValue={activeBranch.specification || ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim() || null;
                            if (val !== (activeBranch.specification || null)) {
                              savePartField(activeBranch.id, "specification", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">规格</span>
                        <span className="text-gray-900 text-xs">{activeBranch.specification || "-"}</span>
                      </div>
                    )}
                  </div>
                  {/* 小计 */}
                  <div className="border-t border-gray-100 pt-1.5 flex justify-between"
                  >
                    <span className="font-medium text-gray-700 text-xs"
                    >小计</span>
                    <span className="font-bold text-gray-900 text-sm"
                    >¥{activeBranch.total_price || (activeBranch.unit_price * activeBranch.quantity)}</span>
                  </div>
                </div>

                {/* 图片上传 */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">图片</p>
                  {/* 已上传图片 */}
                  {activeBranch.id && partImages && partImages[activeBranch.id] && partImages[activeBranch.id].length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {partImages[activeBranch.id].map((img, idx) => (
                        <div key={idx} className="relative w-16 h-16 rounded border border-gray-200 overflow-hidden group">
                          <img
                            src={img.storage_path}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          {detailEditing && (
                            <button
                              type="button"
                              onClick={() => removePartImage(activeBranch.id, img.storage_path || "", idx)}
                              disabled={loading}
                              className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 上传按钮 */}
                  {detailEditing && (
                    <>
                      <button
                        type="button"
                        onClick={() => detailFileInputRef.current?.click()}
                        disabled={loading}
                        className={`inline-flex items-center justify-center w-16 h-16 rounded border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50 disabled:pointer-events-none`}
                      >
                        {loading ? (
                          <span className="text-[10px]">...</span>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        )}
                      </button>
                      <input
                        ref={detailFileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = e.target.files;
                          if (!files) return;
                          Array.from(files).forEach((f) => uploadPartImage(f, activeBranch.id));
                          e.target.value = "";
                        }}
                      />
                    </>
                  )}
                </div>

                {/* 客户意见（可编辑） */}
                {detailEditing && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">客户意见</p>
                    <div className="flex gap-2">
                      {(["agree", "pending", "reject"] as const).map((op) => (
                        <button
                          key={op}
                          type="button"
                          onClick={() => savePartOpinion(activeBranch.id, op)}
                          disabled={loading}
                          className={`flex-1 py-2 text-xs rounded-lg border font-medium disabled:opacity-50 ${
                            (activeBranch.customer_opinion || "pending") === op
                              ? op === "agree" ? "bg-green-600 text-white border-green-600" :
                                op === "reject" ? "bg-red-600 text-white border-red-600" :
                                "bg-gray-600 text-white border-gray-600"
                              : "bg-white text-gray-600 border-gray-200"
                          }`}
                        >
                          {op === "agree" ? "同意" : op === "reject" ? "拒绝" : "待确认"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {isLocked && activeBranch.customer_opinion && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">客户意见</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      activeBranch.customer_opinion === 'agree' ? 'bg-green-50 text-green-600' :
                      activeBranch.customer_opinion === 'reject' ? 'bg-red-50 text-red-600' :
                      'bg-gray-100 text-gray-500'
                    }`}>
                      {activeBranch.customer_opinion === 'agree' ? '同意' : activeBranch.customer_opinion === 'reject' ? '拒绝' : '待确认'}
                    </span>
                  </div>
                )}

                {/* 备注（可编辑） */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">备注</p>
                  {!isLocked ? (
                    <textarea
                      key={activeBranch.id + "-notes"}
                      defaultValue={activeBranch.notes || ""}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val !== (activeBranch.notes || "")) {
                          savePartNotes(activeBranch.id, val);
                        }
                      }}
                      rows={2}
                      placeholder="添加备注..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  ) : (
                    <p className="text-sm text-gray-700">{activeBranch.notes || "无备注"}</p>
                  )}
                </div>

                {/* 图片 */}
                {activeBranch.id && partImages && partImages[activeBranch.id] && partImages[activeBranch.id].length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">图片</p>
                    <div className="flex flex-wrap gap-2">
                      {partImages[activeBranch.id].map((img, idx) => (
                        <img
                          key={idx}
                          src={img.storage_path}
                          alt=""
                          className="w-20 h-20 object-cover rounded border border-gray-200"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* 操作按钮 */}
                {detailEditing && (
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setReplacePartTarget(activeBranch);
                        setSelectedPartForDetail(null);
                      }}
                      disabled={loading}
                      className="flex-1 px-3 py-2 text-xs text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                    >
                      替换配件
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePart(activeBranch.id, activeBranch.name)}
                      disabled={loading}
                      className="flex-1 px-3 py-2 text-xs text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
              {/* 底部关闭按钮 */}
              <div className="shrink-0 px-4 py-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setSelectedPartForDetail(null)}
                  className="w-full px-4 py-2.5 text-sm text-white bg-blue-600 rounded-lg"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 替换配件选择器 */}
      {replacePartTarget && (
        <PartPickerModal
          open={true}
          onClose={() => setReplacePartTarget(null)}
          onConfirm={(parts) => {
            if (parts.length > 0) {
              handleReplacePart(replacePartTarget.id, parts[0]);
            }
          }}
          vehicleModelId={vehicleModelId}
          defaultNameQuery={replacePartTarget.name}
          replacedPartName={replacePartTarget.name}
          compact
        />
      )}

      {/* 扫码弹窗 */}
      <BarcodeScanModal
        open={showBarcodeScanner}
        onClose={() => setShowBarcodeScanner(false)}
        onScan={handleBarcodeScan}
      />
    </>
  );
}
