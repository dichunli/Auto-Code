"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { base64转Blob, 压缩图片 } from "@/lib/imageCompress";
import { 清理搜索词 } from "@/lib/sanitizeQuery";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import ItemImageUploader from "./ItemImageUploader";
import { PartPickerModal } from "./PartPickerModal";
import { OutsourceModal } from "./OutsourceModal";
import BarcodeScanModal from "./BarcodeScanModal";
import ItemStageBadge from "./ItemStageBadge";
import ItemQcActions from "./ItemQcActions";
import { 申领配件, 取消申领 } from "@/app/picking-orders/actions";
import { 申请退料, 取消退料申请 } from "@/app/material-returns/actions";
import { 移除外包明细 } from "@/app/outsource-orders/actions";
import { 删除工单项目, 保存工单项目字段, 保存施工指派, 删除项目施工人, 单人领单, 放弃领单, 更新配件分支, 批量更新配件分支, 添加配件图片记录, 删除配件图片记录, 解析工单配件价格, type 配件分支更新 } from "@/app/work-orders/actions";
import {
  删除配件分支,
  删除配件目录,
  添加配件分支,
  选中配件分支,
  标记采购到货,
  添加工单配件,
} from "@/app/work-orders/parts-actions";
import { ShowCommission } from "./WorkOrderToggleContext";
import { calculateItemCommission, type CommissionSource } from "@/lib/commission";
import { useConfirm } from "./ConfirmDialog";
import type {
  Props,
  ItemPart,
  PartImageRecord,
  PartNameResult,
  SelectedPartName,
  SelectedRealPart,
  PresetPart,
  PickerPart,
  InventoryPart,
  申领行,
  可退领料行,
  退料申请行,
  编码命中配件,
  配件库行,
} from "./mobile-item-editor/types";
import {
  formatDuration,
  formatTime,
  getConstructionStatus,
  canCancelLastStart,
  转命中配件,
} from "./mobile-item-editor/utils";
import { useItemTimer } from "./mobile-item-editor/useItemTimer";
import { ImagePreviewModal } from "./mobile-item-editor/ImagePreviewModal";
import { MechanicAssignModal } from "./mobile-item-editor/MechanicAssignModal";
import { PartPickerSheetModal } from "./mobile-item-editor/PartPickerSheetModal";
import { PartDetailSheetModal } from "./mobile-item-editor/PartDetailSheetModal";
import { toast } from "@/lib/globalToast";

/* ==================== 主组件 ==================== */

