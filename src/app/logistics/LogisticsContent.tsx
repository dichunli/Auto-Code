"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { createClient } from "@/lib/supabase/client";
import { 更新供应商电话 } from "@/app/suppliers/actions";
import { 结清运费, 删除物流公司, 删除运单, 保存运单, 批量建运单, 保存运单行内字段, 保存物流公司, 交换物流公司排序, 保存物流公司排序号, 创建物流结算单, 作废物流结算单, 标记代收已转付 } from "@/app/logistics/actions";
import { useToast } from "@/components/Toast";
import { 刷新基础数据缓存 } from "@/app/work-orders/actions";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ImageUploader } from "@/components/ImageUploader";
import { toast } from "@/lib/globalToast";

type Tab = "waybills" | "companies" | "settlements";

/* 物流结算单（2026-09-15 批次3） */
interface Settlement {
  id: string;
  settlement_no: string;
  logistics_company_id: string;
  waybill_count: number;
  total_amount: number;
  payment_method: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
  note: string | null;
  created_at: string;
  logistics_companies: { name: string } | null;
  profiles: { full_name: string } | null;
}

/* 结算单明细（展开查看） */
interface SettlementItemRow {
  id: string;
  waybill_id: string;
  freight_amount: number;
  logistics_waybills: { tracking_no: string } | null;
}

interface LogisticsCompany {
  id: string;
  name: string;
  scopes: string[] | null;
  contact: string | null;
  phone: string | null;
  tracking_url: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

interface Waybill {
  id: string;
  tracking_no: string;
  logistics_company_id: string | null;
  logistics_company_name: string | null;
  phone: string | null;
  supplier_name: string | null;
  package_count: number | null;
  freight_amount: number | null;
  cod_amount: number | null;
  photos: string[] | null;
  status: string;
  freight_settled: boolean | null;
  /* 2026-09-15 批次5：代收货款转付核对 */
  cod_transferred?: boolean | null;
  created_at: string;
  notes: string | null;
  logistics_companies: { name: string; scopes: string[] | null } | null;
  purchase_orders?: { id: string; order_no: string | null }[];
}

const SCOPE_LABELS: Record<string, string> = {
  harbin: "哈市",
  outside: "外阜",
};

const SCOPE_STYLES: Record<string, string> = {
  harbin: "bg-blue-50 text-blue-600 border-blue-200",
  outside: "bg-orange-50 text-orange-600 border-orange-200",
};

function ScopesBadges({ scopes }: { scopes: string[] | null | undefined }) {
  if (!scopes || scopes.length === 0) return <span className="text-gray-400">-</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {scopes.map((s) => (
        <span
          key={s}
          className={`text-xs px-2 py-0.5 rounded border ${SCOPE_STYLES[s] || "bg-gray-50 text-gray-600 border-gray-200"}`}
        >
          {SCOPE_LABELS[s] || s}
        </span>
      ))}
    </span>
  );
}

interface Props {
  initialWaybills: unknown[];
  initialWaybillCount: number;
  initialCompanies: unknown[];
  initialSuppliers: unknown[];
}

