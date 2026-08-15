"use client";

import {useState, useEffect, useMemo} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 配件入库, 新建配件品牌, 新建配件规格 } from "../actions";

interface Part {
  id: string;
  part_number: string | null;
  name: string | null;
  barcode: string | null;
  quantity: number;
}

interface PartName {
  id: string;
  name: string;
  part_categories: { name: string } | null;
}

interface Brand {
  id: string;
  name: string;
}

interface Specification {
  id: string;
  name: string;
}

interface LogisticsCompany {
  id: string;
  name: string;
  scopes: string[] | null;
}

interface PendingWaybill {
  id: string;
  tracking_no: string;
  logistics_companies: { name: string } | null;
  logistics_company_name: string | null;
  freight_amount: number;
  cod_amount: number;
}

interface AutoFillForm {
  part_number: string;
  supplier: string;
  unit_cost: string;
  specification_text: string;
  part_name_id?: string;
  brand_id?: string;
  quantity?: string;
}

export default function InventoryInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [partNames, setPartNames] = useState<PartName[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [specifications, setSpecifications] = useState<Specification[]>([]);
  const [newPartMode, setNewPartMode] = useState(false);

  const [selectedPartId, setSelectedPartId] = useState("");
  const [partSearchQuery, setPartSearchQuery] = useState("");
  const [branchId, setBranchId] = useState("");

  // 物流运单
  const [logisticsCompanies, setLogisticsCompanies] = useState<LogisticsCompany[]>([]);
  const [pendingWaybills, setPendingWaybills] = useState<PendingWaybill[]>([]);
  const [waybillMode, setWaybillMode] = useState<"none" | "existing" | "new">("none");
  const [selectedWaybillId, setSelectedWaybillId] = useState("");
  const [newWaybill, setNewWaybill] = useState({
    tracking_no: "",
    logistics_company_id: "",
    freight_amount: "",
    cod_amount: "",
    notes: "",
  });

  const [form, setForm] = useState({
    part_number: "",
    barcode: "",
    part_name_id: "",
    brand_id: "",
    specification_id: "",
    specification_text: "",
    quantity: "",
    unit_cost: "",
    supplier: "",
    batch_no: "",
    notes: "",
  });

  useEffect(() => {
    supabase.from("parts").select("*, part_names(name)").order("name").limit(100).then(({ data }) => setParts(data || []));
    supabase.from("part_names").select("*, part_categories(name)").order("name").limit(100).then(({ data }) => setPartNames(data || []));
    supabase.from("part_brands").select("*").order("name").limit(100).then(({ data }) => setBrands(data || []));
    supabase.from("part_specifications").select("*").order("name").limit(100).then(({ data }) => setSpecifications(data || []));
    supabase.from("logistics_companies").select("*").order("name").limit(100).then(({ data }) => setLogisticsCompanies(data || []));
    supabase.from("logistics_waybills").select("*, logistics_companies(name)").eq("status", "pending").order("created_at", { ascending: false }).limit(100).then(({ data }) => setPendingWaybills(data || []));
  }, [supabase]);

  // 自动填写：来自工单空分支 / 待入库页新配件的入库登记
  // （2026-08-16 修复：原要求必须带 branch_id 才预填，待入库页链接没传 → 跳过来不预填）
  useEffect(() => {
    const autoFill = searchParams.get("auto_fill");
    if (autoFill !== "1") return;

    const branch_id = searchParams.get("branch_id");
    if (branch_id) setBranchId(branch_id);

    /* 带名称/编码等参数的视为全新配件建档入库 */
    const name = searchParams.get("name");
    const partNumber = searchParams.get("part_number");
    if (branch_id || name || partNumber) setNewPartMode(true);

    const next: AutoFillForm = {
      part_number: partNumber || "",
      supplier: searchParams.get("supplier") || "",
      unit_cost: searchParams.get("unit_cost") || "",
      specification_text: searchParams.get("specification") || "",
    };

    /* 数量预填（待入库页链接会带）；unit 单位参数在表单中无对应字段，忽略 */
    const qty = searchParams.get("quantity");
    if (qty) next.quantity = qty;

    if (name && partNames.length > 0) {
      const matched = partNames.find((n) => n.name === name);
      if (matched) {
        next.part_name_id = matched.id;
        next.specification_text = next.specification_text || "";
      }
    }

    const brand = searchParams.get("brand");
    if (brand && brands.length > 0) {
      const matched = brands.find((b) => b.name === brand);
      if (matched) next.brand_id = matched.id;
    }

    setForm((prev) => ({ ...prev, ...next }));
  }, [searchParams, partNames, brands]);

  async function handleCreateBrand() {
    const brandName = prompt("请输入新品牌名称:");
    if (!brandName) return;
    const result = await 新建配件品牌(brandName);
    if (!result.success || !result.id) {
      alert("创建失败: " + (result.error || "未知错误"));
      return;
    }
    setBrands((prev) => [...prev, { id: result.id!, name: brandName }]);
    setForm((f) => ({ ...f, brand_id: result.id! }));
  }

  async function handleCreateSpec() {
    const specName = prompt("请输入新规格名称:");
    if (!specName) return;
    const result = await 新建配件规格(specName);
    if (!result.success || !result.id) {
      alert("创建失败: " + (result.error || "未知错误"));
      return;
    }
    setSpecifications((prev) => [...prev, { id: result.id!, name: specName }]);
    setForm((f) => ({ ...f, specification_id: result.id!, specification_text: "" }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    /* 前端先做基本校验（与服务端一致，避免白跑一趟） */
    const qty = parseInt(form.quantity) || 0;
    if (qty <= 0) {
      alert("入库数量必须大于0");
      return;
    }
    if (newPartMode && !form.part_name_id) {
      alert("请选择配件名称");
      return;
    }
    if (!newPartMode && !selectedPartId) {
      alert("请选择配件");
      return;
    }

    setLoading(true);

    /* 入库走 Server Action：服务端读最新库存再更新，
     * 不能用客户端列表里的旧数量（可能已被别人改过） */
    const 调用入库 = async (force: boolean) =>
      配件入库({
        newPartMode,
        selectedPartId,
        branchId,
        force,
        waybillMode,
        selectedWaybillId,
        newWaybill,
        form,
      });

    let result;
    try {
      result = await 调用入库(false);
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
      setLoading(false);
      return;
    }

    /* 软拦截（2026-08-16 双入库防重）：配件在未完成采购单上，
       用户确认"这是另一批货"后带 force 重发 */
    if (!result.success && result.code === "PO_IN_FLIGHT") {
      if (!confirm(result.error || "该配件有在途采购单，仍要入库吗？")) {
        setLoading(false);
        return;
      }
      try {
        result = await 调用入库(true);
      } catch (err: unknown) {
        alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
        setLoading(false);
        return;
      }
    }

    if (!result.success) {
      alert("保存失败: " + result.error);
      setLoading(false);
      return;
    }

    router.push("/inventory");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="入库登记" description="新增配件或给现有配件补货" />

      {branchId && (
        <div className="mb-4 max-w-3xl bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-500" />
          当前为工单空分支入库登记，保存后将自动关联到对应配件分支。
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl">
        <div className="space-y-6">
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => setNewPartMode(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${!newPartMode ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              现有配件入库
            </button>
            <button
              type="button"
              onClick={() => setNewPartMode(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${newPartMode ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              新增配件入库
            </button>
          </div>

          {!newPartMode && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">选择配件</label>
              <input
                type="text"
                placeholder="搜索配件编号、名称或条形码..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={partSearchQuery}
                onChange={(e) => setPartSearchQuery(e.target.value)}
              />
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">编号</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">名称</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">条形码</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">库存</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parts
                      .filter((p) => {
                        const q = partSearchQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          p.part_number?.toLowerCase().includes(q) ||
                          p.name?.toLowerCase().includes(q) ||
                          p.barcode?.toLowerCase().includes(q)
                        );
                      })
                      .map((p) => (
                        <tr
                          key={p.id}
                          onClick={() => setSelectedPartId(p.id)}
                          className={`cursor-pointer ${
                            selectedPartId === p.id
                              ? "bg-blue-50"
                              : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="px-3 py-2 font-medium text-gray-900">{p.part_number}</td>
                          <td className="px-3 py-2 text-gray-700">{p.name}</td>
                          <td className="px-3 py-2 text-gray-500">{p.barcode || "-"}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{p.quantity}</td>
                        </tr>
                      ))}
                    {parts.filter((p) => {
                      const q = partSearchQuery.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        p.part_number?.toLowerCase().includes(q) ||
                        p.name?.toLowerCase().includes(q) ||
                        p.barcode?.toLowerCase().includes(q)
                      );
                    }).length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-sm">
                          未找到匹配配件
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {selectedPartId && (
                <p className="text-sm text-blue-600">
                  已选择：{parts.find((p) => p.id === selectedPartId)?.name || "-"}
                </p>
              )}
              <input type="hidden" value={selectedPartId} required={!newPartMode} />
            </div>
          )}

          {newPartMode && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">配件名称 *</label>
                <select
                  required={newPartMode}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={form.part_name_id}
                  onChange={(e) => setForm({ ...form, part_name_id: e.target.value })}
                >
                  <option value="">请选择</option>
                  {partNames.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.part_categories?.name})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  没有需要的名称？请先前往{" "}
                  <a href="/part-names/new" className="text-blue-600 hover:underline" target="_blank">
                    名称库
                  </a>{" "}
                  新建
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">配件编号 *</label>
                  <input
                    required={newPartMode}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={form.part_number}
                    onChange={(e) => setForm({ ...form, part_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">条形码</label>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    placeholder="扫码或手动输入"
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                      value={form.brand_id}
                      onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                    >
                      <option value="">请选择</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleCreateBrand}
                      className="px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
                    >
                      + 新建
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">规格</label>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                      value={form.specification_id}
                      onChange={(e) => setForm({ ...form, specification_id: e.target.value, specification_text: "" })}
                    >
                      <option value="">从库选择</option>
                      {specifications.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleCreateSpec}
                      className="px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
                    >
                      + 新建
                    </button>
                  </div>
                  {!form.specification_id && (
                    <input
                      className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="或直接输入规格"
                      value={form.specification_text}
                      onChange={(e) => setForm({ ...form, specification_text: e.target.value })}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">入库数量 *</label>
              <input
                required
                type="number"
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">成本单价</label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">供应商</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">批次号</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="可选，填写后自动创建批次记录"
              value={form.batch_no}
              onChange={(e) => setForm({ ...form, batch_no: e.target.value })}
            />
          </div>

          {/* 物流运单 */}
          <div className="border-t border-gray-100 pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">物流运单</label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setWaybillMode("none")}
                className={`px-3 py-1.5 rounded-lg text-sm ${waybillMode === "none" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}
              >
                无运单
              </button>
              <button
                type="button"
                onClick={() => setWaybillMode("existing")}
                className={`px-3 py-1.5 rounded-lg text-sm ${waybillMode === "existing" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
              >
                选择待收运单
              </button>
              <button
                type="button"
                onClick={() => setWaybillMode("new")}
                className={`px-3 py-1.5 rounded-lg text-sm ${waybillMode === "new" ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600"}`}
              >
                新建运单
              </button>
            </div>

            {waybillMode === "existing" && (
              <div className="space-y-3">
                {pendingWaybills.length > 0 ? (
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={selectedWaybillId}
                    onChange={(e) => setSelectedWaybillId(e.target.value)}
                  >
                    <option value="">请选择待收运单</option>
                    {pendingWaybills.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.tracking_no} - {w.logistics_companies?.name || w.logistics_company_name || "未知物流"}
                        {w.freight_amount > 0 ? ` (运费:${w.freight_amount})` : ""}
                        {w.cod_amount > 0 ? ` (代收:${w.cod_amount})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm text-gray-400">暂无待收运单</div>
                )}
              </div>
            )}

            {waybillMode === "new" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">物流单号 *</label>
                  <input
                    required={waybillMode === "new"}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={newWaybill.tracking_no}
                    onChange={(e) => setNewWaybill({ ...newWaybill, tracking_no: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">物流公司</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={newWaybill.logistics_company_id}
                    onChange={(e) => setNewWaybill({ ...newWaybill, logistics_company_id: e.target.value })}
                  >
                    <option value="">请选择</option>
                    {logisticsCompanies.filter((c) => !c.scopes || c.scopes.includes("harbin")).length > 0 && (
                      <optgroup label="哈市物流（哈市供应商）">
                        {logisticsCompanies.filter((c) => !c.scopes || c.scopes.includes("harbin")).map((c) => (
                          <option key={`harbin-${c.id}`} value={c.id}>{c.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {logisticsCompanies.filter((c) => c.scopes?.includes("outside")).length > 0 && (
                      <optgroup label="外阜快递（外阜供应商）">
                        {logisticsCompanies.filter((c) => c.scopes?.includes("outside")).map((c) => (
                          <option key={`outside-${c.id}`} value={c.id}>{c.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">运费金额</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={newWaybill.freight_amount}
                    onChange={(e) => setNewWaybill({ ...newWaybill, freight_amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">代收款金额</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={newWaybill.cod_amount}
                    onChange={(e) => setNewWaybill({ ...newWaybill, cod_amount: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">备注</label>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={newWaybill.notes}
                    onChange={(e) => setNewWaybill({ ...newWaybill, notes: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "保存中..." : "确认入库"}
          </button>
        </div>
      </form>
    </div>
  );
}
