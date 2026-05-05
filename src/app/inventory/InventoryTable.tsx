"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import DeletePartButton from "./DeletePartButton";
import { formatCurrency } from "@/lib/utils";

export default function InventoryTable({ items }: { items: any[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) =>
      (item.part_number || "").toLowerCase().includes(q) ||
      (item.name || "").toLowerCase().includes(q) ||
      (item.barcode || "").toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length && items.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  }

  function printSingle(part: any) {
    const code = part.barcode || part.part_number || part.id;
    if (!canvasRef.current) return;

    try {
      JsBarcode(canvasRef.current, code, {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 14,
      });
    } catch {
      alert("生成条形码失败");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("请允许弹出窗口以打印条形码");
      return;
    }

    const imgData = canvasRef.current.toDataURL("image/png");
    printWindow.document.write(`
      <html>
        <head><title>打印条形码</title></head>
        <body style="text-align:center;padding:40px 20px;">
          <div style="margin-bottom:16px;font-size:16px;font-weight:500;">${part.name}</div>
          <img src="${imgData}" style="max-width:100%;" />
          <div style="margin-top:8px;font-size:13px;color:#666;">${code}</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  }

  function printBatch() {
    const selected = items.filter((i) => selectedIds.has(i.id));
    if (selected.length === 0) {
      alert("请先选择要打印的配件");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("请允许弹出窗口以打印条形码");
      return;
    }

    const canvas = document.createElement("canvas");
    let html = `<html><head><title>批量打印条形码</title><style>
      body { font-family: sans-serif; padding: 20px; }
      .barcode-grid { display: flex; flex-wrap: wrap; gap: 16px; }
      .barcode-item { width: 200px; text-align: center; border: 1px solid #e5e7eb; padding: 12px; border-radius: 8px; }
      .barcode-name { font-size: 13px; font-weight: 500; margin-bottom: 8px; color: #111; }
      .barcode-code { font-size: 11px; color: #666; margin-top: 4px; }
      img { max-width: 100%; }
    </style></head><body><div class="barcode-grid">`;

    for (const part of selected) {
      const code = part.barcode || part.part_number || part.id;
      try {
        JsBarcode(canvas, code, {
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 12,
        });
      } catch {
        continue;
      }
      const imgData = canvas.toDataURL("image/png");
      html += `<div class="barcode-item">
        <div class="barcode-name">${part.name}</div>
        <img src="${imgData}" />
        <div class="barcode-code">${code}</div>
      </div>`;
    }

    html += `</div></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }

  function getSpecsText(item: any) {
    const specs = item.parts_specifications;
    if (!specs || specs.length === 0) return "-";
    return specs
      .map((s: any) => s.part_specifications?.name || "")
      .filter(Boolean)
      .join(", ");
  }

  return (
    <div>
      {/* 搜索框 */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="搜索配件编号、名称、条形码"
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 批量操作栏 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-sm text-gray-600">已选 {selectedIds.size} 项</span>
              <button
                onClick={printBatch}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                批量打印条码
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                取消选择
              </button>
            </>
          ) : (
            <span className="text-sm text-gray-400">勾选配件可进行批量打印条码</span>
          )}
        </div>
        <span className="text-sm text-gray-500">
          共 {filteredItems.length} 条，第 {safePage}/{totalPages} 页
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1200px] border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selectedIds.size === items.length}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 sticky left-0 bg-gray-50 z-10 w-[120px] min-w-[120px]">配件编号</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 sticky left-[120px] bg-gray-50 z-10 w-[150px] min-w-[150px]">名称</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">单据名称</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">分类</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">品牌</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">规格</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">库存</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">采购价</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">成本价</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">销售价</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">存放位置</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">条形码</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedItems.map((item: any) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="px-4 py-4 font-medium text-gray-900 sticky left-0 bg-white z-10 w-[120px] min-w-[120px] whitespace-nowrap">{item.part_number}</td>
                <td className="px-4 py-4 text-gray-900 sticky left-[120px] bg-white z-10 w-[150px] min-w-[150px] whitespace-nowrap">{item.name}</td>
                <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{item.document_name || "-"}</td>
                <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{item.part_names?.part_categories?.name || "-"}</td>
                <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{item.part_brands?.name || "-"}</td>
                <td className="px-4 py-4 text-gray-600 max-w-[160px] truncate whitespace-nowrap" title={getSpecsText(item)}>
                  {getSpecsText(item).slice(0, 20)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className={`font-medium ${item.quantity <= item.min_stock ? "text-red-600" : "text-gray-900"}`}>
                    {item.quantity}
                  </span>
                  {item.quantity <= item.min_stock && (
                    <span className="ml-2 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">库存不足</span>
                  )}
                </td>
                <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{formatCurrency(item.purchase_price)}</td>
                <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{formatCurrency(item.unit_cost)}</td>
                <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{formatCurrency(item.unit_price)}</td>
                <td className="px-4 py-4 text-gray-500 whitespace-nowrap">{item.location || "-"}</td>
                <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{item.barcode || "-"}</td>
                <td className="px-4 py-4 text-right space-x-3 whitespace-nowrap">
                  <Link
                    href={`/parts/${item.id}`}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    查看
                  </Link>
                  <button
                    onClick={() => printSingle(item)}
                    className="text-xs text-gray-600 hover:text-gray-900"
                  >
                    打印条码
                  </button>
                  <DeletePartButton partId={item.id} />
                </td>
              </tr>
            ))}
            {paginatedItems.length === 0 && (
              <tr>
                <td colSpan={14} className="px-6 py-12 text-center text-gray-400">暂无配件数据</td>
              </tr>
            )}
          </tbody>
        </table>
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
                page === safePage
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 hover:bg-gray-50"
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

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
