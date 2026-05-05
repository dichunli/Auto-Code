"use client";

import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import DeletePartButton from "./DeletePartButton";
import { formatCurrency } from "@/lib/utils";

interface ColumnDef {
  key: string;
  label: string;
  width: number;
  visible: boolean;
  sticky?: boolean;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: "checkbox", label: "", width: 50, visible: true, sticky: true },
  { key: "part_number", label: "配件编号", width: 120, visible: true, sticky: true },
  { key: "name", label: "名称", width: 150, visible: true, sticky: true },
  { key: "document_name", label: "单据名称", width: 120, visible: true },
  { key: "category", label: "分类", width: 80, visible: true },
  { key: "brand", label: "品牌", width: 80, visible: true },
  { key: "specs", label: "规格", width: 160, visible: true },
  { key: "stock", label: "库存", width: 100, visible: true },
  { key: "purchase_price", label: "采购价", width: 80, visible: true },
  { key: "unit_cost", label: "成本价", width: 80, visible: true },
  { key: "unit_price", label: "销售价", width: 80, visible: true },
  { key: "location", label: "存放位置", width: 100, visible: true },
  { key: "barcode", label: "条形码", width: 100, visible: true },
  { key: "actions", label: "操作", width: 120, visible: true },
];

const STORAGE_KEY = "inventory-table-config";

function computeStickyLeft(columns: ColumnDef[], targetKey: string): number {
  let left = 0;
  for (const c of columns) {
    if (c.key === targetKey) break;
    if (c.sticky && c.visible) {
      left += c.width;
    }
  }
  return left;
}

