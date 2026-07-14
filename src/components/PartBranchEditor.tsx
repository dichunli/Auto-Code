"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePriceVisibility } from "./PriceVisibilityContext";
import { PartPickerModal } from "./PartPickerModal";
import { 标记本地编辑配件, 标记本地结构编辑 } from "@/lib/localEditSignal";
import PartForm, { PartFormDraft } from "@/app/parts/new/PartForm";

function toFixed2(val: string | number | null | undefined): string {
  if (val === "" || val === null || val === undefined) return "";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "";
  return num.toFixed(2);
}

/* 命中配件的叶子名是否"免询问"直接补齐：
   叶子名 == 分组名，或 叶子名 以「分组名-」「分组名 」(- 或空格分隔)开头。 */
function 名称免询问(叶子名: string, 分组名: string): boolean {
  const a = (叶子名 || "").trim();
  const b = (分组名 || "").trim();
  if (!b) return false;
  return a === b || a.startsWith(b + "-") || a.startsWith(b + " ");
}

interface PartData {
  id: string;
  is_selected?: boolean | null;
  is_purchased?: boolean | null;
  is_arrived?: boolean | null;
  customer_opinion?: string | null;
  part_number?: string | null;
  brand?: string | null;
  specification?: string | null;
  unit_cost?: number | string | null;
  cost_price?: number | string | null;
  unit_price?: number | string | null;
  supplier_name?: string | null;
  quantity?: number | null;
  document_name?: string | null;
  part_name_id?: string | null;
  part_names?: { category_id?: string | null } | null;
  parts?: { document_name?: string | null } | null;
}

interface Supplier {
  id: string;
  name: string;
  recommendation_level?: number | null;
}

interface Props {
  part: PartData;
  itemId: string;
  inventoryQty: number;
  suppliers: Supplier[];
  seqLabel: string;
  canDelete: boolean;
  isLocked: boolean;
  siblingIds?: string[];
  vehicleModelId?: string;
  children?: React.ReactNode;
}

