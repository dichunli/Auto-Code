"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ImageUploader } from "@/components/ImageUploader";

type Tab = "waybills" | "companies";

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
  created_at: string;
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

export default function LogisticsPage() {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<Tab>("waybills");

  /* 运单数据 */
  const [waybills, setWaybills] = useState<Waybill[]>([]);
  const [waybillLoading, setWaybillLoading] = useState(true);
  const [filter, setFilter] = useState("pending");

  /* 物流公司数据 */
  const [companies, setCompanies] = useState<LogisticsCompany[]>([]);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [scopeFilter, setScopeFilter] = useState("all");

  /* 供应商数据(用于弹窗补充电话) */
  const [suppliersList, setSuppliersList] = useState<{ id: string; name: string }[]>([]);

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
  const [inlineEditing, setInlineEditing] = useState<Record<string, { phone?: string; package_count?: string; freight_amount?: string; cod_amount?: string }>>({});
  /* 行内编辑电话时的实时供应商提示 */
  const [inlinePhoneHints, setInlinePhoneHints] = useState<Record<string, string>>({});

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

  useEffect(() => {
    loadCompanies();
    supabase.from("suppliers").select("id, name").order("name").then(({ data }) => {
      setSuppliersList(data || []);
    });
  }, []);

  useEffect(() => {
    if (activeTab === "waybills") loadWaybills();
  }, [filter, activeTab]);

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
      const { data } = await supabase
        .from("suppliers")
        .select("name")
        .ilike("phone", `%${singlePhone.trim()}%`)
        .limit(1);
      if (data && data.length > 0) {
        setSingleSupplierName(data[0].name);
      }
    }
    lookup();
  }, [singlePhone, supabase]);

  useEffect(() => {
    if (activeTab === "companies") loadCompanies();
  }, [scopeFilter, activeTab]);

  async function loadWaybills() {
    setWaybillLoading(true);
    let query = supabase
      .from("logistics_waybills")
      .select("*, logistics_companies(name, scopes)")
      .order("created_at", { ascending: false });

    if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data: waybillData } = await query;
    const waybills = (waybillData || []) as Waybill[];

    /* 批量查询关联的采购单 */
    if (waybills.length > 0) {
      const waybillIds = waybills.map((w) => w.id);
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
        waybills.map((w) => ({
          ...w,
          purchase_orders: poMap.get(w.id) || [],
        }))
      );
    } else {
      setWaybills(waybills);
    }
    setWaybillLoading(false);
  }

  async function loadCompanies() {
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
      alert("加载失败: " + error.message);
    }
    setCompanies((data as LogisticsCompany[]) || []);
    setCompanyLoading(false);
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
    const { count, error: countError } = await supabase
      .from("logistics_waybills")
      .select("id", { count: "exact", head: true })
      .eq("logistics_company_id", company.id);

    if (countError) {
      alert("检查引用失败: " + countError.message);
      return;
    }
    if (count && count > 0) {
      alert(`该物流公司已被 ${count} 个运单引用，无法删除。`);
      return;
    }
    if (!confirm(`确定删除物流公司「${company.name}」吗？`)) return;

    const { error } = await supabase.from("logistics_companies").delete().eq("id", company.id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    loadCompanies();
  }

  async function handleDeleteWaybill(w: Waybill) {
    if (!confirm(`确定删除运单「${w.tracking_no}」吗？`)) return;
    const { error } = await supabase.from("logistics_waybills").delete().eq("id", w.id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    loadWaybills();
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
      alert("请先选择供应商");
      return;
    }
    const supplier = suppliersList.find((s) => s.id === attachSupplierId);
    if (!supplier) {
      alert("供应商选择无效");
      return;
    }
    const { error } = await supabase
      .from("suppliers")
      .update({ phone: singlePhone.trim() })
      .eq("id", attachSupplierId);
    if (error) {
      alert("补充电话失败: " + error.message);
      return;
    }
    setSingleSupplierName(supplier.name);
    alert(`已将电话 ${singlePhone.trim()} 补充到供应商「${supplier.name}」`);
  }

  async function handleSingleCreate() {
    if (!singleTrackingNo.trim()) {
      alert("请填写运单号");
      return;
    }
    if (!singlePackageCount.trim() || isNaN(parseInt(singlePackageCount)) || parseInt(singlePackageCount) <= 0) {
      alert("请填写件数");
      return;
    }
    if (singleFreight.trim() === "" || isNaN(parseFloat(singleFreight))) {
      alert("请填写运费金额");
      return;
    }
    if (singleCod.trim() === "" || isNaN(parseFloat(singleCod))) {
      alert("请填写代收金额");
      return;
    }
    setSingleSaving(true);
    const company = companies.find((c) => c.id === singleCompanyId);
    try {
      if (editingWaybill) {
        const { error } = await supabase
          .from("logistics_waybills")
          .update({
            tracking_no: singleTrackingNo.trim(),
            logistics_company_id: singleCompanyId || null,
            logistics_company_name: company?.name || null,
            phone: singlePhone.trim() || null,
            supplier_name: singleSupplierName.trim() || null,
            package_count: parseInt(singlePackageCount) || 1,
            freight_amount: parseFloat(singleFreight) || 0,
            cod_amount: parseFloat(singleCod) || 0,
            photos: singlePhotos.length > 0 ? singlePhotos : null,
            notes: singleNotes.trim() || null,
          })
          .eq("id", editingWaybill.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("logistics_waybills").insert({
          tracking_no: singleTrackingNo.trim(),
          logistics_company_id: singleCompanyId || null,
          logistics_company_name: company?.name || null,
          phone: singlePhone.trim() || null,
          supplier_name: singleSupplierName.trim() || null,
          package_count: parseInt(singlePackageCount) || 1,
          freight_amount: parseFloat(singleFreight) || 0,
          cod_amount: parseFloat(singleCod) || 0,
          photos: singlePhotos.length > 0 ? singlePhotos : null,
          notes: singleNotes.trim() || null,
          status: "pending",
        });
        if (error) throw error;
      }
      closeSingleCreateModal();
      loadWaybills();
    } catch (err: any) {
      alert((editingWaybill ? "保存" : "创建") + "运单失败: " + (err.message || String(err)));
    } finally {
      setSingleSaving(false);
    }
  }

  async function handleBatchCreate() {
    if (!batchCompanyId) {
      alert("请选择物流公司");
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
        alert("请至少输入一个物流单号，或填写创建数量");
        return;
      }
      for (let i = 0; i < count; i++) {
        trackingNos.push(generateSingleTrackingNo() + `-${i + 1}`);
      }
    }

    setBatchSaving(true);
    const company = companies.find((c) => c.id === batchCompanyId);
    const records = trackingNos.map((trackingNo) => ({
      tracking_no: trackingNo,
      logistics_company_id: batchCompanyId || null,
      logistics_company_name: company?.name || null,
      status: "pending" as const,
    }));

    const { error } = await supabase.from("logistics_waybills").insert(records);
    setBatchSaving(false);
    if (error) {
      alert("批量创建失败: " + error.message);
      return;
    }
    setBatchModalOpen(false);
    setBatchTrackingNos("");
    setBatchCount("");
    setBatchCompanyId("");
    loadWaybills();
  }

  /* 行内保存某个字段 */
  async function saveInlineField(waybillId: string, field: keyof Waybill, value: string) {
    let payload: any = {};
    if (field === "phone") {
      payload = { phone: value.trim() || null };
    } else if (field === "package_count") {
      payload = { package_count: parseInt(value, 10) || 0 };
    } else if (field === "freight_amount") {
      payload = { freight_amount: parseFloat(value) || 0 };
    } else if (field === "cod_amount") {
      payload = { cod_amount: parseFloat(value) || 0 };
    }

    const { error } = await supabase.from("logistics_waybills").update(payload).eq("id", waybillId);
    if (error) {
      alert("保存失败: " + error.message);
      loadWaybills();
      return;
    }

    /* 如果修改的是电话,保存后自动检索供应商并同步更新 supplier_name */
    if (field === "phone") {
      if (value.trim()) {
        const { data } = await supabase
          .from("suppliers")
          .select("name")
          .ilike("phone", `%${value.trim()}%`)
          .limit(1);
        if (data && data.length > 0) {
          await supabase
            .from("logistics_waybills")
            .update({ supplier_name: data[0].name })
            .eq("id", waybillId);
        }
      } else {
        await supabase
          .from("logistics_waybills")
          .update({ supplier_name: null })
          .eq("id", waybillId);
      }
    }

    loadWaybills();
  }

  function startInlineEdit(waybillId: string, field: keyof Waybill, currentValue: any) {
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
        const { [field]: _, ...rest } = next[waybillId];
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

    await supabase
      .from("logistics_companies")
      .update({ sort_order: b.sort_order })
      .eq("id", a.id);
    await supabase
      .from("logistics_companies")
      .update({ sort_order: a.sort_order })
      .eq("id", b.id);

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
                  return (
                    <tr key={w.id} className="hover:bg-gray-50">
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
                                const { data } = await supabase
                                  .from("suppliers")
                                  .select("name")
                                  .ilike("phone", `%${val.trim()}%`)
                                  .limit(1);
                                if (data && data.length > 0) {
                                  setInlinePhoneHints((prev) => ({ ...prev, [w.id]: data[0].name }));
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
                          w.supplier_name || "-"
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
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {w.photos && w.photos.length > 0 ? (
                          <div className="flex gap-1">
                            {w.photos.slice(0, 3).map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                <img src={url} alt="" className="w-8 h-8 object-cover rounded border border-gray-200 hover:opacity-80" />
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
                          await supabase
                            .from("logistics_companies")
                            .update({ sort_order: newOrder })
                            .eq("id", c.id);
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
    </div>
  );
}

interface CompanyEditModalProps {
  company: LogisticsCompany | null;
  onClose: () => void;
  onSaved: () => void;
}

function CompanyEditModal({ company, onClose, onSaved }: CompanyEditModalProps) {
  const supabase = createClient();
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
      alert("请填写物流公司名称");
      return;
    }
    if (scopes.length === 0) {
      alert("请至少选择一个服务范围");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      scopes,
      contact: contact.trim() || null,
      phone: phone.trim() || null,
      tracking_url: trackingUrl.trim() || null,
      notes: notes.trim() || null,
      sort_order: parseInt(sortOrderInput, 10) || 0,
    };

    if (company) {
      const { error } = await supabase.from("logistics_companies").update(payload).eq("id", company.id);
      setSaving(false);
      if (error) {
        alert("保存失败: " + error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("logistics_companies").insert(payload);
      setSaving(false);
      if (error) {
        alert("新增失败: " + error.message);
        return;
      }
    }
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