export default function InventoryTable({ items }: { items: any[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMNS;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return DEFAULT_COLUMNS.map((def) => {
          const savedCol = parsed.find((c: ColumnDef) => c.key === def.key);
          return savedCol ? { ...def, ...savedCol } : def;
        });
      }
    } catch {}
    return DEFAULT_COLUMNS;
  });

  const [colSettingsOpen, setColSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
    } catch {}
  }, [columns]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setColSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const [resizing, setResizing] = useState<{ key: string; startX: number; startWidth: number } | null>(null);

  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const col = columns.find((c) => c.key === key);
    if (!col) return;
    setResizing({ key, startX: e.clientX, startWidth: col.width });
  }, [columns]);

  useEffect(() => {
    if (!resizing) return;
    const { key, startX, startWidth } = resizing;
    function onMove(e: MouseEvent) {
      const delta = e.clientX - startX;
      setColumns((prev) =>
        prev.map((c) =>
          c.key === key ? { ...c, width: Math.max(50, startWidth + delta) } : c
        )
      );
    }
    function onUp() {
      setResizing(null);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  const [draggingCol, setDraggingCol] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) =>
      (item.part_number || "").toLowerCase().includes(q) ||
      (item.name || "").toLowerCase().includes(q) ||
      (item.barcode || "").toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);

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
      <html><head><title>打印条形码</title></head>
      <body style="text-align:center;padding:40px 20px;">
        <div style="margin-bottom:16px;font-size:16px;font-weight:500;">${part.name}</div>
        <img src="${imgData}" style="max-width:100%;" />
        <div style="margin-top:8px;font-size:13px;color:#666;">${code}</div>
      </body></html>
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
      html += `<div class="barcode-item"><div class="barcode-name">${part.name}</div><img src="${imgData}" /><div class="barcode-code">${code}</div></div>`;
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

  function renderCell(item: any, col: ColumnDef) {
    switch (col.key) {
      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={selectedIds.has(item.id)}
            onChange={() => toggleSelect(item.id)}
            className="rounded border-gray-300"
          />
        );
      case "part_number":
        return <span className="font-medium text-gray-900">{item.part_number}</span>;
      case "name":
        return <span className="text-gray-900">{item.name}</span>;
      case "document_name":
        return item.document_name || "-";
      case "category":
        return item.part_names?.part_categories?.name || "-";
      case "brand":
        return item.part_brands?.name || "-";
      case "specs": {
        const text = getSpecsText(item);
        return <span className="truncate">{text === "-" ? "-" : text.slice(0, 20)}</span>;
      }
      case "stock":
        return (
          <>
            <span className={`font-medium ${item.quantity <= item.min_stock ? "text-red-600" : "text-gray-900"}`}>
              {item.quantity}
            </span>
            {item.quantity <= item.min_stock && (
              <span className="ml-2 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">库存不足</span>
            )}
          </>
        );
      case "purchase_price":
        return formatCurrency(item.purchase_price);
      case "unit_cost":
        return formatCurrency(item.unit_cost);
      case "unit_price":
        return formatCurrency(item.unit_price);
      case "location":
        return item.location || "-";
      case "barcode":
        return item.barcode || "-";
      case "actions":
        return (
          <div className="space-x-3 whitespace-nowrap">
            <Link href={`/parts/${item.id}`} className="text-xs text-blue-600 hover:text-blue-700">
              查看
            </Link>
            <button onClick={() => printSingle(item)} className="text-xs text-gray-600 hover:text-gray-900">
              打印条码
            </button>
            <DeletePartButton partId={item.id} />
          </div>
        );
      default:
        return "-";
    }
  }

  const visibleColumns = columns.filter((c) => c.visible);
  const tableMinWidth = visibleColumns.reduce((sum, c) => sum + c.width, 0);

  const isDraggable = (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (!col) return false;
    return !col.sticky && key !== "actions";
  };

  return (
    <div>
      {/* 搜索框 + 列设置 */}
      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder="搜索配件编号、名称、条形码"
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            onClick={() => setColSettingsOpen((v) => !v)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            列设置
          </button>
          {colSettingsOpen && (
            <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3">
              <div className="text-sm font-medium text-gray-700 mb-2">显示列</div>
              <div className="space-y-1.5">
                {columns
                  .filter((c) => c.key !== "checkbox" && c.key !== "actions")
                  .map((col) => (
                    <label key={col.key} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={col.visible}
                        onChange={() =>
                          setColumns((prev) =>
                            prev.map((c) => (c.key === col.key ? { ...c, visible: !c.visible } : c))
                          )
                        }
                        className="rounded border-gray-300"
                      />
                      <span className="text-gray-700">{col.label}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}
        </div>
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
        <table className="w-full text-sm border-collapse" style={{ minWidth: tableMinWidth }}>
          <thead className="bg-gray-50">
            <tr>
              {visibleColumns.map((col) => {
                const stickyLeft = col.sticky ? computeStickyLeft(columns, col.key) : undefined;
                const style: React.CSSProperties = {};
                if (stickyLeft !== undefined) {
                  style.position = "sticky";
                  style.left = stickyLeft;
                  style.zIndex = 10;
                }
                style.width = col.width;
                style.minWidth = col.width;

                return (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap ${
                      col.sticky ? "bg-gray-50" : ""
                    } ${draggingCol === col.key ? "opacity-50" : ""}`}
                    style={style}
                    draggable={isDraggable(col.key)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("col-key", col.key);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingCol(col.key);
                    }}
                    onDragEnd={() => setDraggingCol(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromKey = e.dataTransfer.getData("col-key");
                      if (!fromKey || fromKey === col.key || !isDraggable(fromKey)) return;
                      setColumns((prev) => {
                        const fromIndex = prev.findIndex((c) => c.key === fromKey);
                        const toIndex = prev.findIndex((c) => c.key === col.key);
                        if (fromIndex === -1 || toIndex === -1) return prev;
                        const frozenCount = prev.filter((c) => c.sticky).length;
                        const actionsIndex = prev.findIndex((c) => c.key === "actions");
                        const minIndex = frozenCount;
                        const maxIndex = actionsIndex >= 0 ? actionsIndex - 1 : prev.length - 1;
                        let newToIndex = toIndex;
                        if (newToIndex < minIndex) newToIndex = minIndex;
                        if (newToIndex > maxIndex) newToIndex = maxIndex;
                        if (fromIndex === newToIndex) return prev;
                        const next = [...prev];
                        const [removed] = next.splice(fromIndex, 1);
                        next.splice(newToIndex, 0, removed);
                        return next;
                      });
                    }}
                  >
                    <div className="relative flex items-center">
                      <span>{col.label}</span>
                      {col.key !== "checkbox" && col.key !== "actions" && (
                        <div
                          className="absolute right-[-6px] top-0 bottom-0 w-[6px] cursor-col-resize z-20"
                          onMouseDown={(e) => startResize(col.key, e)}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedItems.map((item: any) => (
              <tr key={item.id} className="hover:bg-gray-50">
                {visibleColumns.map((col) => {
                  const stickyLeft = col.sticky ? computeStickyLeft(columns, col.key) : undefined;
                  const style: React.CSSProperties = {};
                  if (stickyLeft !== undefined) {
                    style.position = "sticky";
                    style.left = stickyLeft;
                    style.zIndex = 10;
                  }
                  style.width = col.width;
                  style.minWidth = col.width;

                  return (
                    <td
                      key={col.key}
                      className={`px-4 py-4 whitespace-nowrap ${col.sticky ? "bg-white" : ""}`}
                      style={style}
                    >
                      {renderCell(item, col)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {paginatedItems.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-6 py-12 text-center text-gray-400">
                  暂无配件数据
                </td>
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

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