export default function MobileItemEditor({
  item,
  orderId,
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
  suppliers = [],
  logisticsCompanies = [],
  returnByPart = {},
  pendingSupplierReturnByPart = {},
  申领ByPart = {},
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  /* 批量草稿 */
  const [draftOpinion, setDraftOpinion] = useState(item.customer_opinion || "pending");
  const [draftCustomerPart, setDraftCustomerPart] = useState(!!item.is_customer_part);

  /* 价格草稿：弹窗内可编辑数量/单价，点"确认"时随其他修改一起保存 */
  const [draftQuantity, setDraftQuantity] = useState(String(item.quantity ?? 1));
  const [draftUnitPrice, setDraftUnitPrice] = useState(item.unit_price != null ? String(item.unit_price) : "");
  /* 每次打开弹窗时重置为项目当前值（防止上次编辑残留） */
  useEffect(() => {
    if (open) {
      setDraftQuantity(String(item.quantity ?? 1));
      setDraftUnitPrice(item.unit_price != null ? String(item.unit_price) : "");
    }
  }, [open, item.quantity, item.unit_price]);

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
  const [linkedPartIds, setLinkedPartIds] = useState<Set<string>>(new Set());

  /* 配件库列表搜索 */
  const [inventorySearchQuery, setInventorySearchQuery] = useState("");
  const [inventorySearchResults, setInventorySearchResults] = useState<InventoryPart[]>([]);
  const [inventorySearching, setInventorySearching] = useState(false);
  const [commonTags, setCommonTags] = useState<{ part_name_id: string; name: string }[]>([]);
  const debouncedPartSearchQuery = useDebounce(partSearchQuery, 300);
  const debouncedInventorySearchQuery = useDebounce(inventorySearchQuery, 300);

  /* 两个搜索 effect 在 doPartSearch/doInventorySearch 定义之后（const 声明不提升，
     依赖数组引用它们必须先定义——见下 ~300 行） */

  /* 外包弹窗 */
  const [showOutsourceModal, setShowOutsourceModal] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);

  /* 弹窗内标签切换 */

  /* 配件列表展开状态 */
  const [partsExpanded, setPartsExpanded] = useState(false);

  /* 实时同步：别人改配件字段(价格/数量/选中/意见等)后，WorkOrderRealtimeSync 广播
     wo-part-update(fromRealtime)。移动端把这些新值合并到本地显示，秒级更新、不刷屏。
     注意：只合并"已存在分支的字段改动"，不处理加/删分支（那些走顶部提示条整页刷新）。 */
  const [实时覆盖, set实时覆盖] = useState<Record<string, Partial<ItemPart>>>({});
  useEffect(() => { set实时覆盖({}); }, [parts]); // 整页刷新后以 prop 为准，清空覆盖
  useEffect(() => {
    function onRealtime(e: Event) {
      const d = (e as CustomEvent).detail as (Partial<ItemPart> & { partId?: string; fromRealtime?: boolean }) | null;
      if (!d || !d.fromRealtime || !d.partId) return;
      const pid = d.partId;
      set实时覆盖((prev) => {
        const patch: Partial<ItemPart> = {};
        if (d.unit_price !== undefined) patch.unit_price = d.unit_price;
        if (d.unit_cost !== undefined) patch.unit_cost = d.unit_cost as number | null;
        if (d.cost_price !== undefined) patch.cost_price = d.cost_price as number | null;
        if (d.quantity !== undefined) patch.quantity = d.quantity;
        if (d.is_selected !== undefined) patch.is_selected = d.is_selected;
        if (d.part_number !== undefined) patch.part_number = d.part_number;
        if (d.brand !== undefined) patch.brand = d.brand;
        if (d.specification !== undefined) patch.specification = d.specification;
        if (d.supplier_name !== undefined) patch.supplier_name = d.supplier_name;
        if (d.customer_opinion !== undefined) patch.customer_opinion = d.customer_opinion;
        if (d.is_purchased !== undefined) patch.is_purchased = d.is_purchased;
        if (d.is_arrived !== undefined) patch.is_arrived = d.is_arrived;
        return { ...prev, [pid]: { ...prev[pid], ...patch } };
      });
    }
    window.addEventListener("wo-part-update", onRealtime as EventListener);
    return () => window.removeEventListener("wo-part-update", onRealtime as EventListener);
  }, []);

  const parts合并 = useMemo(
    () => parts.map((p) => (实时覆盖[p.id] ? { ...p, ...实时覆盖[p.id] } : p)),
    [parts, 实时覆盖]
  );

  /* 按"配件名称目录"(branch_group_id)分组：同一目录的分支归一组，同名也能是独立目录 */
  const partGroups = useMemo(() => {
    const map = new Map<string, ItemPart[]>();
    for (const p of parts合并) {
      const key = p.branch_group_id || p.part_name_id || p.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.values()).map((items) => ({
      name: items[0].name,
      parts: items,
    }));
  }, [parts合并]);

  /* 配件详情弹窗 */
  const [selectedPartForDetail, setSelectedPartForDetail] = useState<ItemPart | null>(null);
  const [detailActiveBranchId, setDetailActiveBranchId] = useState<string | null>(null);
  const [detailEditing, setDetailEditing] = useState(false);

  /* 配件图片本地覆盖：上传/删除后立即更新抽屉显示（props 要等整页刷新才变），
   * props 刷新（partImages 变化）后清空覆盖、以服务端数据为准 */
  const [本地图片覆盖, set本地图片覆盖] = useState<Record<string, PartImageRecord[]>>({});
  useEffect(() => { set本地图片覆盖({}); }, [partImages]);
  function 分支图片(branchId: string): PartImageRecord[] {
    return 本地图片覆盖[branchId] ?? (partImages?.[branchId] ?? []);
  }
  /* 图片大图预览 */
  const [预览图片, set预览图片] = useState<string | null>(null);

  /* 配件编辑态：编码智能候选 / 扫码 / 按名称搜配件（同桌面端分支编辑） */
  const [编码查询, 设编码查询] = useState("");
  const [编码候选, 设编码候选] = useState<编码命中配件[]>([]);
  const [detailScanOpen, setDetailScanOpen] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const debounced编码查询 = useDebounce(编码查询, 300);

  /* 配件申领：展开申领面板 / 申领数量 / 该分支待出库申领列表（面板展开时拉取） */
  const [申领展开, set申领展开] = useState(false);
  const [申领数量, set申领数量] = useState("1");
  const [申领列表, set申领列表] = useState<申领行[]>([]);

  /* 退料申请：展开退料面板 / 退料数量 / 退料类型 / 选中的领料记录 / 可退领料列表 / 待确认退料申请（面板展开时拉取） */
  const [退料展开, set退料展开] = useState(false);
  const [退料数量, set退料数量] = useState("1");
  const [退料类型, set退料类型] = useState("excess");
  const [选中领料记录id, set选中领料记录id] = useState("");
  const [可退领料列表, set可退领料列表] = useState<(可退领料行 & { 可退: number })[]>([]);
  const [退申请列表, set退申请列表] = useState<退料申请行[]>([]);

  /* 替换配件弹窗 */
  const [replacePartTarget, setReplacePartTarget] = useState<ItemPart | null>(null);

  /* 添加分支弹窗（给当前配件名称新增一个具体配件分支） */
  const [addBranchTarget, setAddBranchTarget] = useState<ItemPart | null>(null);

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
      supabase.auth.getSession().then(({ data: sessionData }) => {
        setCurrentUserId(sessionData.session?.user?.id || null);
      });
    }
  }, [open, item.customer_opinion, item.is_customer_part, item.description, supabase]);

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

  /* useMemo 固定引用：group 模式下 .map() 每次渲染都产新数组，
     不包一层会让下游 effect（按等级提成预览等）每次渲染都重跑 */
  const mechanicIds = useMemo(() => mechanicMode === "group" && selectedGroup
    ? (mechanicGroups.find((g) => g.id === selectedGroup)?.members.map((m) => m.mechanic_id) || [])
    : selectedPersons, [mechanicMode, selectedGroup, mechanicGroups, selectedPersons]);

  const personCount = mechanicIds.length;
  const isMulti = personCount > 1;

  /* ========== 配件相关 ========== */

  const doPartSearch = useCallback(async (keyword: string) => {
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
  }, [supabase]);

  /* 库存配件搜索（2026-09-15 从下方 function 声明挪来并改 useCallback：
     effect 依赖数组引用它，const 必须先定义） */
  const doInventorySearch = useCallback(async (keyword: string) => {
    setInventorySearching(true);
    let query = supabase
      .from("parts")
      .select("id, part_number, name, quantity, unit_price, part_name_id")
      .limit(100);
    if (keyword.trim()) {
      query = query.or(`name.ilike.%${清理搜索词(keyword)}%,part_number.ilike.%${清理搜索词(keyword)}%`);
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
  }, [supabase]);

  useEffect(() => {
    doPartSearch(debouncedPartSearchQuery);
  }, [debouncedPartSearchQuery, doPartSearch]);

  useEffect(() => {
    doInventorySearch(debouncedInventorySearchQuery);
  }, [debouncedInventorySearchQuery, doInventorySearch]);

  /* 初始化配件弹窗状态 */
  useEffect(() => {
    if (showPartModal) {
      setPartTab("name");
      setPartSearchQuery("");
      setSelectedPartNames([]);
      setSelectedRealParts([]);
      setPresetParts([]);
      doPartSearch("");

      const serviceItemId = item.service_item_id;
      if (serviceItemId) {
        setPresetLoading(true);
        supabase
          .from("service_item_part_names")
          .select("part_name_id, quantity, part_names(id, name, unit, default_quantity)")
          .eq("service_item_id", serviceItemId)
          .order("sort_order", { ascending: true })
          .then(({ data }) => {
            const loaded = ((data || []) as unknown as { part_name_id: string; quantity: number | null; part_names: { id: string; name: string; unit: string | null; default_quantity: number | null } | null }[])
              .filter((row) => row.part_names)
              .map((row) => ({
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
  }, [showPartModal, item.service_item_id, vehicleModelId, supabase, doPartSearch]);

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
     
  }, [commissionRule, selectedPersons, selectedGroup, mechanicMode, mechanicIds, personCount, supabase]);

  /* 通用刷新 */
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  /* 施工计时：日志加载/秒表/开始暂停完工取消 抽到独立 Hook（行为不变） */
  const { logs, elapsed, timerAction, cancelTimer } = useItemTimer({
    open,
    itemId: item.id,
    itemType: item.item_type,
    supabase,
    loading,
    setLoading,
    refresh,
  });

  function togglePerson(id: string) {
    setSelectedPersons((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  /* 批量确认提交 */
  async function handleConfirm() {
    if (loading || isLocked) return;
    setLoading(true);

    const updateData: {
      customer_opinion?: string | null;
      is_customer_part?: boolean;
      description?: string | null;
      unit_price?: number;
      quantity?: number;
    } = {
      customer_opinion: draftOpinion,
      is_customer_part: draftCustomerPart,
      description: notes.trim() || null,
    };

    if (draftCustomerPart !== !!item.is_customer_part && item.service_item_id) {
      /* 价格读取仍走客户端只读查询 */
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

    /* 数量/单价：以弹窗里手动的值为准（放在"自带件"自动取价之后，手动修改优先） */
    updateData.quantity = parseFloat(draftQuantity) || 1;
    updateData.unit_price = parseFloat(draftUnitPrice) || 0;

    /* 写库走 Server Action */
    const 保存结果 = await 保存工单项目字段({ itemId: item.id, updates: updateData });
    setLoading(false);

    if (!保存结果.success) {
      toast("保存失败: " + (保存结果.error || "未知错误"), "error");
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
        toast(`分成比例合计为 ${total.toFixed(2)}%，必须为 100%`, "warning");
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
      toast("请选择施工人", "warning");
      return;
    }

    const ratios = calculateRatios();
    if (!ratios) return;

    setLoading(true);
    /* 写库走 Server Action（删旧 + 插新在服务端完成） */
    const 指派结果 = await 保存施工指派({
      itemId: item.id,
      records: ids.map((id) => ({ mechanicId: id, sharePct: ratios[id] ?? 100 })),
    });
    setLoading(false);

    if (!指派结果.success) {
      toast("保存失败: " + (指派结果.error || "未知错误"), "error");
      return;
    }

    setShowMechanicModal(false);
    refresh();
  }

  /* 清除施工人 */
  async function clearMechanics() {
    if (!(await 请求确认("确定取消施工指派？"))) return;
    setLoading(true);
    const 清除结果 = await 删除项目施工人(item.id);
    setLoading(false);
    if (!清除结果.success) {
      toast("取消失败: " + (清除结果.error || "未知错误"), "error");
      return;
    }
    setShowMechanicModal(false);
    refresh();
  }

  /* 领单 — 独立完成（领单人取服务端登录用户） */
  async function handleSoloClaim() {
    setLoading(true);
    const 领单结果 = await 单人领单(item.id);
    setLoading(false);
    if (!领单结果.success) {
      toast("领单失败: " + (领单结果.error || "未知错误"), "error");
      return;
    }
    setShowMechanicModal(false);
    refresh();
  }

  /* 领单 — 与人合作 */
  async function handleCollaborateClaim() {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null; /* getSession本地读不联网（2026-09-03） */
    if (!user) {
      toast("未登录，无法领单", "error");
      return;
    }
    setMechanicMode("person");
    setSelectedPersons((prev) =>
      prev.includes(user.id) ? prev : [...prev, user.id]
    );
    setShowClaimChoice(false);
  }

  /* 放弃领单（删自己 + 剩余重摊均分，服务端读最新名单） */
  async function abandonClaim() {
    if (!currentUserId) return;
    if (!(await 请求确认("确定放弃领单？"))) return;
    setLoading(true);

    const 放弃结果 = await 放弃领单(item.id);
    setLoading(false);
    if (!放弃结果.success) {
      toast("放弃领单失败: " + (放弃结果.error || "未知错误"), "error");
      return;
    }
    refresh();
  }

  function handlePartSearchChange(val: string) {
    setPartSearchQuery(val);
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

  /* 十级价格（2026-09-13 接入）：按工单上下文解析最优销售价作为默认单价，
     失败或无结果返回 null（调用方用配件标准价兜底），单价仍可人工改 */
  async function 解析默认单价(partId: string): Promise<number | null> {
    try {
      const r = await 解析工单配件价格({ itemId: item.id, partId });
      return r.success && r.price != null ? r.price : null;
    } catch {
      return null;
    }
  }

  function handlePickerConfirm(pickerParts: PickerPart[]) {
    /* 先解析价格再入列，避免先入列再改价覆盖用户可能的手动输入 */
    void (async () => {
      const 价格们 = await Promise.all(pickerParts.map((p) => 解析默认单价(p.id)));
      setSelectedRealParts((prev) => {
        const next = [...prev];
        pickerParts.forEach((part, 序号) => {
          if (next.some((p) => p.part_id === part.id)) return;
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
            unit_price: 价格们[序号] ?? part.unit_price,
            quantity: part.selectedQuantity ?? 1,
          });
        });
        return next;
      });
    })();
    setPickerOpen(false);
  }

  function removeSelectedRealPart(partId: string) {
    setSelectedRealParts((prev) => prev.filter((sp) => sp.part_id !== partId));
  }

  /* 配件库搜索 */
  function handleInventorySearchChange(val: string) {
    setInventorySearchQuery(val);
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
      .or(`part_number.ilike.%${清理搜索词(trimmed)}%,name.ilike.%${清理搜索词(trimmed)}%`)
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
    /* 先解析十级价格再入列（标准价兜底）；存在性判断放进函数式更新里防竞态 */
    void (async () => {
      const 解析价 = await 解析默认单价(part.id);
      setSelectedRealParts((prev) => {
        if (prev.some((sp) => sp.part_id === part.id)) return prev;
        return [
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
            unit_price: 解析价 ?? part.unit_price,
            quantity: 1,
          },
        ];
      });
    })();
  }

  function updateRealPartQuantity(partId: string, qty: number | null) {
    setSelectedRealParts((prev) =>
      prev.map((sp) => (sp.part_id === partId ? { ...sp, quantity: qty } : sp))
    );
  }

  /* 删除已有配件 */
  async function deletePart(partId: string, partName: string) {
    if (!(await 请求确认(`确定删除配件「${partName}」？`))) return;
    const target = parts.find((p) => p.id === partId);
    setLoading(true);
    try {
      /* 写库收编为 Server Action（RPC delete_part_branch/delete_part_group）。
         目录键口径与页面分组一致：branch_group_id 空则回退 part_name_id。
         目录内只剩这一条时，删本条=删整个目录（同桌面端组头删除），走整组删除函数——
         delete_part_branch 有"同目录至少保留一个"守卫，直接调会被拒 */
      const 目录键 = target ? target.branch_group_id || target.part_name_id || null : null;
      const 同目录剩余 = 目录键
        ? parts.filter((p) => (p.branch_group_id || p.part_name_id) === 目录键 && p.id !== partId)
        : [];
      if (同目录剩余.length === 0) {
        const 整组结果 = await 删除配件目录(partId);
        if (!整组结果.success) {
          toast("删除失败: " + (整组结果.error || "未知错误"), "error");
          return;
        }
        setSelectedPartForDetail(null);
        refresh();
        return;
      }
      /* 多分支目录：删除+递补选中一次完成（服务端事务）。已采购/已到货拒删；
         删的若是选中分支，服务端自动把同目录下一条设为选中并返回 new_selected_id */
      const 结果 = await 删除配件分支(partId);
      if (!结果.success) {
        toast("删除失败: " + (结果.error || "未知错误"), "error");
        return;
      }
      /* 服务端递补的新选中分支同步进本地覆盖，避免整页刷新前界面短暂显示无人选中 */
      if (结果.new_selected_id) {
        const 新选中id = 结果.new_selected_id;
        set实时覆盖((prev) => ({ ...prev, [新选中id]: { ...prev[新选中id], is_selected: true } }));
      }
      setSelectedPartForDetail(null);
      refresh();
    } catch (err: unknown) {
      toast("删除失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 删除整个配件名称目录（该 branch_group_id 下所有分支） */
  async function handleDeleteGroup(target: ItemPart) {
    const ids = target.branch_group_id
      ? parts.filter((p) => p.branch_group_id === target.branch_group_id).map((p) => p.id)
      : [target.id];
    if (ids.length === 0) return;
    if (!(await 请求确认(`确定删除配件「${target.name}」及其全部 ${ids.length} 个分支？`))) return;
    setLoading(true);
    try {
      /* 写库收编为 Server Action（RPC delete_part_group）：给组内任一分支 id，
         函数内部自己算目录键整组事务删除；组内有已采购/已到货分支则整组拒删 */
      const 结果 = await 删除配件目录(target.id);
      if (!结果.success) {
        toast("删除失败: " + (结果.error || "未知错误"), "error");
        return;
      }
      setSelectedPartForDetail(null);
      refresh();
    } catch (err: unknown) {
      toast("删除失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 保存配件数量 */
  async function savePartQuantity(partId: string, qty: number) {
    if (qty < 1) {
      toast("数量至少为 1", "warning");
      return;
    }
    setLoading(true);
    /* 数量为目录级：同步更新该目录(branch_group_id)下所有分支；写库走 Server Action */
    const target = parts.find((p) => p.id === partId);
    const 目标ids = target?.branch_group_id
      ? parts.filter((p) => p.branch_group_id === target.branch_group_id).map((p) => p.id)
      : [partId];
    const 数量结果 = await 批量更新配件分支({ partIds: 目标ids, updates: { quantity: qty } });
    setLoading(false);
    if (!数量结果.success) {
      toast("保存失败: " + (数量结果.error || "未知错误"), "error");
      return;
    }
    /* 函数式更新：等待保存期间用户可能已关闭抽屉，prev 为 null 时不得"复活"抽屉 */
    setSelectedPartForDetail((prev) => (prev ? { ...prev, quantity: qty } : prev));
    refresh();
  }

  /* 保存配件客户意见 */
  async function savePartOpinion(partId: string, opinion: string) {
    setLoading(true);
    const 意见结果 = await 更新配件分支({ partId, updates: { customer_opinion: opinion } });
    setLoading(false);
    if (!意见结果.success) {
      toast("保存失败: " + (意见结果.error || "未知错误"), "error");
      return;
    }
    setSelectedPartForDetail((prev) => (prev ? { ...prev, customer_opinion: opinion } : prev));
    /* 客户意见参与工作流状态判定（待确认→待采购/待领料），刷新让状态标签立即更新 */
    refresh();
  }

  /* 保存配件备注 */
  async function savePartNotes(partId: string, notes: string) {
    setLoading(true);
    const 备注结果 = await 更新配件分支({ partId, updates: { notes: notes.trim() || null } });
    setLoading(false);
    if (!备注结果.success) {
      toast("保存失败: " + (备注结果.error || "未知错误"), "error");
      return;
    }
    setSelectedPartForDetail((prev) => (prev ? { ...prev, notes: notes.trim() || null } : prev));
  }

  /* 通用保存配件字段（仅限白名单字段，写库走 Server Action） */
  async function savePartField(partId: string, field: string, value: unknown) {
    setLoading(true);
    const 白名单 = ["brand", "document_name", "part_number", "specification", "supplier_name", "unit", "unit_cost", "unit_price"] as const;
    type 字段名 = typeof 白名单[number];
    if (!白名单.includes(field as 字段名)) {
      setLoading(false);
      toast("不支持保存该字段", "warning");
      return;
    }
    const 更新 = { [field as 字段名]: value } as 配件分支更新;
    const 字段结果 = await 更新配件分支({ partId, updates: 更新 });
    setLoading(false);
    if (!字段结果.success) {
      toast("保存失败: " + (字段结果.error || "未知错误"), "error");
      return;
    }
    setSelectedPartForDetail((prev) => (prev ? { ...prev, [field]: value } : prev));
    // 价格/数量变更时刷新工单金额
    if (field === "unit_price" || field === "unit_cost") {
      refresh();
    }
  }

  /* 编码输入的智能候选：按编码模糊查配件库（同桌面端分支编辑的编码功能） */
  useEffect(() => {
    const kw = debounced编码查询.trim();
    if (!kw || !detailEditing) {
      设编码候选([]);
      return;
    }
    let 取消 = false;
    (async () => {
      const { data } = await supabase
        .from("parts")
        .select("id, part_number, part_name_id, unit_cost, unit_price, document_name, part_names(name), part_brands(name), part_specifications(name)")
        .ilike("part_number", `%${kw}%`)
        .limit(10);
      if (取消) return;
      设编码候选(((data || []) as 配件库行[]).map(转命中配件));
    })();
    return () => {
      取消 = true;
    };
     
  }, [debounced编码查询, detailEditing, supabase]);

  /* 当前详情面板正在看的分支（与渲染处同一套口径） */
  const 当前详情分支 = useCallback((): ItemPart | null => {
    if (!selectedPartForDetail) return null;
    const branchParts = selectedPartForDetail.branch_group_id
      ? parts合并.filter((p) => p.branch_group_id === selectedPartForDetail.branch_group_id)
      : selectedPartForDetail.part_name_id
      ? parts合并.filter((p) => p.part_name_id === selectedPartForDetail.part_name_id)
      : [selectedPartForDetail];
    return branchParts.find((p) => p.id === detailActiveBranchId) || branchParts[0];
  }, [selectedPartForDetail, parts合并, detailActiveBranchId]);

  /* 把命中的库存配件带回当前分支：关联 part_id 并补齐编码/品牌/规格/价格/单据名
   * （同桌面端"应用命中配件"，但不改配件名称和分组归属）；写库走 Server Action */
  async function 应用命中配件到分支(branchId: string, hit: 编码命中配件) {
    setLoading(true);
    const 带回结果 = await 更新配件分支({
      partId: branchId,
      updates: {
        part_id: hit.id,
        part_number: hit.part_number || null,
        brand: hit.brand || null,
        specification: hit.specification || null,
        unit_cost: hit.unit_cost,
        unit_price: hit.unit_price,
        document_name: hit.document_name || null,
      },
    });
    setLoading(false);
    if (!带回结果.success) {
      toast("带回配件信息失败: " + (带回结果.error || "未知错误"), "error");
      return;
    }
    /* 库存配件可能未设价（可空），而 ItemPart 声明必填；
     * 数据库已写成功，本地详情面板同步最新值，类型以 ItemPart 为准断言 */
    setSelectedPartForDetail((prev) => (prev ? {
      ...prev,
      part_id: hit.id,
      part_number: hit.part_number || null,
      brand: hit.brand || null,
      specification: hit.specification || null,
      unit_cost: hit.unit_cost,
      unit_price: hit.unit_price,
      document_name: hit.document_name || null,
    } as ItemPart : prev));
    if (hit.unit_price != null) {
      window.dispatchEvent(
        new CustomEvent("wo-part-update", { detail: { itemId: item.id, partId: branchId, unit_price: hit.unit_price } })
      );
    }
    设编码候选([]);
    refresh();
  }

  /* 编辑态扫码：按编码精确查，唯一命中直接带回（同桌面端分支扫码） */
  async function handleDetailScan(code: string) {
    setDetailScanOpen(false);
    const kw = code.trim();
    const branch = 当前详情分支();
    if (!kw || !branch) return;
    const { data } = await supabase
      .from("parts")
      .select("id, part_number, part_name_id, unit_cost, unit_price, document_name, part_names(name), part_brands(name), part_specifications(name)")
      .eq("part_number", kw)
      .limit(2);
    const rows = (data || []) as 配件库行[];
    if (rows.length === 0) {
      toast(`未找到编码「${kw}」对应的配件`, "error");
      return;
    }
    if (rows.length > 1) {
      toast(`编码「${kw}」对应多个配件，请手动输入编码从候选中选择`, "warning");
      return;
    }
    await 应用命中配件到分支(branch.id, 转命中配件(rows[0]));
  }

  /* 采购/到货标记（守卫逻辑同桌面端 PartBranchEditor） */
  async function 切换采购(part: ItemPart) {
    if ((part.customer_opinion || "pending") !== "agree") {
      toast("需客户同意后才能采购", "warning");
      return;
    }
    const 库存数 = (part.part_id && partInventory) ? (partInventory[part.part_id] || 0) : 0;
    if (!part.is_purchased && 库存数 > 0) {
      toast("库存不为0，无需采购", "warning");
      return;
    }
    const next = !part.is_purchased;
    setLoading(true);
    try {
      /* 写库收编为 Server Action（RPC set_part_purchase_flag）：守卫内置在函数里，
         前端守卫保留做提前提示；失败时不改本地态（维持原值即回滚） */
      const 结果 = await 标记采购到货(part.id, "is_purchased", next);
      if (!结果.success) {
        toast("操作失败: " + (结果.error || "未知错误"), "error");
        return;
      }
      setSelectedPartForDetail((prev) => (prev ? { ...prev, is_purchased: next } : prev));
      refresh();
    } catch (err: unknown) {
      toast("操作失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  async function 切换到货(part: ItemPart) {
    if (!part.is_purchased) {
      toast("需先采购后才能标记到货", "warning");
      return;
    }
    const next = !part.is_arrived;
    setLoading(true);
    try {
      /* 写库收编为 Server Action（RPC set_part_purchase_flag）：未采购拒标到货的守卫函数内置，
         前端守卫保留做提前提示；失败时不改本地态（维持原值即回滚） */
      const 结果 = await 标记采购到货(part.id, "is_arrived", next);
      if (!结果.success) {
        toast("操作失败: " + (结果.error || "未知错误"), "error");
        return;
      }
      setSelectedPartForDetail((prev) => (prev ? { ...prev, is_arrived: next } : prev));
      refresh();
    } catch (err: unknown) {
      toast("操作失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 申领面板展开时拉取该分支的待出库申领列表 */
  useEffect(() => {
    if (!申领展开) return;
    const branch = 当前详情分支();
    if (!branch) return;
    (async () => {
      const { data } = await supabase
        .from("part_pick_requests")
        .select("id, quantity, notes, created_at")
        .eq("work_order_item_part_id", branch.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      set申领列表((data || []) as 申领行[]);
    })();
     
  }, [申领展开, detailActiveBranchId, selectedPartForDetail?.id, supabase, 当前详情分支]);

  /* 提交申领（走 Server Action，只记需求不动库存；库管实领后自动核销） */
  async function 提交申领() {
    const branch = 当前详情分支();
    if (!branch) return;
    const 数量 = parseInt(申领数量);
    if (!Number.isInteger(数量) || 数量 <= 0) {
      toast("申领数量必须是大于 0 的整数", "warning");
      return;
    }
    setLoading(true);
    try {
      const r = await 申领配件(branch.id, 数量, "");
      if (!r.success) {
        toast("申领失败: " + (r.error || "未知错误"), "error");
        return;
      }
      set申领展开(false);
      set申领数量("1");
      refresh();
    } catch (err: unknown) {
      toast("申领失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 取消一条待出库申领 */
  async function 取消一条申领(申领id: string) {
    setLoading(true);
    try {
      const r = await 取消申领(申领id);
      if (!r.success) {
        toast("取消失败: " + (r.error || "未知错误"), "error");
        return;
      }
      set申领列表((prev) => prev.filter((x) => x.id !== 申领id));
      refresh();
    } catch (err: unknown) {
      toast("取消失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 退料面板展开时拉取该分支的领料记录（算可退数量 = 已领 - 已退 - 申请中）和待确认退料申请 */
  useEffect(() => {
    if (!退料展开) return;
    const branch = 当前详情分支();
    if (!branch) return;
    (async () => {
      const { data: 领料们 } = await supabase
        .from("part_picking_records")
        .select("id, quantity, picked_at, picking_orders(picking_no, status)")
        .eq("work_order_item_part_id", branch.id)
        .order("picked_at", { ascending: false });
      /* 过滤待确认（draft）单的占位记录：库存从未扣过，不能退 */
      const 记录们 = ((领料们 || []) as unknown as 可退领料行[]).filter(
        (r) => r.picking_orders?.status !== "draft"
      );
      const 记录ids = 记录们.map((r) => r.id);
      const [{ data: 退库们 }, { data: 申请们 }] = await Promise.all([
        记录ids.length > 0
          ? supabase.from("part_return_records").select("picking_record_id, quantity").in("picking_record_id", 记录ids)
          : Promise.resolve({ data: [] as { picking_record_id: string; quantity: number }[] }),
        supabase
          .from("part_return_requests")
          .select("id, picking_record_id, quantity, return_type, created_at")
          .eq("work_order_item_part_id", branch.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
      ]);
      /* 占用 = 已退 + 待确认申请，超过已领的就不再可退 */
      const 占用Map: Record<string, number> = {};
      for (const r of 退库们 || []) {
        占用Map[r.picking_record_id] = (占用Map[r.picking_record_id] || 0) + r.quantity;
      }
      for (const r of (申请们 || []) as 退料申请行[]) {
        占用Map[r.picking_record_id] = (占用Map[r.picking_record_id] || 0) + r.quantity;
      }
      set可退领料列表(
        记录们
          .map((r) => ({ ...r, 可退: r.quantity - (占用Map[r.id] || 0) }))
          .filter((r) => r.可退 > 0)
      );
      set退申请列表((申请们 || []) as 退料申请行[]);
    })();

  }, [退料展开, detailActiveBranchId, selectedPartForDetail?.id, supabase, 当前详情分支]);

  /* 提交退料申请（走 Server Action，只记意向不动库存；库管确认后才生成退料单） */
  async function 提交退料申请() {
    const branch = 当前详情分支();
    if (!branch) return;
    if (!选中领料记录id) {
      toast("请选择退哪一笔领料", "warning");
      return;
    }
    const 数量 = parseInt(退料数量);
    if (!Number.isInteger(数量) || 数量 <= 0) {
      toast("退料数量必须是大于 0 的整数", "warning");
      return;
    }
    const 记录 = 可退领料列表.find((r) => r.id === 选中领料记录id);
    if (记录 && 数量 > 记录.可退) {
      toast(`该笔最多还能退 ${记录.可退} 件`, "warning");
      return;
    }
    setLoading(true);
    try {
      const r = await 申请退料(选中领料记录id, 数量, 退料类型, "");
      if (!r.success) {
        toast("申请退料失败: " + (r.error || "未知错误"), "error");
        return;
      }
      set退料展开(false);
      set退料数量("1");
      set选中领料记录id("");
      refresh();
    } catch (err: unknown) {
      toast("申请退料失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 取消一条待确认退料申请 */
  async function 取消一条退申请(申请id: string) {
    setLoading(true);
    try {
      const r = await 取消退料申请(申请id);
      if (!r.success) {
        toast("取消失败: " + (r.error || "未知错误"), "error");
        return;
      }
      set退申请列表((prev) => prev.filter((x) => x.id !== 申请id));
      refresh();
    } catch (err: unknown) {
      toast("取消失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 替换配件 */
  async function handleReplacePart(oldPartId: string, newPart: PickerPart) {
    if (!(await 请求确认(`确定将配件替换为「${newPart.name}」？`))) return;
    setLoading(true);

    const pb = newPart.part_brands;
    const brandName = (Array.isArray(pb) ? pb[0]?.name : pb?.name) || "";

    /* 写库走 Server Action */
    const 替换结果 = await 更新配件分支({
      partId: oldPartId,
      updates: {
        part_id: newPart.id,
        part_name_id: newPart.part_name_id,
        name: newPart.name,
        part_number: newPart.part_number || "",
        unit: newPart.unit || "件",
        brand: brandName,
        specification: newPart.specification_text || "",
        unit_cost: newPart.unit_cost,
        unit_price: newPart.unit_price,
      },
    });

    setLoading(false);
    setReplacePartTarget(null);

    if (!替换结果.success) {
      toast("替换失败: " + (替换结果.error || "未知错误"), "error");
      return;
    }

    setSelectedPartForDetail(null);
    refresh();
  }

  /* 给当前目录(branch_group_id)添加分支（同一目录下新增具体配件） */
  async function handleAddBranches(target: ItemPart, newParts: PickerPart[]) {
    if (newParts.length === 0) return;
    setLoading(true);
    try {
      /* 同目录已有选中分支则新加的都设 false；若该目录还没有选中（遗留），把第一条设为选中 */
      let 组已有选中 = parts.some((p) => p.branch_group_id === target.branch_group_id && p.is_selected);
      const 配件列表: Record<string, unknown>[] = newParts.map((np) => {
        const pb = np.part_brands;
        const brandName = (Array.isArray(pb) ? pb[0]?.name : pb?.name) || "";
        const 设为选中 = !组已有选中;
        if (设为选中) 组已有选中 = true;
        return {
          part_id: np.id,
          /* 沿用目标的目录与配件名称，归到同一目录成为分支（显式传 branch_group_id，
             不传会自成新目录——此处语义是"同目录新增分支"而非"全新目录首个配件"） */
          branch_group_id: target.branch_group_id,
          part_name_id: target.part_name_id,
          name: target.name,
          part_number: np.part_number || "",
          unit: np.unit || target.unit || "件",
          brand: brandName,
          specification: np.specification_text || np.part_specifications?.name || "",
          unit_cost: np.unit_cost,
          unit_price: np.unit_price,
          /* 数量为目录级，继承目标目录当前数量 */
          quantity: target.quantity ?? 1,
          customer_opinion: "pending",
          is_selected: 设为选中,
        };
      });
      /* 写库收编为 Server Action（RPC add_work_order_item_parts）：批量事务插入 */
      const 结果 = await 添加工单配件(item.id, 配件列表);
      setAddBranchTarget(null);
      if (!结果.success) {
        toast("添加分支失败: " + (结果.error || "未知错误"), "error");
        return;
      }
      refresh();
    } catch (err: unknown) {
      toast("添加分支失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 添加空分支：归入当前目录，其余信息后续手动填写 */
  async function handleAddEmptyBranch(target: ItemPart) {
    if (!target.branch_group_id) {
      toast("当前配件没有目录信息，无法添加分支", "error");
      return;
    }
    setLoading(true);
    try {
      /* 写库收编为 Server Action（RPC add_part_branch）：服务端克隆源行目录归属
         （branch_group_id/名称/单位/数量沿用源行），新分支固定不选中（业务铁律：
         给已有目录加分支时目录必然已有选中分支）；数量为 NULL 时留空不兜底成 1 */
      const 结果 = await 添加配件分支(target.id);
      if (!结果.success) {
        toast("添加空分支失败: " + (结果.error || "未知错误"), "error");
        return;
      }
      refresh();
    } catch (err: unknown) {
      toast("添加空分支失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 设为默认分支：组内原子切换选中（服务端事务：同目录其它行取消选中+本行选中），
     替代旧"本行 true + 兄弟 false"两步写，杜绝 0 选中中间态 */
  async function handleSetDefaultBranch(branchId: string) {
    setLoading(true);
    try {
      const 结果 = await 选中配件分支(branchId);
      if (!结果.success) {
        toast("设置默认分支失败: " + (结果.error || "未知错误"), "error");
        return;
      }
      refresh();
    } catch (err: unknown) {
      toast("设置默认分支失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* APP环境：调用原生相机拍照 */
  async function handleAppCamera(branchId: string) {
    try {
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
      });
      if (!photo.base64String) {
        toast("拍照未获取到图片", "warning");
        return;
      }
      const base64 = `data:image/jpeg;base64,${photo.base64String}`;
      const blob = base64转Blob(base64);
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
      await uploadPartImage(file, branchId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User denied")) return;
      toast("拍照失败: " + msg, "error");
    }
  }

  /* 上传配件图片 */
  async function uploadPartImage(file: File, branchId: string) {
    if (!file.type.startsWith("image/")) {
      toast("请选择图片文件", "warning");
      return;
    }
    setLoading(true);
    try {
      const compressed = await 压缩图片(file);
      const formData = new FormData();
      formData.append("file", compressed, file.name);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败");

      /* 图片记录写库走 Server Action */
      const 记录结果 = await 添加配件图片记录({ partBranchId: branchId, paths: [result.path] });
      if (!记录结果.success) throw new Error(记录结果.error || "保存图片记录失败");

      /* 立即更新抽屉里的图片显示（本地覆盖，不用等整页刷新） */
      if (result.path) {
        set本地图片覆盖((prev) => ({
          ...prev,
          [branchId]: [...(prev[branchId] ?? partImages?.[branchId] ?? []), { storage_path: result.path, media_type: "image" }],
        }));
      }
    } catch (err: unknown) {
      toast("图片上传失败: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 删除配件图片（写库走 Server Action） */
  async function removePartImage(branchId: string, storagePath: string, index: number) {
    setLoading(true);
    const 删除结果 = await 删除配件图片记录({ partBranchId: branchId, path: storagePath });
    setLoading(false);
    if (!删除结果.success) {
      toast("删除失败: " + (删除结果.error || "未知错误"), "error");
      return;
    }
    /* 立即从抽屉显示中移除（本地覆盖） */
    set本地图片覆盖((prev) => ({
      ...prev,
      [branchId]: (prev[branchId] ?? partImages?.[branchId] ?? []).filter((_, i) => i !== index),
    }));
  }

  async function saveParts() {
    const totalCount = selectedPartNames.length + selectedRealParts.length;
    if (totalCount === 0) {
      toast("请至少选择一个配件", "warning");
      return;
    }
    setLoading(true);

    /* 每个新增配件都各自成为一个独立目录（是该目录唯一分支，即为选中分支 is_selected=true）。
       同名也是独立目录。
       注意：RPC 里 branch_group_id 不传会写入显式 NULL（不会触发表默认值 gen_random_uuid()），
       同名配件就会被并入同目录，所以这里前端为每个配件生成新 uuid 传入，保持独立目录语义 */
    const 新目录id = () =>
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    const inserts: Record<string, unknown>[] = [];
    for (const sp of selectedPartNames) {
      inserts.push({
        branch_group_id: 新目录id(),
        part_name_id: sp.part_name_id,
        name: sp.name,
        unit: sp.unit,
        /* 数量留空（NULL）：未填数量的配件红底留白提醒补填，不兜底成 1 */
        quantity: sp.quantity ?? null,
        customer_opinion: "pending",
        is_selected: true,
      });
    }
    for (const sp of selectedRealParts) {
      inserts.push({
        branch_group_id: 新目录id(),
        part_id: sp.part_id,
        part_name_id: sp.part_name_id,
        part_number: sp.part_number,
        name: sp.name,
        unit: sp.unit,
        brand: sp.brand,
        specification: sp.specification,
        unit_cost: sp.unit_cost,
        unit_price: sp.unit_price,
        /* 从配件库选的配件带明确数量（默认1），留空同样允许 */
        quantity: sp.quantity ?? null,
        customer_opinion: "pending",
        is_selected: true,
      });
    }

    /* 写库收编为 Server Action（RPC add_work_order_item_parts）：批量事务插入 */
    try {
      const 结果 = await 添加工单配件(item.id, inserts);
      if (!结果.success) {
        toast("添加失败: " + (结果.error || "未知错误"), "error");
        return;
      }

      setShowPartModal(false);
      refresh();
    } catch (err: unknown) {
      toast("添加失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 删除维修项目 */
  async function handleDeleteItem() {
    if (!(await 请求确认(`确定删除维修项目「${item.alias_name || item.name}」？`))) return;
    if (parts.length > 0) {
      if (!(await 请求确认("该项目下还有配件，确定一并删除吗？"))) return;
    }
    setLoading(true);
    const result = await 删除工单项目(item.id);
    setLoading(false);
    if (!result.success) {
      toast("删除失败: " + (result.error || "未知错误"), "error");
      return;
    }
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
    if (!(await 请求确认(msg))) return;

    setLoading(true);
    try {
      /* 移除明细（末项时整单删除 + 财务清理）走 Server Action + RPC 一个事务 */
      const 移除结果 = await 移除外包明细({
        workOrderId: orderId,
        orderId: existingOrder.id,
        itemId: existingItem.id,
        workOrderItemId: item.id,
      });
      if (!移除结果.success) throw new Error(移除结果.error || "操作失败");

      refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "操作失败", "error");
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
            {/* 阶段徽章：待派工/待施工/施工中/已中断/待质检/已完工（仅 labor 显示，组件内自判断） */}
            <ItemStageBadge
              itemId={item.id}
              itemType={item.item_type}
              status={item.status ?? null}
              requireQc={item.require_qc ?? null}
              qcStatus={item.qc_status ?? null}
              customerOpinion={item.customer_opinion ?? null}
              初始已派工={existingMechanics.length > 0 || !!item.mechanic_id}
            />
            {/* 客户意见徽章：labor 项目的阶段徽章已含"待确认"，只给非 labor 项目显示，避免重复 */}
            {item.item_type !== "labor" && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${opinionColor}`}>{opinionLabel}</span>
            )}
            {item.is_outsourced && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">外包</span>}
            {item.is_customer_part && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700">自带</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-sm font-medium text-gray-900">
              ¥{item.total_price ?? (item.unit_price || 0) * (item.quantity || 1)}
            </span>
            {!isLocked && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const hasPicked = parts.some((p) => (p.pickedQty || 0) > 0);
                  if (hasPicked) {
                    toast("该项目已有出库配件，不能删除", "error");
                    return;
                  }
                  handleDeleteItem();
                }}
                disabled={loading}
                className="text-xs text-red-500 hover:text-red-600 px-1 py-0.5 rounded hover:bg-red-50 disabled:opacity-50"
                title="删除项目"
              >
                删除
              </button>
            )}
          </div>
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
                {partGroups.map((group) => {
                  const branchCount = group.parts.length;
                  /* 默认分支：组内被选中的那条（无则兜底第一条），列表行只显示它 */
                  const 默认分支 = group.parts.find((p) => p.is_selected) || group.parts[0];
                  const 行数量 = 默认分支.quantity || 0;
                  const 行金额 = (默认分支.unit_price || 0) * (默认分支.quantity || 0);
                  const 品规 = [默认分支.brand, 默认分支.specification].filter(Boolean).join(" · ");
                  return (
                    <button
                      key={默认分支.part_name_id || 默认分支.name}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPartForDetail(默认分支);
                        setDetailActiveBranchId(默认分支.id);
                      }}
                      className="w-full flex items-center justify-between text-xs py-1 text-left"
                    >
                      <div className="min-w-0 flex-1 truncate text-gray-700">
                        <span className="font-medium">{group.name}</span>
                        {branchCount > 1 && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                            {branchCount}个分支
                          </span>
                        )}
                        {品规 && (
                          <span className="ml-1.5 text-[10px] text-gray-400">{品规}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-gray-500">x{行数量}</span>
                        <span className="text-gray-500">¥{行金额}</span>
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  );
                })}
                {/* 配件列表底部：直接添加配件入口 */}
                {!isLocked && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPartModal(true);
                    }}
                    className="w-full flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 py-1 mt-0.5"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>添加配件</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* 无配件：灰色"配件：无"提示 + 蓝色"+ 配件"明确入口（锁定时只展示不可点） */
          <span className="mt-1 flex items-center gap-1.5 text-xs">
            <span className="text-gray-400">配件：无</span>
            {!isLocked && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowPartModal(true);
                }}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                + 配件
              </button>
            )}
          </span>
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
                {!isLocked && (
                  <button
                    type="button"
                    onClick={() => {
                      const hasPicked = parts.some((p) => (p.pickedQty || 0) > 0);
                      if (hasPicked) {
                        toast("该项目已有出库配件，不能删除", "error");
                        return;
                      }
                      handleDeleteItem();
                    }}
                    disabled={loading}
                    className="text-xs text-red-500 hover:text-red-600 px-2 py-1.5 rounded hover:bg-red-50 disabled:opacity-50"
                  >
                    删除
                  </button>
                )}
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
              {/* 价格：数量 × 单价（锁定时只读） */}
              <section>
                <h4 className="text-sm font-medium text-gray-700 mb-2">价格</h4>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draftQuantity}
                    onChange={(e) => setDraftQuantity(e.target.value)}
                    disabled={isLocked}
                    aria-label="数量"
                    className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm text-center disabled:bg-gray-50 disabled:text-gray-500"
                  />
                  <span className="text-gray-400 text-sm">×</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draftUnitPrice}
                    onChange={(e) => setDraftUnitPrice(e.target.value)}
                    disabled={isLocked}
                    aria-label="单价"
                    className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right disabled:bg-gray-50 disabled:text-gray-500"
                  />
                  <span className="text-sm text-gray-500">
                    = ¥{((parseFloat(draftQuantity) || 0) * (parseFloat(draftUnitPrice) || 0)).toFixed(2)}
                  </span>
                </div>
              </section>

              {/* 提成（沿用页面顶部"提成信息"开关控制显隐，与桌面端同一权限） */}
              <ShowCommission>
                {(() => {
                  const comm = calculateItemCommission(
                    item as unknown as CommissionSource,
                    item.service_items as unknown as CommissionSource | null,
                    null,
                    null,
                    item.total_price || 0,
                    0
                  );
                  if (comm.diagnosis === 0 && comm.repair === 0 && comm.sales === 0 && comm.qc === 0) return null;
                  return (
                    <section>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">提成</h4>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {comm.diagnosis > 0 && <span className="text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">诊断 {comm.diagnosis.toFixed(2)}元</span>}
                        {comm.repair > 0 && <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">维修 {comm.repair.toFixed(2)}元</span>}
                        {comm.sales > 0 && <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded">销售 {comm.sales.toFixed(2)}元</span>}
                        {comm.qc > 0 && <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">质检 {comm.qc.toFixed(2)}元</span>}
                      </div>
                    </section>
                  );
                })()}
              </ShowCommission>

              {/* 质检：仅"待质检"且当前用户是质检人本人时显示质检按钮（组件内自判断，其余情况不渲染）。
                 质检单支持合格一键提交；不合格强制填原因；可附图片/视频凭证；含历史质检单 */}
              {item.item_type === "labor" && !!item.require_qc && (
                <ItemQcActions
                  itemId={item.id}
                  itemName={(item.alias_name || item.name) ?? ""}
                  requireQc={item.require_qc}
                  实际锁定={isLocked}
                />
              )}
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

            </div>
          </div>
        </div>
      )}

      {/* 施工人选择子弹窗（2026-09-16 拆到独立组件） */}
      {showMechanicModal && (
        <MechanicAssignModal
          onClose={() => setShowMechanicModal(false)}
          profiles={profiles}
          mechanicGroups={mechanicGroups}
          existingMechanics={existingMechanics}
          loading={loading}
          showClaimChoice={showClaimChoice}
          setShowClaimChoice={setShowClaimChoice}
          onSoloClaim={handleSoloClaim}
          onCollaborateClaim={handleCollaborateClaim}
          mechanicMode={mechanicMode}
          setMechanicMode={setMechanicMode}
          mechanicSortAsc={mechanicSortAsc}
          setMechanicSortAsc={setMechanicSortAsc}
          selectedPersons={selectedPersons}
          togglePerson={togglePerson}
          selectedGroup={selectedGroup}
          setSelectedGroup={setSelectedGroup}
          isMulti={isMulti}
          personCount={personCount}
          commissionRule={commissionRule}
          setCommissionRule={setCommissionRule}
          levelPreview={levelPreview}
          manualRatios={manualRatios}
          setManualRatios={setManualRatios}
          mechanicIds={mechanicIds}
          onClear={clearMechanics}
          onSave={saveMechanics}
        />
      )}
      {/* 配件选择覆盖层（2026-09-16 拆到独立组件） */}
      {showPartModal && (
        <PartPickerSheetModal
          onClose={() => setShowPartModal(false)}
          item={item}
          partTab={partTab}
          setPartTab={setPartTab}
          partSearchQuery={partSearchQuery}
          onPartSearchChange={handlePartSearchChange}
          partSearching={partSearching}
          partSearchResults={partSearchResults}
          presetLoading={presetLoading}
          presetParts={presetParts}
          commonTags={commonTags}
          selectedPartNames={selectedPartNames}
          addPresetPart={addPresetPart}
          addPartNameFromSearch={addPartNameFromSearch}
          updatePartNameQuantity={updatePartNameQuantity}
          removeSelectedPartName={removeSelectedPartName}
          inventorySearchQuery={inventorySearchQuery}
          onInventorySearchChange={handleInventorySearchChange}
          setInventorySearchQuery={setInventorySearchQuery}
          doInventorySearch={doInventorySearch}
          inventorySearching={inventorySearching}
          inventorySearchResults={inventorySearchResults}
          linkedPartIds={linkedPartIds}
          selectedRealParts={selectedRealParts}
          addInventoryPart={addInventoryPart}
          updateRealPartQuantity={updateRealPartQuantity}
          removeSelectedRealPart={removeSelectedRealPart}
          onOpenBarcodeScanner={() => setShowBarcodeScanner(true)}
          loading={loading}
          onSave={saveParts}
        />
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

      {/* 配件详情弹窗（2026-09-16 拆到独立组件） */}
      {selectedPartForDetail && (
        <PartDetailSheetModal
          selectedPartForDetail={selectedPartForDetail}
          setSelectedPartForDetail={setSelectedPartForDetail}
          parts合并={parts合并}
          detailActiveBranchId={detailActiveBranchId}
          setDetailActiveBranchId={setDetailActiveBranchId}
          detailEditing={detailEditing}
          setDetailEditing={setDetailEditing}
          isLocked={isLocked}
          loading={loading}
          分支图片={分支图片}
          set预览图片={set预览图片}
          removePartImage={removePartImage}
          uploadPartImage={uploadPartImage}
          handleAppCamera={handleAppCamera}
          detailFileInputRef={detailFileInputRef}
          编码候选={编码候选}
          设编码候选={设编码候选}
          设编码查询={设编码查询}
          应用命中配件到分支={应用命中配件到分支}
          savePartField={savePartField}
          savePartQuantity={savePartQuantity}
          savePartOpinion={savePartOpinion}
          savePartNotes={savePartNotes}
          handleSetDefaultBranch={handleSetDefaultBranch}
          handleAddEmptyBranch={handleAddEmptyBranch}
          deletePart={deletePart}
          handleDeleteGroup={handleDeleteGroup}
          setReplacePartTarget={setReplacePartTarget}
          setAddBranchTarget={setAddBranchTarget}
          setBranchPickerOpen={setBranchPickerOpen}
          setDetailScanOpen={setDetailScanOpen}
          切换采购={切换采购}
          切换到货={切换到货}
          申领展开={申领展开}
          set申领展开={set申领展开}
          申领数量={申领数量}
          set申领数量={set申领数量}
          申领列表={申领列表}
          提交申领={提交申领}
          取消一条申领={取消一条申领}
          退料展开={退料展开}
          set退料展开={set退料展开}
          退料数量={退料数量}
          set退料数量={set退料数量}
          退料类型={退料类型}
          set退料类型={set退料类型}
          选中领料记录id={选中领料记录id}
          set选中领料记录id={set选中领料记录id}
          可退领料列表={可退领料列表}
          退申请列表={退申请列表}
          提交退料申请={提交退料申请}
          取消一条退申请={取消一条退申请}
          returnByPart={returnByPart}
          partInventory={partInventory}
          pendingSupplierReturnByPart={pendingSupplierReturnByPart}
          申领ByPart={申领ByPart}
          suppliers={suppliers}
          logisticsCompanies={logisticsCompanies}
        />
      )}


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

      {/* 添加分支选择器 */}
      {addBranchTarget && (
        <PartPickerModal
          open={true}
          onClose={() => setAddBranchTarget(null)}
          onConfirm={(parts) => handleAddBranches(addBranchTarget, parts)}
          vehicleModelId={vehicleModelId}
          defaultNameQuery={addBranchTarget.name}
          compact
        />
      )}

      {/* 扫码弹窗 */}
      <BarcodeScanModal
        open={showBarcodeScanner}
        onClose={() => setShowBarcodeScanner(false)}
        onScan={handleBarcodeScan}
      />

      {/* 配件编辑态扫码弹窗：扫编码带回当前分支 */}
      <BarcodeScanModal
        open={detailScanOpen}
        onClose={() => setDetailScanOpen(false)}
        onScan={handleDetailScan}
      />

      {/* 配件编辑态"按名称搜配件"选择器（放大镜，同桌面端分支编辑） */}
      {branchPickerOpen && selectedPartForDetail && (
        <PartPickerModal
          open={true}
          onClose={() => setBranchPickerOpen(false)}
          onConfirm={(picked) => {
            setBranchPickerOpen(false);
            const p = picked[0];
            const branch = 当前详情分支();
            if (!p || !branch) return;
            const pb = p.part_brands;
            void 应用命中配件到分支(branch.id, {
              id: p.id,
              part_number: p.part_number,
              part_name_id: p.part_name_id,
              name: p.name,
              brand: (Array.isArray(pb) ? pb[0]?.name : pb?.name) || "",
              specification: p.specification_text || p.part_specifications?.name || "",
              unit_cost: p.unit_cost,
              unit_price: p.unit_price,
              document_name: null,
            });
          }}
          vehicleModelId={vehicleModelId}
          defaultNameQuery={selectedPartForDetail.name}
          compact
        />
      )}
      {/* 图片大图预览（2026-09-16 拆到独立组件） */}
      <ImagePreviewModal src={预览图片} onClose={() => set预览图片(null)} />
      {确认弹窗}
    </>
  );
}