export default function LogisticsContent({ initialWaybills, initialWaybillCount, initialCompanies, initialSuppliers }: Props) {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<Tab>("waybills");

  /* 运单数据 */
  const [waybills, setWaybills] = useState<Waybill[]>(initialWaybills as Waybill[]);
  const [waybillLoading, setWaybillLoading] = useState(false);
  const [filter, setFilter] = useState("pending");
  /* 运单分页状态：首屏数据由服务端给（第 1 页），后续翻页走 loadWaybills */
  const [waybillTotal, setWaybillTotal] = useState(initialWaybillCount);
  const [waybillPage, setWaybillPage] = useState(1);
  const waybillPageSize = 20;
  const waybillTotalPages = Math.max(1, Math.ceil(waybillTotal / waybillPageSize));

  /* 物流公司数据 */
  const [companies, setCompanies] = useState<LogisticsCompany[]>(initialCompanies as LogisticsCompany[]);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [scopeFilter, setScopeFilter] = useState("all");

  /* 供应商数据(用于弹窗补充电话) */
  /* 供应商下拉数据：首屏服务端给，运行期不变，直接取用（无需 state） */
  const suppliersList = initialSuppliers as { id: string; name: string }[];

  /* 编辑弹窗 */
  const [editing, setEditing] = useState<LogisticsCompany | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  /* 批量创建弹窗 */
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchCompanyId, setBatchCompanyId] = useState("");
  const [batchTrackingNos, setBatchTrackingNos] = useState("");
  const [batchCount, setBatchCount] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);

  /* 行内编辑状态: 记录正在编辑的字段 */
  const [inlineEditing, setInlineEditing] = useState<Record<string, Record<string, string>>>({});
  /* 行内编辑电话时的实时供应商提示 */
  const [inlinePhoneHints, setInlinePhoneHints] = useState<Record<string, string>>({});
  /* 运费结清中（三期：运费单独和物流公司结算） */
  const [settlingId, setSettlingId] = useState<string | null>(null);
  /* 各物流公司未结运费余额（debit 应付 − payment 已付） */
  const [运费余额, set运费余额] = useState<Record<string, number>>({});

  /* 物流结算单（批次3）：页签数据 + 新建结算弹窗 + 作废 */
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [settleModalCompany, setSettleModalCompany] = useState<LogisticsCompany | null>(null);
  const [expandedSettlement, setExpandedSettlement] = useState<string | null>(null);
  const [settlementItems, setSettlementItems] = useState<Record<string, SettlementItemRow[]>>({});

  /* 单个创建运单弹窗 */
  const [singleModalOpen, setSingleModalOpen] = useState(false);
  const [singleTrackingNo, setSingleTrackingNo] = useState("");
  const [singleCompanyId, setSingleCompanyId] = useState("");
  const [singlePhone, setSinglePhone] = useState("");
  const [singleSupplierName, setSingleSupplierName] = useState("");
  const [singlePackageCount, setSinglePackageCount] = useState("");
  const [singleFreight, setSingleFreight] = useState("");
  const [singleCod, setSingleCod] = useState("");
  const [singlePhotos, setSinglePhotos] = useState<string[]>([]);
  const [singleNotes, setSingleNotes] = useState("");
  const [singleSaving, setSingleSaving] = useState(false);
  const [attachSupplierId, setAttachSupplierId] = useState("");
  const [editingWaybill, setEditingWaybill] = useState<Waybill | null>(null);
  const phoneLookupLock = useRef(false);
  const 首次挂载 = useRef(true);
  const { 请求确认, 确认弹窗 } = useConfirm();
  const { showToast } = useToast();

  /* Tab切换和筛选变化时重新加载（跳过首次挂载，数据已从服务端预加载），回到第 1 页 */
  useEffect(() => {
    if (首次挂载.current) return;
    if (activeTab === "waybills") loadWaybills(1);
  }, [filter, activeTab]);

  useEffect(() => {
    if (首次挂载.current) return;
    if (activeTab === "companies") loadCompanies();
    if (activeTab === "settlements") loadSettlements();
  }, [scopeFilter, activeTab]);

  /* 初始化标记：在所有 useEffect 之后，用一个 layout 级别标记首次挂载完成 */
  useEffect(() => {
    首次挂载.current = false;
  }, []);

  /* 通过主电话或联系人电话搜索供应商 */
  async function findSupplierByPhone(phone: string): Promise<{ id: string; name: string } | null> {
    if (!phone.trim()) return null;
    const val = phone.trim();
    // 先查主电话
    const { data: main } = await supabase
      .from("suppliers")
      .select("id, name")
      .ilike("phone", `%${val}%`)
      .limit(1);
    if (main && main.length > 0) return main[0];
    // 再查联系人电话
    const { data: contacts } = await supabase
      .from("supplier_contacts")
      .select("supplier_id")
      .ilike("phone", `%${val}%`)
      .limit(1);
    if (contacts && contacts.length > 0) {
      const { data: sup } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("id", contacts[0].supplier_id)
        .single();
      if (sup) return sup;
    }
    return null;
  }

  /* 运单电话输入时实时检索供应商 */
  useEffect(() => {
    async function lookup() {
      if (phoneLookupLock.current) {
        phoneLookupLock.current = false;
        return;
      }
      if (!singlePhone.trim()) {
        setSingleSupplierName("");
        return;
      }
      const result = await findSupplierByPhone(singlePhone);
      if (result) {
        setSingleSupplierName(result.name);
      }
    }
    lookup();
  }, [singlePhone, supabase]);

  async function loadWaybills(目标页: number) {
    /* 客户端 session 丢失时不查询，避免空结果覆盖服务端数据 */
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setWaybillLoading(true);
    const from = (目标页 - 1) * waybillPageSize;
    let query = supabase
      .from("logistics_waybills")
      .select("*, logistics_companies(name, scopes)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + waybillPageSize - 1);

    if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data: waybillData, count } = await query;
    const waybillsData = (waybillData || []) as Waybill[];
    setWaybillTotal(count || 0);
    setWaybillPage(目标页);

    /* 批量查询关联的采购单（保持基于当前页 ids） */
    if (waybillsData.length > 0) {
      const waybillIds = waybillsData.map((w) => w.id);
      const { data: poData } = await supabase
        .from("purchase_orders")
        .select("id, order_no, waybill_id")
        .in("waybill_id", waybillIds);

      const poMap = new Map<string, { id: string; order_no: string | null }[]>();
      for (const po of poData || []) {
        if (!poMap.has(po.waybill_id)) poMap.set(po.waybill_id, []);
        poMap.get(po.waybill_id)!.push({ id: po.id, order_no: po.order_no });
      }

      setWaybills(
        waybillsData.map((w) => ({
          ...w,
          purchase_orders: poMap.get(w.id) || [],
        }))
      );
    } else {
      setWaybills(waybillsData);
    }
    setWaybillLoading(false);
  }

  async function loadCompanies() {
    /* 客户端 session 丢失时不查询，避免空结果覆盖服务端数据 */
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setCompanyLoading(true);
    let query = supabase
      .from("logistics_companies")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (scopeFilter !== "all") {
      query = query.contains("scopes", [scopeFilter]);
    }

    const { data, error } = await query;
    if (error) {
      console.error("物流公司加载失败:", error);
      toast("加载失败: " + error.message, "error");
    }
    setCompanies((data as LogisticsCompany[]) || []);

    /* 未结运费余额：应付(debit) − 已付(payment)，按物流公司汇总
       2026-09-15 批次4：改为数据库聚合 RPC，不再全量拉流水前端加总 */
    const { data: 余额行 } = await supabase.rpc("logistics_company_balances");
    const 余额: Record<string, number> = {};
    for (const r of (余额行 || []) as { company_id: string; balance: number }[]) {
      余额[r.company_id] = Number(r.balance || 0);
    }
    set运费余额(余额);
    setCompanyLoading(false);
  }

  /* ─── 物流结算单（批次3） ─── */
  async function loadSettlements() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setSettlementsLoading(true);
    const { data, error } = await supabase
      .from("logistics_settlements")
      .select("*, logistics_companies(name), profiles!logistics_settlements_created_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(200);
    setSettlementsLoading(false);
    if (error) {
      toast("加载结算单失败: " + error.message, "error");
      return;
    }
    setSettlements((data || []) as Settlement[]);
    setSettlementItems({});
    setExpandedSettlement(null);
  }

  /* 展开/收起结算明细（首次展开时拉取） */
  async function 切换结算明细(s: Settlement) {
    if (expandedSettlement === s.id) {
      setExpandedSettlement(null);
      return;
    }
    setExpandedSettlement(s.id);
    if (settlementItems[s.id]) return;
    const { data, error } = await supabase
      .from("logistics_settlement_items")
      .select("id, waybill_id, freight_amount, logistics_waybills(tracking_no)")
      .eq("settlement_id", s.id)
      .order("created_at");
    if (error) {
      toast("加载结算明细失败: " + error.message, "error");
      return;
    }
    setSettlementItems((prev) => ({ ...prev, [s.id]: (data || []) as unknown as SettlementItemRow[] }));
  }

  async function handleVoidSettlement(s: Settlement) {
    if (
      !(await 请求确认({
        title: "作废结算单",
        message: `确定作废结算单 ${s.settlement_no}（${s.logistics_companies?.name || ""}，${s.waybill_count} 张运单，${formatCurrency(s.total_amount)}）吗？\n\n作废后：付款流水删除，这批运单恢复未结清状态。`,
        confirmText: "确定作废",
      }))
    )
      return;
    const res = await 作废物流结算单(s.id);
    if (!res.success) {
      toast("作废失败: " + (res.error || "未知错误"), "error");
      return;
    }
    toast(`结算单 ${s.settlement_no} 已作废`, "success");
    loadSettlements();
    /* 余额也可能变了（运单恢复未结） */
    loadCompanies();
  }

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(company: LogisticsCompany) {
    setEditing(company);
    setModalOpen(true);
  }

  async function handleDelete(company: LogisticsCompany) {
    if (!(await 请求确认(`确定删除物流公司「${company.name}」吗？`))) return;

    const result = await 删除物流公司(company.id);
    if (!result.success) {
      toast("删除失败: " + (result.error || "未知错误"), "error");
      return;
    }
    await 刷新基础数据缓存();
    loadCompanies();
  }

  async function handleDeleteWaybill(w: Waybill) {
    if (!(await 请求确认(`确定删除运单「${w.tracking_no}」吗？`))) return;
    const result = await 删除运单(w.id);
    if (!result.success) {
      toast("删除失败: " + (result.error || "未知错误"), "error");
      return;
    }
    /* 若删的是当前页最后一条且不在第 1 页，退到上一页，避免停在空页 */
    const 目标页 = waybills.length === 1 && waybillPage > 1 ? waybillPage - 1 : waybillPage;
    loadWaybills(目标页);
  }

  /* 代收货款转付核对（批次5）：货运站把代收款转给供应商后确认 */
  async function handleMarkCodTransferred(w: Waybill) {
    if (!(await 请求确认(`确认运单「${w.tracking_no}」的代收货款 ${formatCurrency(w.cod_amount)} 货运站已转付给供应商？`))) return;
    const res = await 标记代收已转付(w.id);
    if (!res.success) {
      toast("标记失败: " + (res.error || "未知错误"), "error");
      return;
    }
    toast("已标记代收转付", "success");
    loadWaybills(waybillPage);
  }

  /* 结清运费（三期）：运费是付给物流公司的，和供应商应付款无关，在这里单独结算 */
  async function handleSettleFreight(w: Waybill) {
    if (!(await 请求确认(`确认运单「${w.tracking_no}」的运费 ${formatCurrency(w.freight_amount)} 已和物流公司结清？`))) return;
    setSettlingId(w.id);
    try {
      const res = await 结清运费(w.id);
      if (!res.success) throw new Error(res.error || "结清失败");
      loadWaybills(waybillPage);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("结清运费失败: " + msg, "error");
    } finally {
      setSettlingId(null);
    }
  }


  function generateSingleTrackingNo(): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomStr = Math.floor(1000 + Math.random() * 9000);
    return `YD-${dateStr}-${randomStr}`;
  }

  function openSingleCreateModal() {
    setEditingWaybill(null);
    setSingleTrackingNo(generateSingleTrackingNo());
    setSingleCompanyId("");
    setSinglePhone("");
    setSingleSupplierName("");
    setSinglePackageCount("");
    setSingleFreight("");
    setSingleCod("");
    setSinglePhotos([]);
    setSingleNotes("");
    setAttachSupplierId("");
    setSingleModalOpen(true);
  }

  function openEditWaybillModal(w: Waybill) {
    phoneLookupLock.current = true;
    setEditingWaybill(w);
    setSingleTrackingNo(w.tracking_no);
    setSingleCompanyId(w.logistics_company_id || "");
    setSinglePhone(w.phone || "");
    setSingleSupplierName(w.supplier_name || "");
    setSinglePackageCount(String(w.package_count || 1));
    setSingleFreight(String(w.freight_amount || ""));
    setSingleCod(String(w.cod_amount || ""));
    setSinglePhotos(w.photos || []);
    setSingleNotes(w.notes || "");
    setAttachSupplierId("");
    setSingleModalOpen(true);
  }

  function closeSingleCreateModal() {
    phoneLookupLock.current = false;
    setSingleModalOpen(false);
    setEditingWaybill(null);
    setSingleTrackingNo("");
    setSingleCompanyId("");
    setSinglePhone("");
    setSingleSupplierName("");
    setAttachSupplierId("");
    setSinglePackageCount("");
    setSingleFreight("");
    setSingleCod("");
    setSinglePhotos([]);
    setSingleNotes("");
  }

  async function handleAttachPhone() {
    if (!attachSupplierId) {
      toast("请先选择供应商", "warning");
      return;
    }
    const supplier = suppliersList.find((s) => s.id === attachSupplierId);
    if (!supplier) {
      toast("供应商选择无效", "error");
      return;
    }
    /* 2026-08-16 RLS 收紧收编：suppliers 写已限 admin/boss/warehouse，改走 Server Action */
    const res = await 更新供应商电话(attachSupplierId, singlePhone);
    if (!res.success) {
      toast("补充电话失败: " + (res.error || "未知错误"), "error");
      return;
    }
    setSingleSupplierName(supplier.name);
    toast(`已将电话 ${singlePhone.trim()} 补充到供应商「${supplier.name}」`, "warning");
  }

  async function handleSingleCreate() {
    if (!singleTrackingNo.trim()) {
      toast("请填写运单号", "warning");
      return;
    }
    if (!singlePackageCount.trim() || isNaN(parseInt(singlePackageCount)) || parseInt(singlePackageCount) <= 0) {
      toast("请填写件数", "warning");
      return;
    }
    if (singleFreight.trim() === "" || isNaN(parseFloat(singleFreight))) {
      toast("请填写运费金额", "warning");
      return;
    }
    if (singleCod.trim() === "" || isNaN(parseFloat(singleCod))) {
      toast("请填写代收金额", "warning");
      return;
    }
    setSingleSaving(true);
    const company = companies.find((c) => c.id === singleCompanyId);
    try {
      /* 写库走 Server Action */
      const result = await 保存运单({
        id: editingWaybill?.id || null,
        trackingNo: singleTrackingNo,
        logisticsCompanyId: singleCompanyId,
        logisticsCompanyName: company?.name || "",
        phone: singlePhone,
        supplierName: singleSupplierName,
        packageCount: parseInt(singlePackageCount) || 1,
        freightAmount: parseFloat(singleFreight) || 0,
        codAmount: parseFloat(singleCod) || 0,
        photos: singlePhotos,
        notes: singleNotes,
      });
      if (!result.success) throw new Error(result.error || "保存失败");
      /* 编辑后留在当前页，新建回第 1 页（新运单按创建时间倒序在最前） */
      const 是编辑 = !!editingWaybill;
      closeSingleCreateModal();
      loadWaybills(是编辑 ? waybillPage : 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast((editingWaybill ? "保存" : "创建") + "运单失败: " + message, "error");
    } finally {
      setSingleSaving(false);
    }
  }

  async function handleBatchCreate() {
    if (!batchCompanyId) {
      toast("请选择物流公司", "warning");
      return;
    }

    const lines = batchTrackingNos
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let trackingNos: string[] = [];

    if (lines.length > 0) {
      trackingNos = lines;
    } else {
      const count = parseInt(batchCount, 10);
      if (isNaN(count) || count <= 0) {
        toast("请至少输入一个物流单号，或填写创建数量", "warning");
        return;
      }
      for (let i = 0; i < count; i++) {
        trackingNos.push(generateSingleTrackingNo() + `-${i + 1}`);
      }
    }

    setBatchSaving(true);
    const company = companies.find((c) => c.id === batchCompanyId);

    /* 写库走 Server Action */
    const result = await 批量建运单({
      logisticsCompanyId: batchCompanyId,
      logisticsCompanyName: company?.name || "",
      trackingNos,
    });
    setBatchSaving(false);
    if (!result.success) {
      toast("批量创建失败: " + (result.error || "未知错误"), "error");
      return;
    }
    setBatchModalOpen(false);
    setBatchTrackingNos("");
    setBatchCount("");
    setBatchCompanyId("");
    /* 批量新建回第 1 页（新运单在最前） */
    loadWaybills(1);
  }

  /* 行内保存某个字段（走 Server Action；电话变更时供应商名在服务端同步） */
  async function saveInlineField(waybillId: string, field: keyof Waybill, value: string) {
    if (field !== "phone" && field !== "package_count" && field !== "freight_amount" && field !== "cod_amount") return;

    const result = await 保存运单行内字段({ waybillId, field, value });
    if (!result.success) {
      toast("保存失败: " + (result.error || "未知错误"), "error");
      /* 保存失败刷新当前页，回滚本地编辑状态 */
      loadWaybills(waybillPage);
      return;
    }

    /* 行内字段保存完成，刷新当前页 */
    loadWaybills(waybillPage);
  }

  function startInlineEdit(waybillId: string, field: keyof Waybill, currentValue: string | number | null) {
    setInlineEditing((prev) => ({
      ...prev,
      [waybillId]: {
        ...prev[waybillId],
        [field]: String(currentValue ?? ""),
      },
    }));
  }

  function cancelInlineEdit(waybillId: string, field: keyof Waybill) {
    setInlineEditing((prev) => {
      const next = { ...prev };
      if (next[waybillId]) {
        const rest = { ...next[waybillId] };
        delete rest[field];
        next[waybillId] = rest;
        if (Object.keys(rest).length === 0) delete next[waybillId];
      }
      return next;
    });
    if (field === "phone") {
      setInlinePhoneHints((prev) => {
        const next = { ...prev };
        delete next[waybillId];
        return next;
      });
    }
  }

  async function moveCompany(index: number, direction: "up" | "down") {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === companies.length - 1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const a = companies[index];
    const b = companies[targetIndex];

    /* 排序交换走 Server Action */
    await 交换物流公司排序({ idA: a.id, sortA: a.sort_order, idB: b.id, sortB: b.sort_order });

    loadCompanies();
  }

  const statusMap: Record<string, string> = {
    pending: "待签收",
    received: "已签收",
    returned: "已退回",
  };

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700",
    received: "bg-green-50 text-green-700",
    returned: "bg-red-50 text-red-700",
  };

  return (
    <div>
      <PageHeader
        title="物流管理"
        description="管理物流运单与物流公司"
        action={activeTab === "companies" ? { label: "新增物流公司", onClick: openAdd } : undefined}
      />

      {/* Tab 导航 */}
      <div className="border-b border-gray-200 mb-4">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("waybills")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "waybills"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            物流运单
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("companies")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "companies"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            物流公司
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("settlements")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "settlements"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            结算单
          </button>
        </div>
      </div>

      {activeTab === "waybills" && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <select
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">全部状态</option>
              <option value="pending">待签收</option>
              <option value="received">已签收</option>
              <option value="returned">已退回</option>
            </select>
            <button
              type="button"
              onClick={openSingleCreateModal}
              className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              新建运单
            </button>
            <button
              type="button"
              onClick={() => setBatchModalOpen(true)}
              className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
            >
              批量创建运单
            </button>
            <div className="flex-1" />
            <Link
              href="/procurement?tab=pending_receipt"
              className="px-3 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
            >
              跳转至待收货
            </Link>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">物流单号</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">物流公司</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">单据电话</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">供货商</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">关联采购单</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">单据照片</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">件数</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">运费</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">代收款</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">创建时间</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {waybills.map((w) => {
                  const editState = inlineEditing[w.id] || {};
                  const hasPurchaseOrder = w.purchase_orders && w.purchase_orders.length > 0;
                  const hasSupplier = !!w.supplier_name;
                  const rowHighlight = !hasPurchaseOrder ? "bg-yellow-50" : !hasSupplier ? "bg-orange-50" : "";
                  return (
                    <tr key={w.id} className={`hover:bg-gray-50 ${rowHighlight}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{w.tracking_no}</td>
                      <td className="px-4 py-3 text-gray-600">
                        <span className="mr-2">{w.logistics_companies?.name || w.logistics_company_name || "-"}</span>
                        <ScopesBadges scopes={w.logistics_companies?.scopes} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {editState.phone !== undefined ? (
                          <input
                            type="text"
                            autoFocus
                            className="w-28 px-2 py-1 text-xs border border-blue-400 rounded focus:outline-none"
                            value={editState.phone}
                            onChange={async (e) => {
                              const val = e.target.value;
                              setInlineEditing((prev) => ({
                                ...prev,
                                [w.id]: { ...prev[w.id], phone: val },
                              }));
                              if (val.trim()) {
                                const result = await findSupplierByPhone(val);
                                if (result) {
                                  setInlinePhoneHints((prev) => ({ ...prev, [w.id]: result.name }));
                                } else {
                                  setInlinePhoneHints((prev) => {
                                    const n = { ...prev };
                                    delete n[w.id];
                                    return n;
                                  });
                                }
                              } else {
                                setInlinePhoneHints((prev) => {
                                  const n = { ...prev };
                                  delete n[w.id];
                                  return n;
                                });
                              }
                            }}
                            onBlur={() => {
                              saveInlineField(w.id, "phone", editState.phone || "");
                              cancelInlineEdit(w.id, "phone");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                saveInlineField(w.id, "phone", editState.phone || "");
                                cancelInlineEdit(w.id, "phone");
                              }
                            }}
                          />
                        ) : (
                          <span
                            className="cursor-pointer hover:text-blue-600 hover:underline"
                            onClick={() => startInlineEdit(w.id, "phone", w.phone)}
                          >
                            {w.phone || "点击补充"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {editState.phone !== undefined ? (
                          inlinePhoneHints[w.id] ? (
                            <span className="text-blue-600">{inlinePhoneHints[w.id]}</span>
                          ) : editState.phone?.trim() ? (
                            <span className="text-gray-400 text-xs">未找到</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )
                        ) : (
                          w.supplier_name || <span className="text-xs text-orange-600 font-medium">未匹配</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {w.purchase_orders && w.purchase_orders.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {w.purchase_orders.map((po) => (
                              <Link
                                key={po.id}
                                href={`/procurement/${po.id}`}
                                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                {po.order_no || po.id.slice(0, 8)}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-red-600 font-medium">未绑定</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {w.photos && w.photos.length > 0 ? (
                          <div className="flex gap-1">
                            {w.photos.slice(0, 3).map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                <img src={url} alt="" loading="lazy" className="w-8 h-8 object-cover rounded border border-gray-200 hover:opacity-80" />
                              </a>
                            ))}
                            {w.photos.length > 3 && (
                              <span className="text-xs text-gray-400 self-center">+{w.photos.length - 3}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {editState.package_count !== undefined ? (
                          <input
                            type="number"
                            autoFocus
                            min={0}
                            className="w-16 px-2 py-1 text-xs border border-blue-400 rounded focus:outline-none"
                            value={editState.package_count}
                            onChange={(e) =>
                              setInlineEditing((prev) => ({
                                ...prev,
                                [w.id]: { ...prev[w.id], package_count: e.target.value },
                              }))
                            }
                            onBlur={() => {
                              saveInlineField(w.id, "package_count", editState.package_count || "0");
                              cancelInlineEdit(w.id, "package_count");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                saveInlineField(w.id, "package_count", editState.package_count || "0");
                                cancelInlineEdit(w.id, "package_count");
                              }
                            }}
                          />
                        ) : (
                          <span
                            className="cursor-pointer hover:text-blue-600 hover:underline"
                            onClick={() => startInlineEdit(w.id, "package_count", w.package_count)}
                          >
                            {w.package_count || 1}件
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {editState.freight_amount !== undefined ? (
                          <input
                            type="number"
                            autoFocus
                            step="0.01"
                            min={0}
                            className="w-20 px-2 py-1 text-xs border border-blue-400 rounded focus:outline-none"
                            value={editState.freight_amount}
                            onChange={(e) =>
                              setInlineEditing((prev) => ({
                                ...prev,
                                [w.id]: { ...prev[w.id], freight_amount: e.target.value },
                              }))
                            }
                            onBlur={() => {
                              saveInlineField(w.id, "freight_amount", editState.freight_amount || "0");
                              cancelInlineEdit(w.id, "freight_amount");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                saveInlineField(w.id, "freight_amount", editState.freight_amount || "0");
                                cancelInlineEdit(w.id, "freight_amount");
                              }
                            }}
                          />
                        ) : (
                          <span
                            className="cursor-pointer hover:text-blue-600 hover:underline"
                            onClick={() => startInlineEdit(w.id, "freight_amount", w.freight_amount)}
                          >
                            {formatCurrency(w.freight_amount)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {editState.cod_amount !== undefined ? (
                          <input
                            type="number"
                            autoFocus
                            step="0.01"
                            min={0}
                            className="w-20 px-2 py-1 text-xs border border-blue-400 rounded focus:outline-none"
                            value={editState.cod_amount}
                            onChange={(e) =>
                              setInlineEditing((prev) => ({
                                ...prev,
                                [w.id]: { ...prev[w.id], cod_amount: e.target.value },
                              }))
                            }
                            onBlur={() => {
                              saveInlineField(w.id, "cod_amount", editState.cod_amount || "0");
                              cancelInlineEdit(w.id, "cod_amount");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                saveInlineField(w.id, "cod_amount", editState.cod_amount || "0");
                                cancelInlineEdit(w.id, "cod_amount");
                              }
                            }}
                          />
                        ) : (
                          <span
                            className="cursor-pointer hover:text-blue-600 hover:underline"
                            onClick={() => startInlineEdit(w.id, "cod_amount", w.cod_amount)}
                          >
                            {formatCurrency(w.cod_amount)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded ${statusColor[w.status] || "bg-gray-50 text-gray-500"}`}>
                          {statusMap[w.status] || w.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(w.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {/* 运费结算（三期）：有运费且未结清的给结清入口，已结的打标 */}
                          {Number(w.freight_amount || 0) > 0 && (
                            w.freight_settled ? (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-600">运费已结</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSettleFreight(w)}
                                disabled={settlingId === w.id}
                                className="text-xs text-orange-600 hover:text-orange-800 hover:underline disabled:opacity-50"
                              >
                                {settlingId === w.id ? "结清中..." : "结清运费"}
                              </button>
                            )
                          )}
                          {/* 代收货款转付核对（批次5）：有代收且未标记的给确认入口 */}
                          {Number(w.cod_amount || 0) > 0 && (
                            w.cod_transferred ? (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">代收已转付</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleMarkCodTransferred(w)}
                                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                title="货运站已把代收货款转给供应商后点这里"
                              >
                                转付确认
                              </button>
                            )
                          )}
                          <button
                            type="button"
                            onClick={() => openEditWaybillModal(w)}
                            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteWaybill(w)}
                            className="text-xs text-red-600 hover:text-red-800 hover:underline"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {waybills.length === 0 && !waybillLoading && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-gray-400">
                      暂无运单记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 分页导航：运单列表翻页，保留当前状态筛选 */}
          {waybillTotalPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500">
                共 {waybillTotal} 条，第 {waybillPage}/{waybillTotalPages} 页
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadWaybills(waybillPage - 1)}
                  disabled={waybillPage <= 1 || waybillLoading}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <button
                  onClick={() => loadWaybills(waybillPage + 1)}
                  disabled={waybillPage >= waybillTotalPages || waybillLoading}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "companies" && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <select
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
            >
              <option value="all">全部范围</option>
              <option value="harbin">含哈市</option>
              <option value="outside">含外阜</option>
            </select>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 w-20">排序</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">名称</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">范围</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">联系人</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">电话</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">查询链接</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">未结运费</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">创建时间</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {companies.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">
                      <input
                        type="number"
                        defaultValue={c.sort_order}
                        onBlur={async (e) => {
                          const newOrder = parseInt(e.target.value, 10);
                          if (isNaN(newOrder)) return;
                          /* 写库走 Server Action */
                          await 保存物流公司排序号({ id: c.id, sortOrder: newOrder });
                          loadCompanies();
                        }}
                        className="w-16 px-2 py-1 text-xs text-center border border-gray-300 rounded"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3">
                      <ScopesBadges scopes={c.scopes} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.contact || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{c.phone || "-"}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                      {c.tracking_url ? (
                        <a href={c.tracking_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          {c.tracking_url}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{c.notes || "-"}</td>
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const 余额 = 运费余额[c.id] || 0;
                        return (
                          <span className={余额 > 0 ? "text-red-600 font-medium" : "text-gray-400"}>
                            {formatCurrency(余额)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => moveCompany(idx, "up")}
                          disabled={idx === 0}
                          className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30"
                          title="上移"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCompany(idx, "down")}
                          disabled={idx === companies.length - 1}
                          className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30"
                          title="下移"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          编辑
                        </button>
                        {/* 去结算（批次3）：把该公司未结运的运单批量结掉，出结算单 */}
                        <button
                          type="button"
                          onClick={() => setSettleModalCompany(c)}
                          className="text-xs text-green-600 hover:text-green-800 hover:underline"
                        >
                          去结算
                        </button>
                        {/* 对账单（批次4）：按月出运单+运费明细，可打印发给物流公司 */}
                        <Link
                          href={`/logistics/${c.id}/statement`}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          对账
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(c)}
                          className="text-xs text-red-600 hover:text-red-800 hover:underline"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {companies.length === 0 && !companyLoading && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                      暂无物流公司
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 结算单页签（批次3）：一次结一批运单的凭证，可作废 */}
      {activeTab === "settlements" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">结算单号</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">物流公司</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">运单数</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">结算金额</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">支付方式</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">覆盖期间</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">经办人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {settlements.map((s) => (
                <Fragment key={s.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button onClick={() => 切换结算明细(s)} className="text-blue-600 hover:underline font-medium">
                        {s.settlement_no}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-900">{s.logistics_companies?.name || "-"}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{s.waybill_count} 张</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(s.total_amount)}</td>
                    <td className="px-4 py-3 text-gray-600">{s.payment_method || "-"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {s.period_start ? `${s.period_start} ~ ${s.period_end}` : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          s.status === "confirmed" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        {s.status === "confirmed" ? "已确认" : "已作废"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.profiles?.full_name || "-"}</td>
                    <td className="px-4 py-3 text-gray-500">{s.note || "-"}</td>
                    <td className="px-4 py-3 text-right">
                      {s.status === "confirmed" && (
                        <button onClick={() => handleVoidSettlement(s)} className="text-xs text-red-600 hover:underline">
                          作废
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedSettlement === s.id && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={10} className="px-8 py-3">
                        {(settlementItems[s.id] || []).length === 0 ? (
                          <span className="text-xs text-gray-400">明细加载中...</span>
                        ) : (
                          <div className="text-xs text-gray-600 space-y-1">
                            <div className="font-medium text-gray-700">结算运单：</div>
                            {(settlementItems[s.id] || []).map((i) => (
                              <div key={i.id} className="flex gap-4">
                                <span>{i.logistics_waybills?.tracking_no || i.waybill_id.slice(0, 8)}</span>
                                <span className="text-blue-700">{formatCurrency(i.freight_amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {settlements.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    {settlementsLoading ? "加载中..." : "暂无结算单，到「物流公司」页签点「去结算」开始"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 新建结算弹窗（批次3） */}
      {settleModalCompany && (
        <SettlementModal
          company={settleModalCompany}
          onClose={() => setSettleModalCompany(null)}
          onSaved={() => {
            setSettleModalCompany(null);
            loadCompanies();
            if (activeTab === "settlements") loadSettlements();
          }}
        />
      )}

      {/* 单个创建运单弹窗 */}
      {singleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">{editingWaybill ? "编辑运单" : "新建运单"}</h3>
              <button
                type="button"
                onClick={closeSingleCreateModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">运单号 *</label>
                  <input
                    type="text"
                    value={singleTrackingNo}
                    onChange={(e) => setSingleTrackingNo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">物流公司</label>
                  <select
                    value={singleCompanyId}
                    onChange={(e) => setSingleCompanyId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">请选择</option>
                    {companies.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).length > 0 && (
                      <optgroup label="哈市物流">
                        {companies.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {companies.filter((c) => c.scopes?.includes("outside")).length > 0 && (
                      <optgroup label="外阜快递">
                        {companies.filter((c) => c.scopes?.includes("outside")).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">运单电话</label>
                  <input
                    type="text"
                    value={singlePhone}
                    onChange={(e) => setSinglePhone(e.target.value)}
                    placeholder="输入电话自动检索供货商"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">供货商</label>
                  <input
                    type="text"
                    value={singleSupplierName}
                    onChange={(e) => setSingleSupplierName(e.target.value)}
                    placeholder={singlePhone.trim() ? "输入电话自动检索或手动填写" : "输入电话后自动显示"}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              {singlePhone.trim() && !singleSupplierName && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                  <div className="text-sm text-red-700">未检索到该电话对应的供应商，请手动选择并补充：</div>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={attachSupplierId}
                      onChange={(e) => setAttachSupplierId(e.target.value)}
                    >
                      <option value="">选择供应商...</option>
                      {suppliersList.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAttachPhone}
                      className="px-3 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700"
                    >
                      补充电话
                    </button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">件数</label>
                  <input
                    type="number"
                    min={1}
                    value={singlePackageCount}
                    onChange={(e) => setSinglePackageCount(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">运费金额</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={singleFreight}
                    onChange={(e) => setSingleFreight(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">代收金额</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={singleCod}
                    onChange={(e) => setSingleCod(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">运单照片</label>
                <ImageUploader
                  onUpload={(paths) => setSinglePhotos(paths)}
                  existingImages={singlePhotos}
                  maxImages={5}
                  bucket="work-order-media"
                  folder="waybill-photos"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <textarea
                  value={singleNotes}
                  onChange={(e) => setSingleNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {/* 关联采购单 */}
              {editingWaybill && editingWaybill.purchase_orders && editingWaybill.purchase_orders.length > 0 && (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="text-sm font-medium text-gray-700 mb-2">关联采购单（{editingWaybill.purchase_orders.length} 条）</div>
                  <div className="space-y-1">
                    {editingWaybill.purchase_orders.map((po) => (
                      <Link
                        key={po.id}
                        href={`/procurement/${po.id}`}
                        className="block text-sm text-blue-600 hover:text-blue-800 hover:underline"
                        target="_blank"
                      >
                        {po.order_no || po.id.slice(0, 8)}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeSingleCreateModal}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSingleCreate}
                disabled={singleSaving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {singleSaving ? "保存中..." : (editingWaybill ? "保存运单" : "创建运单")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量创建运单弹窗 */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">批量创建运单</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  物流公司 <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={batchCompanyId}
                  onChange={(e) => setBatchCompanyId(e.target.value)}
                >
                  <option value="">请选择</option>
                  {companies.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).length > 0 && (
                    <optgroup label="哈市物流（哈市供应商）">
                      {companies.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).map((c) => (
                        <option key={`harbin-${c.id}`} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {companies.filter((c) => c.scopes?.includes("outside")).length > 0 && (
                    <optgroup label="外阜快递（外阜供应商）">
                      {companies.filter((c) => c.scopes?.includes("outside")).map((c) => (
                        <option key={`outside-${c.id}`} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  创建数量
                  <span className="ml-2 text-xs text-gray-400">（不知道单号时填写，自动生成）</span>
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={batchCount}
                  onChange={(e) => setBatchCount(e.target.value)}
                  placeholder="例如：5"
                />
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-white text-gray-400">或者填写具体单号</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  物流单号
                  <span className="ml-2 text-xs text-gray-400">（每行一个，优先使用）</span>
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={6}
                  value={batchTrackingNos}
                  onChange={(e) => setBatchTrackingNos(e.target.value)}
                  placeholder={`请输入物流单号，每行一个，例如：\nSF1234567890\nSF1234567891\nSF1234567892`}
                />
                {batchTrackingNos && (
                  <div className="mt-1 text-xs text-gray-500">
                    共 {batchTrackingNos.split("\n").filter((l) => l.trim().length > 0).length} 个单号
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setBatchModalOpen(false);
                  setBatchTrackingNos("");
                  setBatchCount("");
                  setBatchCompanyId("");
                }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleBatchCreate}
                disabled={batchSaving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {batchSaving ? "创建中..." : "确定创建"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <CompanyEditModal
          company={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            loadCompanies();
          }}
        />
      )}

      {确认弹窗}
    </div>
  );
}

/* ============================================================================
 * CompanyEditModal — 定义在 LogisticsContent 组件外部（符合 React 规则）
 * ============================================================================ */

interface CompanyEditModalProps {
  company: LogisticsCompany | null;
  onClose: () => void;
  onSaved: () => void;
}

function CompanyEditModal({ company, onClose, onSaved }: CompanyEditModalProps) {
  const [name, setName] = useState(company?.name || "");
  const [scopes, setScopes] = useState<string[]>(company?.scopes && company.scopes.length > 0 ? company.scopes : ["harbin"]);
  const [contact, setContact] = useState(company?.contact || "");
  const [phone, setPhone] = useState(company?.phone || "");
  const [trackingUrl, setTrackingUrl] = useState(company?.tracking_url || "");
  const [notes, setNotes] = useState(company?.notes || "");
  const [sortOrderInput, setSortOrderInput] = useState(String(company?.sort_order ?? 0));
  const [saving, setSaving] = useState(false);

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function handleSave() {
    if (!name.trim()) {
      toast("请填写物流公司名称", "warning");
      return;
    }
    if (scopes.length === 0) {
      toast("请至少选择一个服务范围", "warning");
      return;
    }
    setSaving(true);
    /* 写库走 Server Action */
    const result = await 保存物流公司({
      id: company?.id || null,
      name,
      scopes,
      contact,
      phone,
      trackingUrl,
      notes,
      sortOrder: parseInt(sortOrderInput, 10) || 0,
    });
    setSaving(false);
    if (!result.success) {
      toast((company ? "保存" : "新增") + "失败: " + (result.error || "未知错误"), "error");
      return;
    }
    await 刷新基础数据缓存();
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {company ? "编辑物流公司" : "新增物流公司"}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              名称<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：顺丰快递"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">排序号</label>
            <input
              type="number"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={sortOrderInput}
              onChange={(e) => setSortOrderInput(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              服务范围<span className="text-red-500">*</span>
              <span className="ml-2 text-xs text-gray-400">（可多选）</span>
            </label>
            <div className="flex gap-2">
              <label className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${scopes.includes("harbin") ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-600"}`}>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={scopes.includes("harbin")}
                  onChange={() => toggleScope("harbin")}
                />
                <span className="text-sm">哈市</span>
              </label>
              <label className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${scopes.includes("outside") ? "border-orange-500 bg-orange-50 text-orange-700" : "border-gray-300 text-gray-600"}`}>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={scopes.includes("outside")}
                  onChange={() => toggleScope("outside")}
                />
                <span className="text-sm">外阜</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">联系人</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">电话</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">查询链接</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
              placeholder="如：https://www.sf-express.com/"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ 新建结算弹窗（2026-09-15 批次3，独立组件：放主组件外面） ═══
 * 选一家物流公司 → 拉出全部"已签收/有运费/未结清"的运单（默认全勾）
 * → 合计 → 选支付方式 → 确认出一张结算单 */

interface 可结算运单 {
  id: string;
  tracking_no: string;
  freight_amount: number | null;
  cod_amount: number | null;
  received_at: string | null;
  created_at: string;
}

function SettlementModal({
  company,
  onClose,
  onSaved,
}: {
  company: LogisticsCompany;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [waybills, setWaybills] = useState<可结算运单[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState("");
  const [methods, setMethods] = useState<{ code: string; name: string }[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  /* 拉该公司可结算运单 + 支付方式字典 */
  useEffect(() => {
    let 有效 = true;
    async function load() {
      setLoading(true);
      const [运单Res, 方式Res] = await Promise.all([
        supabase
          .from("logistics_waybills")
          .select("id, tracking_no, freight_amount, cod_amount, received_at, created_at")
          .eq("logistics_company_id", company.id)
          .eq("status", "received")
          .gt("freight_amount", 0)
          .or("freight_settled.is.null,freight_settled.eq.false")
          .order("received_at", { ascending: true }),
        supabase.from("payment_methods").select("code, name").eq("is_active", true).order("sort_order"),
      ]);
      if (!有效) return;
      setLoading(false);
      if (运单Res.error) {
        toast("加载运单失败: " + 运单Res.error.message, "error");
        return;
      }
      const 清单 = (运单Res.data || []) as 可结算运单[];
      setWaybills(清单);
      /* 默认全勾 */
      const 勾选: Record<string, boolean> = {};
      for (const w of 清单) 勾选[w.id] = true;
      setChecked(勾选);
      setMethods((方式Res.data || []) as { code: string; name: string }[]);
    }
    load();
    return () => { 有效 = false; };
    /* company 在弹窗生命周期内不变 */
  }, [supabase, company.id]);

  const 勾选清单 = waybills.filter((w) => checked[w.id]);
  /* 金额转分合计，防浮点 */
  const 合计分 = 勾选清单.reduce((sum, w) => sum + Math.round((w.freight_amount || 0) * 100), 0);

  async function 提交() {
    if (勾选清单.length === 0) {
      toast("请至少勾选一张运单", "warning");
      return;
    }
    setSaving(true);
    try {
      const res = await 创建物流结算单({
        company_id: company.id,
        waybill_ids: 勾选清单.map((w) => w.id),
        payment_method: method || undefined,
        note: note || undefined,
      });
      setSaving(false);
      if (!res.success) {
        toast("创建结算单失败: " + (res.error || "未知错误"), "error");
        return;
      }
      toast(`结算单 ${res.settlement_no || ""} 已创建`, "success");
      onSaved();
    } catch (err: unknown) {
      setSaving(false);
      toast("创建结算单失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">结算运费 - {company.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <p className="text-sm text-gray-400 py-8 text-center">运单加载中...</p>
          ) : waybills.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">该公司没有可结算的运单（已签收、有运费、未结清）</p>
          ) : (
            <>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 w-10">
                        <input
                          type="checkbox"
                          checked={勾选清单.length === waybills.length && waybills.length > 0}
                          onChange={(e) => {
                            const 全选 = e.target.checked;
                            const 新: Record<string, boolean> = {};
                            for (const w of waybills) 新[w.id] = 全选;
                            setChecked(新);
                          }}
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">运单号</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">签收时间</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">运费</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">代收货款</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {waybills.map((w) => (
                      <tr key={w.id} className={checked[w.id] ? "bg-green-50/40" : ""}>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={!!checked[w.id]}
                            onChange={(e) => setChecked((prev) => ({ ...prev, [w.id]: e.target.checked }))}
                          />
                        </td>
                        <td className="px-3 py-2 text-gray-900">{w.tracking_no}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">
                          {w.received_at ? new Date(w.received_at).toLocaleDateString("zh-CN") : "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">{formatCurrency(w.freight_amount || 0)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{w.cod_amount ? formatCurrency(w.cod_amount) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-gray-600">
                  已选 <b className="text-gray-900">{勾选清单.length}</b> 张
                </span>
                <span className="text-gray-600">
                  结算合计：<b className="text-green-700 text-base">{formatCurrency(合计分 / 100)}</b>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">支付方式</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="">未选</option>
                    {methods.map((m) => (
                      <option key={m.code} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">备注</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="选填，如：8月份运费"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          {waybills.length > 0 && (
            <button
              type="button"
              onClick={提交}
              disabled={saving || 勾选清单.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? "结算中..." : `确认结算 ${formatCurrency(合计分 / 100)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