export default function PartBranchEditor({
  part,
  itemId,
  inventoryQty,
  suppliers,
  seqLabel,
  canDelete,
  isLocked,
  siblingIds = [],
  vehicleModelId,
  children,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const { showPrices } = usePriceVisibility();
  const [saving, setSaving] = useState(false);
  const clickTimer = useRef<NodeJS.Timeout | null>(null);
  const 根容器Ref = useRef<HTMLDivElement>(null);

  function refresh() {
    // 结构性改动(删分支/关联编码)自己刷新拉新数据，标记后避免实时同步重复刷
    标记本地结构编辑(itemId || "");
    router.refresh();
  }

  // 本地状态（乐观更新）
  const [localSelected, setLocalSelected] = useState(part.is_selected || false);
  const [localPurchased, setLocalPurchased] = useState(part.is_purchased || false);
  const [localArrived, setLocalArrived] = useState(part.is_arrived || false);
  // 已删除：删除成功后立即隐藏本行（视觉瞬间消失），不等整页刷新
  const [deleted, setDeleted] = useState(false);
  const [localOpinion, setLocalOpinion] = useState(part.customer_opinion || "pending");

  // 字段编辑状态（声明在监听器之前，供实时同步/兜底同步的 setEditForm 使用）
  const [editForm, setEditForm] = useState({
    part_number: part.part_number || "",
    brand: part.brand || "",
    specification: part.specification || "",
    unit_cost: toFixed2(part.unit_cost),
    cost_price: toFixed2(part.cost_price),
    unit_price: toFixed2(part.unit_price),
    supplier_name: part.supplier_name || "",
    quantity: part.quantity != null ? String(part.quantity) : "1",
    document_name: part.document_name || part.parts?.document_name || "",
  });

  useEffect(() => {
    setLocalSelected(part.is_selected || false);
    setLocalPurchased(part.is_purchased || false);
    setLocalArrived(part.is_arrived || false);
    setLocalOpinion(part.customer_opinion || "pending");
  }, [part.is_selected, part.is_purchased, part.is_arrived, part.customer_opinion]);

  // 监听同组分支的选中广播：自己被选中→点亮，自己作为兄弟被取消→灭掉
  // （配合不刷整页的局部更新，保证单选互斥仍然正确）
  // 另：来自实时同步(fromRealtime)的推送，把价格/数量/意见等字段同步进本行显示，
  // 让观察方无需整页刷新即可秒级看到别人对本条的改动。
  useEffect(() => {
    function handleSelectSync(e: Event) {
      const detail = (e as CustomEvent).detail as {
        partId?: string;
        is_selected?: boolean;
        siblingResetIds?: string[];
        fromRealtime?: boolean;
        unit_price?: number;
        unit_cost?: number | null;
        cost_price?: number | null;
        quantity?: number;
        part_number?: string | null;
        brand?: string | null;
        specification?: string | null;
        supplier_name?: string | null;
        document_name?: string | null;
        customer_opinion?: string | null;
        is_purchased?: boolean;
        is_arrived?: boolean;
      } | null;
      if (!detail) return;
      if (detail.partId === part.id && detail.is_selected !== undefined) {
        setLocalSelected(detail.is_selected);
      } else if (detail.siblingResetIds?.includes(part.id)) {
        setLocalSelected(false);
      }
      // 实时推送且是本行：同步其余可见字段（跳过正在打字的本行，避免打断输入）
      if (detail.fromRealtime && detail.partId === part.id) {
        if (detail.customer_opinion !== undefined && detail.customer_opinion !== null) setLocalOpinion(detail.customer_opinion);
        if (detail.is_purchased !== undefined) setLocalPurchased(detail.is_purchased);
        if (detail.is_arrived !== undefined) setLocalArrived(detail.is_arrived);
        const 本行有焦点 = 根容器Ref.current?.contains(document.activeElement);
        if (!本行有焦点) {
          setEditForm((prev) => ({
            ...prev,
            unit_price: detail.unit_price !== undefined ? toFixed2(detail.unit_price) : prev.unit_price,
            unit_cost: detail.unit_cost !== undefined ? toFixed2(detail.unit_cost) : prev.unit_cost,
            cost_price: detail.cost_price !== undefined ? toFixed2(detail.cost_price) : prev.cost_price,
            quantity: detail.quantity !== undefined ? String(detail.quantity) : prev.quantity,
            part_number: detail.part_number !== undefined && detail.part_number !== null ? detail.part_number : prev.part_number,
            brand: detail.brand !== undefined && detail.brand !== null ? detail.brand : prev.brand,
            specification: detail.specification !== undefined && detail.specification !== null ? detail.specification : prev.specification,
            supplier_name: detail.supplier_name !== undefined && detail.supplier_name !== null ? detail.supplier_name : prev.supplier_name,
            document_name: detail.document_name !== undefined && detail.document_name !== null ? detail.document_name : prev.document_name,
          }));
        }
      }
    }
    window.addEventListener("wo-part-update", handleSelectSync as EventListener);
    return () => window.removeEventListener("wo-part-update", handleSelectSync as EventListener);
  }, [part.id]);

  // 只有一个分支时默认选中
  useEffect(() => {
    if (!canDelete && part.is_selected !== true) {
      setLocalSelected(true);
      supabase.from("work_order_item_parts").update({ is_selected: true }).eq("id", part.id).then(({ error }) => {
        if (error) {
          setLocalSelected(false);
          return;
        }
        // 广播给组头/小计/费用合计，避免它们的 liveParts 仍以为本条未选中
        // （否则加分支时读到过期状态，会把新分支也误设为选中，导致同组两个选中）
        window.dispatchEvent(
          new CustomEvent("wo-part-update", {
            detail: { itemId, partId: part.id, is_selected: true, siblingResetIds: [] },
          })
        );
      });
    }
  }, [canDelete, part.is_selected, part.id, supabase, itemId]);

  // 兜底：part prop 变化（点提示条整页刷新后拿到新数据）时，把输入框同步为最新值；
  // 正在本行打字则跳过，避免打断输入。
  useEffect(() => {
    const 本行有焦点 = 根容器Ref.current?.contains(document.activeElement);
    if (本行有焦点) return;
    setEditForm({
      part_number: part.part_number || "",
      brand: part.brand || "",
      specification: part.specification || "",
      unit_cost: toFixed2(part.unit_cost),
      cost_price: toFixed2(part.cost_price),
      unit_price: toFixed2(part.unit_price),
      supplier_name: part.supplier_name || "",
      quantity: part.quantity != null ? String(part.quantity) : "1",
      document_name: part.document_name || part.parts?.document_name || "",
    });
  }, [part.part_number, part.brand, part.specification, part.unit_cost, part.cost_price, part.unit_price, part.supplier_name, part.quantity, part.document_name]);

  // 供应商推荐相关状态
  const [vehicleInfo, setVehicleInfo] = useState<{ 厂商?: string; 品牌?: string; 车系?: string }>({});
  const [supplierVehicleMap, setSupplierVehicleMap] = useState<Map<string, Array<{ 厂商?: string; 品牌?: string; 车系?: string }>>>(new Map());
  const [matchedPartNameSupplierIds, setMatchedPartNameSupplierIds] = useState<Set<string>>(new Set());
  const [matchedCategorySupplierIds, setMatchedCategorySupplierIds] = useState<Set<string>>(new Set());
  const [matchedBrandSupplierIds, setMatchedBrandSupplierIds] = useState<Set<string>>(new Set());
  const [brandId, setBrandId] = useState<string | null>(null);
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierDropdownRef = useRef<HTMLDivElement>(null);
  const supplierButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // 系统中关联的品牌和规格列表
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [availableSpecs, setAvailableSpecs] = useState<string[]>([]);

  // 编码智能候选（全库模糊查，输入≥2字符出下拉）
  const [编码候选, set编码候选] = useState<{ id: string; part_number: string; name: string }[]>([]);
  const [显示编码候选, set显示编码候选] = useState(false);
  const [编码高亮, set编码高亮] = useState(-1); // 上下键高亮的候选索引，-1 为无
  // 当前编码是否在系统中精确存在（null=未知/未查，true/false=已查）。
  // 决定"创建配件"按钮：查不到才显示——与是否已有 part_id 无关（避免残留旧关联误判）。
  const [编码在系统, set编码在系统] = useState<boolean | null>(null);
  // 编码是否"录入完成"（失焦/回车/选候选后为 true；打字过程中为 false）。
  // 创建按钮只在录入完成后才判断显示，避免边打字边弹。
  const [编码已录入, set编码已录入] = useState(false);
  // 放大镜"选择配件"弹窗（按当前分组名预过滤，从系统已有配件里挑）
  const [选择器打开, set选择器打开] = useState(false);
  // 点"创建配件"后记下等待创建的编码；切回本页焦点时，若该编码已在系统建好则自动关联带回本分支
  const 等待创建编码 = useRef<string | null>(null);
  const autoFill引用 = useRef<(code: string) => void>(() => {});
  useEffect(() => {
    function onFocus() {
      const code = 等待创建编码.current;
      if (!code) return;
      等待创建编码.current = null;
      // 该编码若已在新窗口建好，autoFill 会查到并关联补齐；没建则查不到、无副作用
      autoFill引用.current(code);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // 创建配件弹窗：开关 + 预填数据 + 实时草稿（供"没保存也带回分支"用）
  const [创建弹窗打开, set创建弹窗打开] = useState(false);
  const [创建预填, set创建预填] = useState<{
    part_number?: string; name?: string; part_name_id?: string;
    purchase_price?: string; reference_purchase_price?: string; unit_price?: string;
    brand?: string; specification?: string; document_name?: string;
  } | null>(null);
  const 创建草稿 = useRef<PartFormDraft | null>(null);
  const 创建已保存 = useRef(false);

  // 编码命中但"配件叶子名与本分组名不符"时的询问框
  interface 编码命中 {
    id: string; part_number: string | null; name: string; part_name_id: string | null;
    brand: string; specification: string; unit_cost: number | null; unit_price: number | null;
    document_name: string | null; 叶子名: string;
  }
  const [名称不符询问, set名称不符询问] = useState<{ hit: 编码命中; 本组已有具体配件: boolean } | null>(null);
  const 编码候选Timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 分支行是 overflow-x-auto 容器会裁掉绝对定位下拉，故候选用 fixed 定位逃出容器
  const 编码InputRef = useRef<HTMLInputElement>(null);
  const [编码下拉Pos, set编码下拉Pos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 224 });
  useEffect(() => {
    if (!显示编码候选) return;
    function updatePos() {
      const el = 编码InputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      set编码下拉Pos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 224) });
    }
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [显示编码候选, 编码候选]);
  useEffect(() => {
    if (编码候选Timer.current) clearTimeout(编码候选Timer.current);
    const kw = editForm.part_number.trim();
    if (kw.length < 2) { set编码候选([]); set编码在系统(null); return; }
    编码候选Timer.current = setTimeout(async () => {
      // 模糊候选（下拉用）
      const { data } = await supabase
        .from("parts")
        .select("id, part_number, name")
        .ilike("part_number", `%${kw}%`)
        .limit(8);
      set编码候选(data || []);
      set编码高亮(-1); // 候选刷新，重置高亮
      // 精确存在性（创建按钮用）：当前编码在系统中是否精确存在
      const { count } = await supabase
        .from("parts")
        .select("id", { count: "exact", head: true })
        .eq("part_number", kw);
      set编码在系统((count ?? 0) > 0);
    }, 250);
    return () => { if (编码候选Timer.current) clearTimeout(编码候选Timer.current); };
  }, [editForm.part_number, supabase]);

  useEffect(() => {
    if (!part.part_name_id) return;
    supabase.from("parts").select("part_number, brand_id, specification_id").eq("part_name_id", part.part_name_id).then(({ data }) => {
      if (!data) return;
      const brandIds = [...new Set(data.map((p: { brand_id: string | null; specification_id: string | null }) => p.brand_id).filter(Boolean))];
      const specIds = [...new Set(data.map((p: { brand_id: string | null; specification_id: string | null }) => p.specification_id).filter(Boolean))];
      Promise.all([
        brandIds.length > 0 ? supabase.from("part_brands").select("name").in("id", brandIds) : Promise.resolve({ data: [] }),
        specIds.length > 0 ? supabase.from("part_specifications").select("name").in("id", specIds) : Promise.resolve({ data: [] }),
      ]).then(([brandsRes, specsRes]) => {
        setAvailableBrands((brandsRes.data || []).map((b: { name: string }) => b.name));
        setAvailableSpecs((specsRes.data || []).map((s: { name: string }) => s.name));
      });
    });
  }, [part.part_name_id, supabase]);

  // 查询供应商推荐相关数据
  useEffect(() => {
    // 1. 查询当前车型信息
    const vehiclePromise = vehicleModelId
      ? supabase.from("vehicle_models").select("厂商,品牌,车系").eq("id", vehicleModelId).single()
      : Promise.resolve({ data: null });

    // 2. 查询所有供应商的车型关联
    const vehicleLinksPromise = supabase
      .from("supplier_vehicle_models")
      .select("supplier_id, vehicle_models(厂商,品牌,车系)");

    // 3. 查询配件名称匹配的供应商
    const partNamePromise = part.part_name_id
      ? supabase.from("supplier_part_names").select("supplier_id").eq("part_name_id", part.part_name_id)
      : Promise.resolve({ data: [] });

    // 4. 查询配件分类匹配的供应商
    const categoryId = part.part_names?.category_id;
    const categoryPromise = categoryId
      ? supabase.from("supplier_part_categories").select("supplier_id").eq("part_category_id", categoryId)
      : Promise.resolve({ data: [] });

    Promise.all([vehiclePromise, vehicleLinksPromise, partNamePromise, categoryPromise])
      .then(([vehicleRes, linksRes, pnRes, pcRes]) => {
        // 车型信息
        if (vehicleRes.data) {
          setVehicleInfo(vehicleRes.data as { 厂商?: string; 品牌?: string; 车系?: string });
        }

        // 供应商车型关联映射
        const vmMap = new Map<string, Array<{ 厂商?: string; 品牌?: string; 车系?: string }>>();
        (linksRes.data || []).forEach((r: { supplier_id: string; vehicle_models: { 厂商?: string; 品牌?: string; 车系?: string } }) => {
          const list = vmMap.get(r.supplier_id) || [];
          list.push(r.vehicle_models);
          vmMap.set(r.supplier_id, list);
        });
        setSupplierVehicleMap(vmMap);

        // 配件名称匹配
        setMatchedPartNameSupplierIds(new Set((pnRes.data || []).map((r: { supplier_id: string }) => r.supplier_id)));

        // 配件分类匹配
        setMatchedCategorySupplierIds(new Set((pcRes.data || []).map((r: { supplier_id: string }) => r.supplier_id)));
      });
  }, [vehicleModelId, part.part_name_id, part.part_names?.category_id, supabase]);

  // 查询品牌ID（当品牌变化时）
  useEffect(() => {
    if (!editForm.brand) {
      setBrandId(null);
      setMatchedBrandSupplierIds(new Set());
      return;
    }
    supabase.from("part_brands").select("id").eq("name", editForm.brand).single().then(({ data }) => {
      const bid = data?.id || null;
      setBrandId(bid);
      if (bid) {
        supabase.from("supplier_part_brands").select("supplier_id").eq("part_brand_id", bid).then(({ data: bd }) => {
          setMatchedBrandSupplierIds(new Set((bd || []).map((r: { supplier_id: string }) => r.supplier_id)));
        });
      } else {
        setMatchedBrandSupplierIds(new Set());
      }
    });
  }, [editForm.brand, supabase]);

  // 计算下拉位置
  useEffect(() => {
    if (!supplierDropdownOpen || !supplierButtonRef.current) return;
    function updatePos() {
      if (!supplierButtonRef.current) return;
      const rect = supplierButtonRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [supplierDropdownOpen]);

  // 点击外部关闭供应商下拉
  useEffect(() => {
    if (!supplierDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        supplierDropdownRef.current &&
        !supplierDropdownRef.current.contains(target) &&
        supplierButtonRef.current &&
        !supplierButtonRef.current.contains(target)
      ) {
        setSupplierDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [supplierDropdownOpen]);

  async function saveField(field: string, value: string) {
    setSaving(true);
    // 标记这条配件是"自己刚改的"，避免实时同步把整页刷掉
    标记本地编辑配件(part.id);
    const updateData: Record<string, string | number | null> = {};
    if (field === "unit_cost" || field === "unit_price" || field === "cost_price") {
      updateData[field] = value === "" ? null : parseFloat(value);
    } else if (field === "quantity") {
      updateData[field] = value === "" ? 1 : parseInt(value, 10);
    } else {
      updateData[field] = value || null;
    }

    const { error } = await supabase
      .from("work_order_item_parts")
      .update(updateData)
      .eq("id", part.id);

    setSaving(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }

    // 价格字段保存成功后格式化为两位小数
    if (field === "unit_cost" || field === "unit_price" || field === "cost_price") {
      setEditForm((prev) => ({ ...prev, [field]: toFixed2(updateData[field]) }));
    }

    // 影响小计的字段，广播给小计/费用合计组件
    if (field === "unit_price" || field === "quantity") {
      window.dispatchEvent(
        new CustomEvent("wo-part-update", {
          detail: {
            itemId,
            partId: part.id,
            ...(field === "unit_price" ? { unit_price: updateData.unit_price ?? 0 } : {}),
            ...(field === "quantity" ? { quantity: updateData.quantity ?? 1 } : {}),
          },
        })
      );
    }
  }

  // 通过编码自动填充配件信息
  /* 把命中的库存配件补齐到本分支（写入 part_id + 品牌/规格/价格等）。
   * 可选覆盖 part_name_id（"替换分组名/新建分组"时用）。 */
  async function 应用命中配件(hit: 编码命中, 覆盖?: { part_name_id?: string; branch_group_id?: string; is_selected?: boolean }) {
    setEditForm((prev) => ({
      ...prev,
      part_number: hit.part_number || prev.part_number,
      brand: hit.brand,
      specification: hit.specification,
      unit_cost: hit.unit_cost != null ? toFixed2(hit.unit_cost) : prev.unit_cost,
      unit_price: hit.unit_price != null ? toFixed2(hit.unit_price) : prev.unit_price,
      document_name: hit.document_name || prev.document_name,
    }));
    setSaving(true);
    标记本地编辑配件(part.id);
    const 更新: Record<string, unknown> = {
      part_number: hit.part_number || null,
      brand: hit.brand || null,
      specification: hit.specification || null,
      unit_cost: hit.unit_cost,
      unit_price: hit.unit_price,
      document_name: hit.document_name || null,
      part_id: hit.id,
    };
    if (覆盖?.part_name_id !== undefined) 更新.part_name_id = 覆盖.part_name_id;
    if (覆盖?.branch_group_id !== undefined) 更新.branch_group_id = 覆盖.branch_group_id;
    if (覆盖?.is_selected !== undefined) 更新.is_selected = 覆盖.is_selected;
    const { error } = await supabase.from("work_order_item_parts").update(更新).eq("id", part.id);
    setSaving(false);
    if (error) { alert("补齐配件失败: " + error.message); return; }
    if (hit.unit_price != null) {
      window.dispatchEvent(new CustomEvent("wo-part-update", { detail: { itemId, partId: part.id, unit_price: hit.unit_price } }));
    }
    // 若改了目录归属(替换分组名/新建分组)，需刷新拉取最新分组结构
    if (覆盖) { 标记本地结构编辑(itemId); router.refresh(); }
  }

  // 打开"创建配件"弹窗：把本分支已填的信息带入新建窗口
  function 打开创建弹窗() {
    创建草稿.current = null;
    创建已保存.current = false;
    set创建预填({
      part_number: editForm.part_number.trim() || undefined,
      part_name_id: part.part_name_id || undefined,
      name: part.name || undefined,
      purchase_price: editForm.unit_cost || undefined,
      reference_purchase_price: editForm.cost_price || undefined,
      unit_price: editForm.unit_price || undefined,
      brand: editForm.brand || undefined,
      specification: editForm.specification || undefined,
      document_name: editForm.document_name || undefined,
    });
    set创建弹窗打开(true);
  }

  // 新建配件"保存成功"：按新配件 id 查库，把完整信息 + part_id 关联写回本分支
  async function 创建保存成功(partId: string) {
    创建已保存.current = true;
    set创建弹窗打开(false);
    const { data } = await supabase
      .from("parts")
      .select("part_number, name, part_name_id, unit_cost, unit_price, purchase_price, document_name, part_brands(name), part_specifications(name)")
      .eq("id", partId)
      .single();
    if (!data) { router.refresh(); return; }
    const pb = data.part_brands as { name: string } | { name: string }[] | null;
    const ps = data.part_specifications as { name: string } | { name: string }[] | null;
    const 品牌 = (Array.isArray(pb) ? pb[0]?.name : pb?.name) || null;
    const 规格 = (Array.isArray(ps) ? ps[0]?.name : ps?.name) || null;
    // 采购价：配件表用 purchase_price，分支用 unit_cost
    const 采购价 = data.purchase_price ?? data.unit_cost ?? null;
    const 销售价 = data.unit_price ?? null;
    setEditForm((prev) => ({
      ...prev,
      part_number: data.part_number || prev.part_number,
      brand: 品牌 || "",
      specification: 规格 || "",
      unit_cost: 采购价 != null ? toFixed2(采购价) : prev.unit_cost,
      unit_price: 销售价 != null ? toFixed2(销售价) : prev.unit_price,
      document_name: data.document_name || prev.document_name,
    }));
    标记本地编辑配件(part.id);
    const 更新: Record<string, unknown> = {
      part_id: partId,
      part_number: data.part_number || null,
      brand: 品牌,
      specification: 规格,
      unit_cost: 采购价,
      unit_price: 销售价,
      document_name: data.document_name || null,
    };
    // 叶子目录：新建配件带了配件名称，且本分支还没归属名称时，一并写入
    if (data.part_name_id && !part.part_name_id) 更新.part_name_id = data.part_name_id;
    const { error } = await supabase.from("work_order_item_parts").update(更新).eq("id", part.id);
    if (error) { alert("补齐配件失败: " + error.message); return; }
    if (销售价 != null) {
      window.dispatchEvent(new CustomEvent("wo-part-update", { detail: { itemId, partId: part.id, unit_price: 销售价 } }));
    }
    标记本地结构编辑(itemId);
    router.refresh();
  }

  // 关闭弹窗但未保存：把用户在弹窗里填的文字带回本分支（不写 part_id，仅显示，暂不关联系统配件）
  async function 创建取消带回() {
    set创建弹窗打开(false);
    if (创建已保存.current) return; // 已通过保存流程处理，避免重复带回
    const d = 创建草稿.current;
    if (!d) return;
    const 采购价 = (d.purchase_price || "").trim();
    const 销售价 = (d.unit_price || "").trim();
    const 品牌 = (d.brand || "").trim();
    const 规格 = (d.specification || "").trim();
    const 单据名 = (d.document_name || "").trim();
    const 编码 = (d.part_number || "").trim();
    // 全空则不带回
    if (!采购价 && !销售价 && !品牌 && !规格 && !单据名 && !编码) return;
    setEditForm((prev) => ({
      ...prev,
      part_number: 编码 || prev.part_number,
      brand: 品牌 || prev.brand,
      specification: 规格 || prev.specification,
      unit_cost: 采购价 ? toFixed2(采购价) : prev.unit_cost,
      unit_price: 销售价 ? toFixed2(销售价) : prev.unit_price,
      document_name: 单据名 || prev.document_name,
    }));
    标记本地编辑配件(part.id);
    const 更新: Record<string, unknown> = {};
    if (编码) 更新.part_number = 编码;
    if (品牌) 更新.brand = 品牌;
    if (规格) 更新.specification = 规格;
    if (采购价) 更新.unit_cost = parseFloat(采购价);
    if (销售价) 更新.unit_price = parseFloat(销售价);
    if (单据名) 更新.document_name = 单据名;
    if (Object.keys(更新).length === 0) return;
    const { error } = await supabase.from("work_order_item_parts").update(更新).eq("id", part.id);
    if (error) { alert("带回信息失败: " + error.message); return; }
    if (销售价) {
      window.dispatchEvent(new CustomEvent("wo-part-update", { detail: { itemId, partId: part.id, unit_price: parseFloat(销售价) } }));
    }
  }

  // 输入/扫码编码后：全库按编码精确查配件，按"叶子名与分组名"关系决定补齐或询问
  async function autoFillByPartNumber(partNumber: string) {
    const kw = partNumber.trim();
    if (!kw) return;
    // 全库精确查（不限本目录），带出叶子目录名
    const { data } = await supabase
      .from("parts")
      .select("id, part_number, part_name_id, unit_cost, unit_price, document_name, part_names(name), part_brands(name), part_specifications(name)")
      .eq("part_number", kw)
      .limit(2);
    if (!data || data.length === 0) return; // 系统无此编码：保留编码，留待"创建配件"(后续步骤)
    if (data.length > 1) { alert(`编码「${kw}」对应多个配件，请用编码后的候选或搜索精确选择`); return; }

    const d = data[0];
    const pb = d.part_brands as { name: string } | { name: string }[] | null;
    const ps = d.part_specifications as { name: string } | { name: string }[] | null;
    const pn = d.part_names as { name: string } | { name: string }[] | null;
    const 叶子名 = (Array.isArray(pn) ? pn[0]?.name : pn?.name) || "";
    const hit: 编码命中 = {
      id: d.id, part_number: d.part_number, name: 叶子名, part_name_id: d.part_name_id,
      brand: (Array.isArray(pb) ? pb[0]?.name : pb?.name) || "",
      specification: (Array.isArray(ps) ? ps[0]?.name : ps?.name) || "",
      unit_cost: d.unit_cost, unit_price: d.unit_price, document_name: d.document_name, 叶子名,
    };

    const 分组名 = (part.part_names?.name || part.name || "").trim();
    const 免询问 = 名称免询问(叶子名, 分组名);
    if (免询问) {
      // 名称一致/以"分组名-"开头 → 直接补齐（叶子目录用命中配件的，保持一致）
      await 应用命中配件(hit, hit.part_name_id ? { part_name_id: hit.part_name_id } : undefined);
      return;
    }

    // 名称不符 → 弹询问(a/b/c)。先查本组是否已有具体配件（决定能否"替换分组名"）
    let 本组已有具体配件 = false;
    if (part.branch_group_id) {
      const { count } = await supabase
        .from("work_order_item_parts")
        .select("id", { count: "exact", head: true })
        .eq("branch_group_id", part.branch_group_id)
        .not("part_id", "is", null)
        .neq("id", part.id);
      本组已有具体配件 = (count ?? 0) > 0;
    }
    set名称不符询问({ hit, 本组已有具体配件 });
  }

  // 把最新的编码补齐函数挂到 ref 上：切回本页(focus)时用它按编码把新建好的配件带回本分支。
  // 用 useEffect 更新(而非渲染期写 ref)，既满足 React 规则，又保证拿到最新的 part/editForm 闭包。
  useEffect(() => {
    autoFill引用.current = autoFillByPartNumber;
  });

  // a) 替换分组名：把本分组(同 branch_group_id)所有分支的叶子目录改成命中配件的，再补齐本分支
  async function 处理替换分组名() {
    const q = 名称不符询问; if (!q) return;
    set名称不符询问(null);
    if (part.branch_group_id && q.hit.part_name_id) {
      标记本地结构编辑(itemId);
      await supabase.from("work_order_item_parts")
        .update({ part_name_id: q.hit.part_name_id })
        .eq("branch_group_id", part.branch_group_id);
    }
    await 应用命中配件(q.hit, { part_name_id: q.hit.part_name_id || undefined });
  }

  // b) 新建分组：把本分支移到一个新目录(新 branch_group_id + 命中叶子目录)，作为唯一分支选中
  async function 处理新建分组() {
    const q = 名称不符询问; if (!q) return;
    set名称不符询问(null);
    const 新组id = (globalThis.crypto?.randomUUID?.() as string) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    // 若本分支原来是选中分支，且原组还有其它分支，先把原组另一条设为选中，避免原组 0 选中
    if (localSelected && part.branch_group_id) {
      const { data: 兄弟 } = await supabase.from("work_order_item_parts")
        .select("id").eq("branch_group_id", part.branch_group_id).neq("id", part.id)
        .order("sort_order", { ascending: true }).limit(1);
      if (兄弟 && 兄弟[0]) {
        标记本地编辑配件(兄弟[0].id);
        await supabase.from("work_order_item_parts").update({ is_selected: true }).eq("id", 兄弟[0].id);
      }
    }
    await 应用命中配件(q.hit, {
      part_name_id: q.hit.part_name_id || undefined,
      branch_group_id: 新组id,
      is_selected: true, // 新组唯一分支
    });
  }

  // 放大镜"选择配件"选中后：转成命中结构，按名称规则补齐/弹询问（复用编码补齐逻辑）
  async function 从选择器选中(parts: { id: string; part_number: string; part_name_id: string | null; unit_cost: number | null; unit_price: number | null; specification_text: string | null; part_names?: { name?: string | null } | null; part_brands?: { name?: string | null } | null; part_specifications?: { name?: string | null } | null; name?: string }[]) {
    set选择器打开(false);
    const p = parts[0];
    if (!p) return;
    const 叶子名 = p.part_names?.name || p.name || "";
    const hit: 编码命中 = {
      id: p.id, part_number: p.part_number, name: 叶子名, part_name_id: p.part_name_id,
      brand: p.part_brands?.name || "",
      specification: p.part_specifications?.name || p.specification_text || "",
      unit_cost: p.unit_cost, unit_price: p.unit_price, document_name: null, 叶子名,
    };
    const 分组名 = (part.part_names?.name || part.name || "").trim();
    const 免询问 = 名称免询问(叶子名, 分组名);
    if (免询问) {
      await 应用命中配件(hit, hit.part_name_id ? { part_name_id: hit.part_name_id } : undefined);
      return;
    }
    let 本组已有具体配件 = false;
    if (part.branch_group_id) {
      const { count } = await supabase
        .from("work_order_item_parts")
        .select("id", { count: "exact", head: true })
        .eq("branch_group_id", part.branch_group_id)
        .not("part_id", "is", null)
        .neq("id", part.id);
      本组已有具体配件 = (count ?? 0) > 0;
    }
    set名称不符询问({ hit, 本组已有具体配件 });
  }

  // 检查库存中是否有完全匹配的配件
  async function checkInventoryMatch() {
    if (!vehicleModelId || !part.part_name_id) return;
    if (!editForm.brand || !editForm.specification) return;

    // 查找品牌ID
    const { data: brandData } = await supabase.from("part_brands").select("id").eq("name", editForm.brand).single();
    if (!brandData) return;

    // 查找规格ID
    const { data: specData } = await supabase.from("part_specifications").select("id").eq("name", editForm.specification).single();
    if (!specData) return;

    // 查询parts表匹配配件名称+品牌+规格
    const { data: partsData } = await supabase
      .from("parts")
      .select("id, part_number, unit_cost, unit_price, part_vehicle_models(vehicle_model_id)")
      .eq("part_name_id", part.part_name_id)
      .eq("brand_id", brandData.id)
      .eq("specification_id", specData.id);

    if (!partsData || partsData.length === 0) return;

    // 过滤车型匹配的（无车型限制也算匹配）
    const matched = partsData.find((p: { part_vehicle_models?: Array<{ vehicle_model_id: string }> | null }) =>
      !p.part_vehicle_models || p.part_vehicle_models.length === 0 ||
      p.part_vehicle_models.some((vm) => vm.vehicle_model_id === vehicleModelId)
    );

    if (matched) {
      if (confirm("找到相同配件是否选择？")) {
        setSaving(true);
        const { error } = await supabase
          .from("work_order_item_parts")
          .update({ part_id: matched.id, part_number: matched.part_number || editForm.part_number })
          .eq("id", part.id);
        setSaving(false);
        if (error) {
          alert("关联失败: " + error.message);
          return;
        }
        // 自动填充价格和编码
        if (matched.unit_cost != null) setEditForm((prev) => ({ ...prev, unit_cost: toFixed2(matched.unit_cost) }));
        if (matched.unit_price != null) setEditForm((prev) => ({ ...prev, unit_price: toFixed2(matched.unit_price) }));
        if (matched.part_number) setEditForm((prev) => ({ ...prev, part_number: matched.part_number }));
        refresh();
      }
    }
  }

  async function togglePurchase() {
    if (!localOpinion || localOpinion !== "agree") {
      alert("需客户同意后才能采购");
      return;
    }
    if (!localPurchased && inventoryQty > 0) {
      alert("库存不为0，无需采购");
      return;
    }
    const next = !localPurchased;
    setLocalPurchased(next);
    setSaving(true);
    标记本地编辑配件(part.id);
    const { error } = await supabase
      .from("work_order_item_parts")
      .update({ is_purchased: next })
      .eq("id", part.id);
    setSaving(false);
    if (error) {
      alert("操作失败: " + error.message);
      setLocalPurchased(!next);
      return;
    }
  }

  async function toggleArrived() {
    if (!localPurchased) {
      alert("需先采购后才能标记到货");
      return;
    }
    const next = !localArrived;
    setLocalArrived(next);
    setSaving(true);
    标记本地编辑配件(part.id);
    const { error } = await supabase
      .from("work_order_item_parts")
      .update({ is_arrived: next })
      .eq("id", part.id);
    setSaving(false);
    if (error) {
      alert("操作失败: " + error.message);
      setLocalArrived(!next);
      return;
    }
  }

  async function handleDelete() {
    // 选中分支不可删除：保证每个目录始终有且仅有一个选中分支，
    // 也免去"删了选中分支后由谁替补"的随机问题。要删它，先选中别的分支。
    if (localSelected) {
      alert("选中的分支不能删除。如需删除，请先选中其它分支作为默认，再删除本条。");
      return;
    }
    if (!confirm("确定删除此配件分支吗？")) return;
    setSaving(true);
    标记本地编辑配件(part.id);

    // 原子删除：数据库一个事务完成"删分支 + 转移选中"，远程不稳也不会做一半（避免0选中）
    const { data, error } = await supabase.rpc("delete_part_branch", { p_part_id: part.id });
    setSaving(false);

    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    const result = data as { success: boolean; error?: string; new_selected_id?: string | null };
    if (!result?.success) {
      alert(result?.error || "删除失败");
      return;
    }

    // 立即隐藏本行（瞬间消失）
    setDeleted(true);
    // 广播"已删除"：小计/费用合计组件把这条从计算中彻底移除
    window.dispatchEvent(
      new CustomEvent("wo-part-update", {
        detail: { itemId, partId: part.id, deleted: true },
      })
    );
    // 若数据库转移了选中，广播让新选中分支点亮、小计按它重算
    if (result.new_selected_id) {
      标记本地编辑配件(result.new_selected_id);
      window.dispatchEvent(
        new CustomEvent("wo-part-update", {
          detail: { itemId, partId: result.new_selected_id, is_selected: true, siblingResetIds: [] },
        })
      );
    }
  }

  // 供应商推荐排序
  const recommendedSuppliers = useMemo(() => {
    if (!suppliers.length) return [];

    const categoryId = part.part_names?.category_id;

    return [...suppliers].sort((a, b) => {
      const getScore = (s: Supplier) => {
        let score = 0;
        const sid = s.id;

        // 车型匹配（厂商/品牌/车系任意一项匹配即可）
        if (vehicleInfo.厂商 || vehicleInfo.品牌 || vehicleInfo.车系) {
          const vmList = supplierVehicleMap.get(sid) || [];
          const hasVehicleMatch = vmList.some((vm) =>
            (vehicleInfo.厂商 && vm?.厂商 === vehicleInfo.厂商) ||
            (vehicleInfo.品牌 && vm?.品牌 === vehicleInfo.品牌) ||
            (vehicleInfo.车系 && vm?.车系 === vehicleInfo.车系)
          );
          if (hasVehicleMatch) score += 1000;
        }

        // 配件名称匹配
        if (part.part_name_id && matchedPartNameSupplierIds.has(sid)) score += 500;

        // 配件分类匹配
        if (categoryId && matchedCategorySupplierIds.has(sid)) score += 200;

        // 品牌匹配
        if (brandId && matchedBrandSupplierIds.has(sid)) score += 200;

        // 推荐等级加成
        score += (s.recommendation_level || 0) * 10;

        return score;
      };

      const aScore = getScore(a);
      const bScore = getScore(b);
      if (bScore !== aScore) return bScore - aScore;
      // 同分按名称排序
      return (a.name || "").localeCompare(b.name || "", "zh-CN");
    });
  }, [
    suppliers,
    vehicleInfo,
    supplierVehicleMap,
    part.part_name_id,
    part.part_names?.category_id,
    matchedPartNameSupplierIds,
    matchedCategorySupplierIds,
    matchedBrandSupplierIds,
    brandId,
  ]);

  // 判断供应商是否匹配当前条件
  function getSupplierMatchReasons(s: Supplier): string[] {
    const reasons: string[] = [];
    const sid = s.id;

    if (vehicleInfo.厂商 || vehicleInfo.品牌 || vehicleInfo.车系) {
      const vmList = supplierVehicleMap.get(sid) || [];
      const hasVehicleMatch = vmList.some((vm) =>
        (vehicleInfo.厂商 && vm?.厂商 === vehicleInfo.厂商) ||
        (vehicleInfo.品牌 && vm?.品牌 === vehicleInfo.品牌) ||
        (vehicleInfo.车系 && vm?.车系 === vehicleInfo.车系)
      );
      if (hasVehicleMatch) reasons.push("匹配车型");
    }

    if (part.part_name_id && matchedPartNameSupplierIds.has(sid)) reasons.push("匹配配件");
    if (part.part_names?.category_id && matchedCategorySupplierIds.has(sid)) reasons.push("匹配分类");
    if (brandId && matchedBrandSupplierIds.has(sid)) reasons.push("匹配品牌");

    return reasons;
  }

  const partName = part.alias_name || part.parts?.name || part.name || part.part_names?.name || "未命名配件";

  // 已删除：立即隐藏本行，不等整页刷新
  if (deleted) return null;

  return (
    <div ref={根容器Ref} className={`rounded border p-2 transition-colors ${saving ? "opacity-50" : ""} ${
      localSelected ? "bg-yellow-50/30 border-yellow-200" : "bg-white border-gray-100"
    }`}>
      {/* 所有内容一行显示 */}
      <div className="flex items-center flex-nowrap gap-x-3 gap-y-1 overflow-x-auto">
        {/* 选中（单选：空心圆带点）。选中分支不可取消、不可删除，切换靠选中其它分支 */}
        <label className={`relative w-4 h-4 cursor-pointer ${isLocked ? "opacity-50" : ""}`}>
          <input
            type="checkbox"
            checked={localSelected}
            onChange={async () => {
              // 已选中的分支不允许取消（避免出现 0 选中）；要换默认分支就点其它分支
              if (localSelected) return;
              const next = true;
              setLocalSelected(next);
              // 标记这些分支是"自己刚改的"，避免实时同步把整页刷掉（自己/别人改动区分）
              标记本地编辑配件(part.id);
              siblingIds.forEach((id) => 标记本地编辑配件(id));
              // 选中态已立即生效，写库放后台并行执行（不再整行变灰，性能优化）
              const writes = [];
              if (siblingIds.length > 0) {
                writes.push(supabase.from("work_order_item_parts").update({ is_selected: false }).in("id", siblingIds));
              }
              writes.push(supabase.from("work_order_item_parts").update({ is_selected: true }).eq("id", part.id));
              const results = await Promise.all(writes);
              const error = results.find((r) => r.error)?.error;
              if (error) {
                alert("操作失败: " + error.message);
                setLocalSelected(false);
                return;
              }
              // 广播给小计/费用合计组件
              window.dispatchEvent(
                new CustomEvent("wo-part-update", {
                  detail: {
                    itemId,
                    partId: part.id,
                    is_selected: true,
                    siblingResetIds: siblingIds,
                  },
                })
              );
            }}
            disabled={isLocked}
            className="peer sr-only"
          />
          <span className="absolute inset-0 rounded-full border-2 border-gray-300 peer-checked:border-blue-600 bg-white flex items-center justify-center transition-colors">
            <span className="w-2 h-2 rounded-full bg-blue-600 opacity-0 peer-checked:opacity-100 transition-opacity" />
          </span>
        </label>

        {/* 序号 */}
        <span className="text-xs text-gray-400 font-mono">{seqLabel}</span>

        {/* 配件名称 */}
        <span className="font-medium text-gray-800">{partName}</span>
        {part.alias_name && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600">别名</span>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400">单据</span>
          <input
            type="text"
            value={editForm.document_name}
            onChange={(e) => setEditForm((prev) => ({ ...prev, document_name: e.target.value }))}
            onBlur={() => saveField("document_name", editForm.document_name)}
            disabled={isLocked || saving}
            className="w-28 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            placeholder="采购单名称"
          />
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${inventoryQty > 0 ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
          库存: {inventoryQty}
        </span>

        {/* 编码（可输入/扫码，全库智能候选） */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[2.5em] text-right">编码</span>
          <div className="relative">
            <input
              ref={编码InputRef}
              type="text"
              value={editForm.part_number}
              onChange={(e) => { setEditForm((prev) => ({ ...prev, part_number: e.target.value })); set显示编码候选(true); set编码已录入(false); }}
              onKeyDown={async (e) => {
                const 有候选 = 显示编码候选 && editForm.part_number.trim().length >= 2 && 编码候选.length > 0;
                if (e.key === "ArrowDown" && 有候选) {
                  e.preventDefault();
                  set编码高亮((i) => (i + 1) % 编码候选.length);
                  return;
                }
                if (e.key === "ArrowUp" && 有候选) {
                  e.preventDefault();
                  set编码高亮((i) => (i <= 0 ? 编码候选.length - 1 : i - 1));
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  // 有高亮候选则选它，否则用当前输入
                  const 选中 = 有候选 && 编码高亮 >= 0 ? 编码候选[编码高亮] : null;
                  const 编码 = 选中 ? 选中.part_number : editForm.part_number.trim();
                  if (选中) setEditForm((prev) => ({ ...prev, part_number: 选中.part_number }));
                  set显示编码候选(false);
                  set编码高亮(-1);
                  if (编码) {
                    await saveField("part_number", 编码);
                    await autoFillByPartNumber(编码);
                  }
                  set编码已录入(true); // 回车=录入完成
                }
                if (e.key === "Escape") { set显示编码候选(false); set编码高亮(-1); }
              }}
              onBlur={async () => {
                setTimeout(() => set显示编码候选(false), 150);
                await saveField("part_number", editForm.part_number);
                set编码已录入(true); // 失焦=录入完成
              }}
              disabled={isLocked || saving}
              className="w-24 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
              placeholder="配件编码"
            />
            {显示编码候选 && editForm.part_number.trim().length >= 2 && 编码候选.length > 0 && (
              <div
                className="fixed z-[200] max-h-52 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg"
                style={{ top: 编码下拉Pos.top, left: 编码下拉Pos.left, width: 编码下拉Pos.width }}
              >
                {编码候选.map((c, idx) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => set编码高亮(idx)}
                    onClick={async () => {
                      setEditForm((prev) => ({ ...prev, part_number: c.part_number }));
                      set显示编码候选(false);
                      set编码高亮(-1);
                      set编码已录入(true);
                      await saveField("part_number", c.part_number);
                      await autoFillByPartNumber(c.part_number);
                    }}
                    className={`w-full text-left px-2 py-1 text-xs border-b border-gray-50 last:border-0 ${idx === 编码高亮 ? "bg-blue-100" : "hover:bg-blue-50"}`}
                  >
                    <span className="font-mono text-blue-700">{c.part_number}</span>
                    <span className="text-gray-500 ml-2">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* 放大镜：按当前分组名查系统已有配件 */}
          {!isLocked && (
            <button
              type="button"
              onClick={() => set选择器打开(true)}
              disabled={saving}
              className="shrink-0 text-gray-400 hover:text-blue-600 disabled:opacity-50 px-0.5"
              title="按配件名称查找系统配件"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
            </button>
          )}
        </div>

        {/* 品牌 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[2.5em] text-right">品牌</span>
          {availableBrands.length > 0 ? (
            <select
              value={editForm.brand}
              onChange={async (e) => {
                const val = e.target.value;
                setEditForm((prev) => ({ ...prev, brand: val }));
                await saveField("brand", val);
                await checkInventoryMatch();
              }}
              disabled={isLocked || saving}
              className="w-20 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            >
              <option value="">选择品牌</option>
              {availableBrands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={editForm.brand}
              onChange={(e) => setEditForm((prev) => ({ ...prev, brand: e.target.value }))}
              onBlur={async () => {
                await saveField("brand", editForm.brand);
                await checkInventoryMatch();
              }}
              disabled={isLocked || saving}
              className="w-20 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
              placeholder="品牌"
            />
          )}
        </div>

        {/* 规格 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[2.5em] text-right">规格</span>
          {availableSpecs.length > 0 ? (
            <select
              value={editForm.specification}
              onChange={async (e) => {
                const val = e.target.value;
                setEditForm((prev) => ({ ...prev, specification: val }));
                await saveField("specification", val);
                await checkInventoryMatch();
              }}
              disabled={isLocked || saving}
              className="w-24 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
            >
              <option value="">选择规格</option>
              {availableSpecs.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={editForm.specification}
              onChange={(e) => setEditForm((prev) => ({ ...prev, specification: e.target.value }))}
              onBlur={async () => {
                await saveField("specification", editForm.specification);
                await checkInventoryMatch();
              }}
              disabled={isLocked || saving}
              className="w-24 px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-50"
              placeholder="规格"
            />
          )}
        </div>

        {/* 采购价 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[3em] text-right">采购价</span>
          {showPrices ? (
            <input
              type="number"
              step="0.01"
              value={editForm.unit_cost}
              onChange={(e) => setEditForm((prev) => ({ ...prev, unit_cost: e.target.value }))}
              onBlur={() => saveField("unit_cost", editForm.unit_cost)}
              disabled={isLocked || saving}
              className="w-16 px-1 py-0.5 border border-gray-200 rounded text-xs text-right disabled:bg-gray-50"
              placeholder="采购价"
            />
          ) : (
            <span className="w-16 px-1 py-0.5 text-xs text-right text-gray-700">***</span>
          )}
        </div>

        {/* 成本价 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[3em] text-right">成本价</span>
          {showPrices ? (
            <input
              type="number"
              step="0.01"
              value={editForm.cost_price}
              onChange={(e) => setEditForm((prev) => ({ ...prev, cost_price: e.target.value }))}
              onBlur={() => saveField("cost_price", editForm.cost_price)}
              disabled={isLocked || saving}
              className="w-16 px-1 py-0.5 border border-gray-200 rounded text-xs text-right disabled:bg-gray-50"
              placeholder="成本价"
            />
          ) : (
            <span className="w-16 px-1 py-0.5 text-xs text-right text-gray-700">***</span>
          )}
        </div>

        {/* 销售价 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 min-w-[3em] text-right">销售价</span>
          {showPrices ? (
            <input
              type="number"
              step="0.01"
              value={editForm.unit_price}
              onChange={(e) => {
                const val = e.target.value;
                setEditForm((prev) => ({ ...prev, unit_price: val }));
                // 实时广播更新，让小计/费用合计组件即时刷新
                window.dispatchEvent(
                  new CustomEvent("wo-part-update", {
                    detail: {
                      itemId,
                      partId: part.id,
                      unit_price: val === "" ? 0 : parseFloat(val) || 0,
                    },
                  })
                );
              }}
              onBlur={() => saveField("unit_price", editForm.unit_price)}
              disabled={isLocked || saving}
              className="w-16 px-1 py-0.5 border border-gray-200 rounded text-xs text-right disabled:bg-gray-50"
              placeholder="销售价"
            />
          ) : (
            <span className="w-16 px-1 py-0.5 text-xs text-right text-gray-700">***</span>
          )}
        </div>

        {/* 客户意见 */}
        {/* 客户意见 */}
        <span className="text-[10px] text-gray-400">客户意见:</span>
        {!isLocked ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (clickTimer.current) {
                clearTimeout(clickTimer.current);
                clickTimer.current = null;
                return;
              }
              clickTimer.current = setTimeout(() => {
                clickTimer.current = null;
                // 单击: 同意 / 取消同意
                const next = localOpinion === "agree" ? "pending" : "agree";
                setLocalOpinion(next);
                setSaving(true);
                标记本地编辑配件(part.id);
                supabase.from("work_order_item_parts").update({ customer_opinion: next }).eq("id", part.id).then(({ error }) => {
                  setSaving(false);
                  if (error) {
                    alert("保存失败: " + error.message);
                    setLocalOpinion(part.customer_opinion || "pending");
                  }
                });
              }, 250);
            }}
            onDoubleClick={() => {
              if (clickTimer.current) {
                clearTimeout(clickTimer.current);
                clickTimer.current = null;
              }
              // 双击: 拒绝 / 取消拒绝
              const next = localOpinion === "reject" ? "pending" : "reject";
              setLocalOpinion(next);
              setSaving(true);
              标记本地编辑配件(part.id);
              supabase.from("work_order_item_parts").update({ customer_opinion: next }).eq("id", part.id).then(({ error }) => {
                setSaving(false);
                if (error) {
                  alert("保存失败: " + error.message);
                  setLocalOpinion(part.customer_opinion || "pending");
                }
              });
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-50 cursor-pointer select-none ${
              localOpinion === "agree"
                ? "bg-green-50 text-green-700 border-green-200"
                : localOpinion === "reject"
                ? "bg-red-50 text-red-700 border-red-200"
                : "bg-yellow-50 text-yellow-700 border-yellow-200"
            }`}
          >
            {localOpinion === "agree" ? "客户同意" : localOpinion === "reject" ? "客户拒绝" : "待确认"}
          </button>
        ) : (
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
            part.customer_opinion === "agree"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}>
            {part.customer_opinion === "agree" ? "客户同意" : part.customer_opinion === "reject" ? "客户拒绝" : "待确认"}
          </span>
        )}

        {/* 是否采购 */}
        {!isLocked && (
          <button
            type="button"
            onClick={togglePurchase}
            disabled={saving}
            className={`text-[10px] px-2 py-0.5 rounded border disabled:opacity-50 ${
              localPurchased
                ? "bg-green-50 text-green-700 border-green-200"
                : localOpinion === "agree" && inventoryQty === 0
                ? "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
            }`}
            title={
              localPurchased
                ? "已采购，点击取消"
                : localOpinion !== "agree"
                ? "需客户同意"
                : inventoryQty > 0
                ? "库存不为0"
                : "点击标记已采购"
            }
          >
            {localPurchased ? "已采购" : "未采购"}
          </button>
        )}

        {/* 是否到货 */}
        {!isLocked && (
          <button
            type="button"
            onClick={toggleArrived}
            disabled={saving || !localPurchased}
            className={`text-[10px] px-2 py-0.5 rounded border disabled:opacity-50 ${
              localArrived
                ? "bg-green-50 text-green-700 border-green-200"
                : localPurchased
                ? "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
            }`}
            title={localArrived ? "已到货，点击取消" : localPurchased ? "点击标记已到货" : "需先采购"}
          >
            {localArrived ? "已到货" : "未到货"}
          </button>
        )}

        {/* 供应商选择（自定义下拉，展示窄、下拉宽） */}
        {!isLocked && suppliers.length > 0 && (
          <div className="relative">
            <button
              ref={supplierButtonRef}
              type="button"
              onClick={() => setSupplierDropdownOpen((v) => !v)}
              disabled={saving}
              className="text-[10px] px-2 py-0.5 border border-gray-200 rounded disabled:opacity-50 w-20 text-left truncate bg-white"
              title={editForm.supplier_name || "选择供应商"}
            >
              {editForm.supplier_name || "选择供应商"}
            </button>
            {supplierDropdownOpen && (
              <div
                ref={supplierDropdownRef}
                className="fixed z-[100] bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto w-56"
                style={{ top: dropdownPos.top, left: dropdownPos.left }}
              >
                <div
                  className="px-2 py-1 text-[10px] hover:bg-gray-100 cursor-pointer text-gray-400"
                  onClick={() => {
                    setEditForm((prev) => ({ ...prev, supplier_name: "" }));
                    saveField("supplier_name", "");
                    setSupplierDropdownOpen(false);
                  }}
                >
                  选择供应商
                </div>
                {recommendedSuppliers.map((s) => {
                  const reasons = getSupplierMatchReasons(s);
                  const stars = s.recommendation_level > 0 ? "⭐".repeat(s.recommendation_level) + " " : "";
                  return (
                    <div
                      key={s.id}
                      className={`px-2 py-1 text-[10px] hover:bg-blue-50 cursor-pointer border-t border-gray-50 ${
                        editForm.supplier_name === s.name ? "bg-blue-50 text-blue-700" : ""
                      }`}
                      onClick={() => {
                        setEditForm((prev) => ({ ...prev, supplier_name: s.name }));
                        saveField("supplier_name", s.name);
                        setSupplierDropdownOpen(false);
                      }}
                    >
                      <div className="font-medium">{stars}{s.name}</div>
                      {reasons.length > 0 && (
                        <div className="text-[10px] text-gray-400 mt-0.5">{reasons.join(" · ")}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 库存提示 */}
        {inventoryQty > 0 && (
          <span className="text-[10px] text-gray-400">库存: {inventoryQty}</span>
        )}

        {/* 删除：选中分支不可删（避免0选中/替补随机）；灰掉并提示先选别的 */}
        {!isLocked && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving || localSelected}
            title={localSelected ? "选中的分支不能删除，请先选中其它分支" : "删除此分支"}
            className={`text-[10px] px-1 disabled:opacity-50 ${
              localSelected ? "text-gray-300 cursor-not-allowed" : "text-red-600 hover:text-red-700"
            }`}
          >
            删除
          </button>
        )}

        {children}
      </div>

      {/* 编码有值但系统无此配件(未关联 part_id)→ 可创建配件到配件库。
          放在横向滚动行之外，避免被挤出可视区看不见。 */}
      {!isLocked && 编码已录入 && editForm.part_number.trim().length >= 2 && 编码在系统 === false && (
        <div className="mt-1 pl-7">
          <button
            type="button"
            onClick={打开创建弹窗}
            className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200"
            title="系统中没有此配件，点击创建到配件库"
          >
            ＋ 系统无此编码，创建配件「{editForm.part_number.trim()}」
          </button>
        </div>
      )}

      {/* 放大镜"选择配件"弹窗：按当前分组名预过滤、车型高亮，选中后补齐本分支 */}
      {选择器打开 && (
        <PartPickerModal
          open={选择器打开}
          onClose={() => set选择器打开(false)}
          onConfirm={从选择器选中}
          vehicleModelId={vehicleModelId}
          defaultNameQuery={part.part_names?.name || part.name || ""}
        />
      )}

      {/* 创建配件弹窗：带入本分支已填信息；保存成功→关联带回；未保存关闭→仅带回文字 */}
      {创建弹窗打开 && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={创建取消带回}>
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-6xl max-h-[90vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-semibold text-gray-900">创建配件</h3>
              <button
                type="button"
                onClick={创建取消带回}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                title="关闭（会把已填信息带回本分支）"
              >
                &times;
              </button>
            </div>
            <div className="p-6">
              <PartForm
                onSaved={创建保存成功}
                onCancel={创建取消带回}
                onDraftChange={(d) => { 创建草稿.current = d; }}
                prefillData={创建预填 || undefined}
              />
            </div>
          </div>
        </div>
      )}

      {/* 编码命中但名称与分组不符：a 替换分组名 / b 新建分组（c：本组已有具体配件时只给新建分组，仍需确认） */}
      {名称不符询问 && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50" onClick={() => set名称不符询问(null)}>
          <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-2">配件名称与分组不一致</h3>
            <p className="text-sm text-gray-600 mb-1">
              编码 <span className="font-mono text-blue-700">{名称不符询问.hit.part_number}</span> 对应的配件属于
              「<span className="font-medium">{名称不符询问.hit.叶子名}</span>」，
              与本分组「<span className="font-medium">{part.part_names?.name || part.name || "-"}</span>」不一致。
            </p>
            {名称不符询问.本组已有具体配件 ? (
              <p className="text-xs text-amber-600 mb-3">本分组下已有具体配件，不能改分组名，只能把这条移到新分组。</p>
            ) : (
              <p className="text-xs text-gray-400 mb-3">请选择处理方式：</p>
            )}
            <div className="space-y-2">
              {!名称不符询问.本组已有具体配件 && (
                <button
                  type="button"
                  onClick={处理替换分组名}
                  className="w-full px-4 py-2.5 text-sm text-left rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                >
                  <span className="font-medium">替换分组名</span>
                  <span className="text-xs text-blue-500 ml-2">把本分组改名为「{名称不符询问.hit.叶子名}」并补齐本分支</span>
                </button>
              )}
              <button
                type="button"
                onClick={处理新建分组}
                className="w-full px-4 py-2.5 text-sm text-left rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
              >
                <span className="font-medium">新建分组</span>
                <span className="text-xs text-green-600 ml-2">把本分支移到新分组「{名称不符询问.hit.叶子名}」</span>
              </button>
              <button
                type="button"
                onClick={() => set名称不符询问(null)}
                className="w-full px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
