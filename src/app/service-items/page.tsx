"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import * as XLSX from "xlsx";
import { DeleteButton } from "./DeleteButton";
import ServiceItemMergeDialog from "@/components/ServiceItemMergeDialog";

interface ServiceItem {
  id: string;
  code: string | null;
  name: string;
  search_keywords: string | null;
  standard_hours: number | null;
  default_price: number | null;
  vip_price: number | null;
  customer_parts_price: number | null;
  company_price: number | null;
  is_vehicle_specific: boolean;
  category_id: string | null;
  service_categories: { name: string } | null;
}

interface ServiceCategory {
  id: string;
  name: string;
}

const importFields = [
  { key: "项目名称", required: true },
  { key: "分类名称", required: true },
  { key: "项目说明", required: false },
  { key: "销售价", required: false },
  { key: "VIP价", required: false },
  { key: "自带配件价", required: false },
  { key: "单位价", required: false },
];

const pageSize = 20;

export default function ServiceItemsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* 搜索 */
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);

  /* 分页 */
  const [currentPage, setCurrentPage] = useState(1);

  /* 选择 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* 分类列表（用于批量修改） */
  const [categories, setCategories] = useState<ServiceCategory[]>([]);

  /* 批量修改弹窗 */
  const [batchOpen, setBatchOpen] = useState(false);

  /* 合并弹窗 */
  const [mergeOpen, setMergeOpen] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);

  const [batchCategoryId, setBatchCategoryId] = useState("");
  const [batchStandardHours, setBatchStandardHours] = useState("");
  const [batchDefaultPrice, setBatchDefaultPrice] = useState("");
  const [batchVipPrice, setBatchVipPrice] = useState("");
  const [batchCustomerPartsPrice, setBatchCustomerPartsPrice] = useState("");
  const [batchCompanyPrice, setBatchCompanyPrice] = useState("");
  const [modifyCategory, setModifyCategory] = useState(false);
  const [modifyHours, setModifyHours] = useState(false);
  const [modifyPrice, setModifyPrice] = useState(false);
  const [modifyVip, setModifyVip] = useState(false);
  const [modifyCustomerParts, setModifyCustomerParts] = useState(false);
  const [modifyCompany, setModifyCompany] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("service_items")
      .select("*, service_categories(name)")
      .order("created_at", { ascending: false });
    setItems((data as ServiceItem[]) || []);
    setLoading(false);
  }, [supabase]);

  const loadCategories = useCallback(async () => {
    const { data } = await supabase.from("service_categories").select("id, name").order("name");
    setCategories(data || []);
  }, [supabase]);

  useEffect(() => {
    loadItems();
    loadCategories();
  }, [loadItems, loadCategories, supabase]);

  /* 搜索防抖：页码和选中状态随防抖值重置 */
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [debouncedQuery]);

  const filteredItems = useMemo(() => {
    if (!debouncedQuery) return items;
    const q = debouncedQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.search_keywords && item.search_keywords.toLowerCase().includes(q)) ||
        (item.code && item.code.toLowerCase().includes(q))
    );
  }, [items, debouncedQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  const allCurrentSelected = paginatedItems.length > 0 && paginatedItems.every((i) => selectedIds.has(i.id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allCurrentSelected) {
        paginatedItems.forEach((i) => next.delete(i.id));
      } else {
        paginatedItems.forEach((i) => next.add(i.id));
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBatchSave() {
    if (selectedIds.size === 0) {
      alert("请先选择要修改的项目");
      return;
    }
    const ids = Array.from(selectedIds);
    const updates: Record<string, unknown> = {};
    if (modifyCategory && batchCategoryId) updates.category_id = batchCategoryId;
    if (modifyHours) {
      const val = batchStandardHours.trim();
      updates.standard_hours = val === "" ? null : parseFloat(val);
    }
    if (modifyPrice) {
      const val = batchDefaultPrice.trim();
      updates.default_price = val === "" ? null : parseFloat(val);
    }
    if (modifyVip) {
      const val = batchVipPrice.trim();
      updates.vip_price = val === "" ? null : parseFloat(val);
    }
    if (modifyCustomerParts) {
      const val = batchCustomerPartsPrice.trim();
      updates.customer_parts_price = val === "" ? null : parseFloat(val);
    }
    if (modifyCompany) {
      const val = batchCompanyPrice.trim();
      updates.company_price = val === "" ? null : parseFloat(val);
    }
    if (Object.keys(updates).length === 0) {
      alert("请至少选择一项要修改的内容");
      return;
    }
    setBatchSaving(true);
    const { error } = await supabase.from("service_items").update(updates).in("id", ids);
    setBatchSaving(false);
    if (error) {
      alert("批量修改失败: " + error.message);
      return;
    }
    setBatchOpen(false);
    setSelectedIds(new Set());
    setModifyCategory(false);
    setModifyHours(false);
    setModifyPrice(false);
    setModifyVip(false);
    setModifyCustomerParts(false);
    setModifyCompany(false);
    setBatchCategoryId("");
    setBatchStandardHours("");
    setBatchDefaultPrice("");
    setBatchVipPrice("");
    setBatchCustomerPartsPrice("");
    setBatchCompanyPrice("");
    loadItems();
  }

  function handleDownloadTemplate() {
    const headers = importFields.map((f) => f.key);
    const example = [
      "更换机油",
      "常规保养",
      "含机油滤芯更换",
      280,
      250,
      200,
      220,
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "维修项目导入模板");
    XLSX.writeFile(wb, "维修项目导入模板.xlsx");
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportMsg("正在读取文件...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rows.length < 2) {
        setImportMsg("文件中没有数据");
        setImporting(false);
        return;
      }

      const headers: string[] = rows[0];
      const dataRows = rows.slice(1);

      /* 加载所有分类用于名称匹配 */
      setImportMsg("正在加载分类数据...");
      const { data: categoriesData } = await supabase.from("service_categories").select("id, name");
      const categoryMap = new Map((categoriesData || []).map((c: ServiceCategory) => [c.name, c.id]));

      const records: Record<string, unknown>[] = [];
      const errors: string[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const record: Record<string, unknown> = {};
        for (let j = 0; j < headers.length; j++) {
          const key = headers[j];
          let value = row[j];
          if (value === undefined || value === "") value = null;
          record[key] = value;
        }

        const rowNum = i + 2;
        if (!record["项目名称"]) {
          errors.push(`第 ${rowNum} 行: 项目名称不能为空`);
          continue;
        }
        if (!record["分类名称"]) {
          errors.push(`第 ${rowNum} 行: 分类名称不能为空`);
          continue;
        }

        const categoryId = categoryMap.get(String(record["分类名称"]));
        if (!categoryId) {
          errors.push(`第 ${rowNum} 行: 分类"${record["分类名称"]}"不存在，请先创建该分类`);
          continue;
        }

        const autoCode = `XM-${Date.now().toString(36).toUpperCase().slice(-6)}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
        records.push({
          code: autoCode,
          category_id: categoryId,
          name: String(record["项目名称"]).trim(),
          description: record["项目说明"] ? String(record["项目说明"]).trim() : null,
          default_price: record["销售价"] ? parseFloat(record["销售价"]) : null,
          vip_price: record["VIP价"] ? parseFloat(record["VIP价"]) : null,
          customer_parts_price: record["自带配件价"] ? parseFloat(record["自带配件价"]) : null,
          company_price: record["单位价"] ? parseFloat(record["单位价"]) : null,
        });
      }

      if (records.length === 0) {
        setImportMsg("没有有效数据可导入\n" + errors.slice(0, 5).join("\n"));
        setImporting(false);
        return;
      }

      setImportMsg(`验证通过 ${records.length} 条，开始导入...`);
      const batchSize = 100;
      let inserted = 0;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase.from("service_items").insert(batch);
        if (error) {
          setImportMsg(`第 ${i + 1} 批导入失败: ${error.message}`);
          setImporting(false);
          return;
        }
        inserted += batch.length;
        setImportMsg(`已导入 ${inserted}/${records.length} 条...`);
      }

      let msg = `导入完成：新增 ${inserted} 条`;
      if (errors.length > 0) {
        msg += `，跳过 ${errors.length} 条（有错误）`;
      }
      setImportMsg(msg);
      loadItems();
    } catch (err: unknown) {
      setImportMsg("导入出错: " + (err instanceof Error ? err.message : String(err)));
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      <PageHeader
        title="维修项目"
        description="管理维修项目，支持搜索关键字快速查找"
        action={{ href: "/service-items/new", label: "新建项目" }}
      />

      {/* 搜索 + 导入工具栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="搜索项目名称、关键字或编码"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-xs px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="px-3 py-2 text-sm font-medium text-blue-600 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
        >
          下载导入模板
        </button>
        <label className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer disabled:opacity-50">
          {importing ? "导入中..." : "批量导入"}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
            }}
          />
        </label>
        {importMsg && (
          <span className="text-sm text-gray-600">{importMsg}</span>
        )}
      </div>

      {/* 批量操作栏 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-sm text-gray-600">已选 {selectedIds.size} 项</span>
              <button
                onClick={() => setBatchOpen(true)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                批量修改
              </button>
              {selectedIds.size >= 2 && (
                <button
                  onClick={() => setMergeOpen(true)}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700"
                >
                  合并
                </button>
              )}
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                取消选择
              </button>
            </>
          ) : (
            <span className="text-sm text-gray-400">勾选项目可进行批量修改</span>
          )}
        </div>
        <span className="text-sm text-gray-500">
          共 {filteredItems.length} 条，第 {safePage}/{totalPages} 页
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  <input
                    type="checkbox"
                    checked={allCurrentSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">编码</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">项目名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">搜索关键字</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">默认价格</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车型定价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginatedItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    <Link
                      href={`/service-items/${item.id}/edit`}
                      className="hover:text-blue-600 hover:underline"
                    >
                      {item.code || "-"}
                    </Link>
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                  <td className="px-6 py-4 text-gray-500 text-xs max-w-[200px] truncate">{item.search_keywords || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{item.service_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(item.default_price)}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded ${item.is_vehicle_specific ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600"}`}>
                      {item.is_vehicle_specific ? "按车型定价" : "通用价格"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/service-items/${item.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                      <DeleteButton id={item.id} name={item.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!paginatedItems || paginatedItems.length === 0) && (
                <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-400">暂无维修项目</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                page === safePage ? "bg-blue-600 text-white" : "border border-gray-300 hover:bg-gray-50"
              }`}
            >
              {page}
            </button>
          ))}
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>
      )}

      {/* 合并弹窗 */}
      {mergeOpen && (
        <ServiceItemMergeDialog
          open={mergeOpen}
          selectedItems={items.filter((i) => selectedIds.has(i.id)).map((i) => ({ id: i.id, name: i.name, code: i.code }))}
          onClose={() => setMergeOpen(false)}
          onSuccess={() => {
            setSelectedIds(new Set());
            loadItems();
          }}
        />
      )}

      {/* 批量修改弹窗 */}
      {batchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">批量修改（已选 {selectedIds.size} 项）</h3>
            <div className="space-y-4">
              {/* 分类 */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
                  <select
                    value={batchCategoryId}
                    onChange={(e) => setBatchCategoryId(e.target.value)}
                    disabled={!modifyCategory}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="">请选择分类</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-1.5 mt-5">
                  <input
                    type="checkbox"
                    checked={modifyCategory}
                    onChange={(e) => setModifyCategory(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">修改</span>
                </label>
              </div>

              {/* 标准工时 */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">标准工时</label>
                  <input
                    type="number"
                    step="0.1"
                    value={batchStandardHours}
                    onChange={(e) => setBatchStandardHours(e.target.value)}
                    disabled={!modifyHours}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <label className="flex items-center gap-1.5 mt-5">
                  <input
                    type="checkbox"
                    checked={modifyHours}
                    onChange={(e) => setModifyHours(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">修改</span>
                </label>
              </div>

              {/* 销售价 */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">销售价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={batchDefaultPrice}
                    onChange={(e) => setBatchDefaultPrice(e.target.value)}
                    disabled={!modifyPrice}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <label className="flex items-center gap-1.5 mt-5">
                  <input
                    type="checkbox"
                    checked={modifyPrice}
                    onChange={(e) => setModifyPrice(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">修改</span>
                </label>
              </div>

              {/* VIP价 */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">VIP价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={batchVipPrice}
                    onChange={(e) => setBatchVipPrice(e.target.value)}
                    disabled={!modifyVip}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <label className="flex items-center gap-1.5 mt-5">
                  <input
                    type="checkbox"
                    checked={modifyVip}
                    onChange={(e) => setModifyVip(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">修改</span>
                </label>
              </div>

              {/* 自带配件价 */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">自带配件价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={batchCustomerPartsPrice}
                    onChange={(e) => setBatchCustomerPartsPrice(e.target.value)}
                    disabled={!modifyCustomerParts}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <label className="flex items-center gap-1.5 mt-5">
                  <input
                    type="checkbox"
                    checked={modifyCustomerParts}
                    onChange={(e) => setModifyCustomerParts(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">修改</span>
                </label>
              </div>

              {/* 单位价 */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">单位价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={batchCompanyPrice}
                    onChange={(e) => setBatchCompanyPrice(e.target.value)}
                    disabled={!modifyCompany}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <label className="flex items-center gap-1.5 mt-5">
                  <input
                    type="checkbox"
                    checked={modifyCompany}
                    onChange={(e) => setModifyCompany(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">修改</span>
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setBatchOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleBatchSave}
                disabled={batchSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {batchSaving ? "保存中..." : "确定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
