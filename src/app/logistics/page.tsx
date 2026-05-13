"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";

type Tab = "waybills" | "companies";

interface LogisticsCompany {
  id: string;
  name: string;
  scopes: string[] | null;
  contact: string | null;
  phone: string | null;
  tracking_url: string | null;
  notes: string | null;
  created_at: string;
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

  // 运单数据
  const [waybills, setWaybills] = useState<any[]>([]);
  const [waybillLoading, setWaybillLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  // 物流公司数据
  const [companies, setCompanies] = useState<LogisticsCompany[]>([]);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [scopeFilter, setScopeFilter] = useState("all");

  // 编辑弹窗
  const [editing, setEditing] = useState<LogisticsCompany | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (activeTab === "waybills") loadWaybills();
  }, [filter, activeTab]);

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

    const { data } = await query;
    setWaybills(data || []);
    setWaybillLoading(false);
  }

  async function loadCompanies() {
    setCompanyLoading(true);
    let query = supabase
      .from("logistics_companies")
      .select("*")
      .order("name", { ascending: true });

    if (scopeFilter !== "all") {
      /* PostgREST 数组包含查询：scopes 数组里含 scopeFilter */
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
    /* 删除前检查是否被运单引用 */
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
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">物流单号</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">物流公司</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">运费</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">代收款</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">创建时间</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {waybills.map((w) => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{w.tracking_no}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <span className="mr-2">{w.logistics_companies?.name || w.logistics_company_name || "-"}</span>
                      <ScopesBadges scopes={w.logistics_companies?.scopes} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatCurrency(w.freight_amount)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatCurrency(w.cod_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${statusColor[w.status] || "bg-gray-50 text-gray-500"}`}>
                        {statusMap[w.status] || w.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(w.created_at)}</td>
                    <td className="px-4 py-3 text-gray-500">{w.notes || "-"}</td>
                  </tr>
                ))}
                {waybills.length === 0 && !waybillLoading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
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
                {companies.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
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
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      暂无物流公司
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
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
