"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { QRCodeSVG } from "qrcode.react";

function normalizeLocationName(value: string): string {
  return value
    .replace(/[^一-龥a-zA-Z0-9\-]/g, "")
    .toUpperCase();
}

export default function WarehousesPage() {
  const router = useRouter();
  const supabase = createClient();
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrModal, setQrModal] = useState<{ open: boolean; name: string; id: string } | null>(null);

  const [locationModal, setLocationModal] = useState<{ open: boolean; warehouseId: string; warehouseName: string } | null>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [newLocation, setNewLocation] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [locLoading, setLocLoading] = useState(false);

  const [printItem, setPrintItem] = useState<{ open: boolean; name: string; id: string } | null>(null);

  const [editingWh, setEditingWh] = useState<string | null>(null);
  const [editWhName, setEditWhName] = useState("");
  const [editWhAddress, setEditWhAddress] = useState("");

  const [editingLoc, setEditingLoc] = useState<string | null>(null);
  const [editLocName, setEditLocName] = useState("");

  useEffect(() => {
    fetchWarehouses();
  }, []);

  async function fetchWarehouses() {
    setLoading(true);
    const { data } = await supabase.from("warehouses").select("*").order("created_at", { ascending: false });
    const list = data || [];
    list.sort((a: any, b: any) => {
      const aMain = a.name === "主仓库" || a.name.includes("主") ? -1 : 0;
      const bMain = b.name === "主仓库" || b.name.includes("主") ? -1 : 0;
      if (aMain !== bMain) return aMain - bMain;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    setWarehouses(list);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除该仓库？关联的库存分布将一并清除。")) return;
    await supabase.from("warehouses").delete().eq("id", id);
    fetchWarehouses();
  }

  function startEditWh(w: any) {
    setEditingWh(w.id);
    setEditWhName(w.name);
    setEditWhAddress(w.address || "");
  }

  function cancelEditWh() {
    setEditingWh(null);
    setEditWhName("");
    setEditWhAddress("");
  }

  async function saveWh(id: string) {
    if (!editWhName.trim()) return;
    const { error } = await supabase
      .from("warehouses")
      .update({ name: editWhName.trim(), address: editWhAddress.trim() || null })
      .eq("id", id);
    if (error) {
      alert("保存失败：" + error.message);
      return;
    }
    setEditingWh(null);
    await fetchWarehouses();
  }

  async function openLocationModal(warehouseId: string, warehouseName: string) {
    setLocationModal({ open: true, warehouseId, warehouseName });
    setNewLocation("");
    setBatchText("");
    setBatchMode(false);
    setEditingLoc(null);
    await fetchLocations(warehouseId);
  }

  async function fetchLocations(warehouseId: string) {
    setLocLoading(true);
    const { data } = await supabase
      .from("warehouse_locations")
      .select("*")
      .eq("warehouse_id", warehouseId)
      .order("name", { ascending: true });
    setLocations(data || []);
    setLocLoading(false);
  }

  async function addLocation() {
    if (!locationModal || !newLocation.trim()) return;
    const name = normalizeLocationName(newLocation.trim());
    if (!name) {
      alert("仓位名称只能包含中文、英文、数字和-");
      return;
    }
    const { error } = await supabase.from("warehouse_locations").insert({
      warehouse_id: locationModal.warehouseId,
      name,
    });
    if (error) {
      alert("添加失败：" + error.message);
      return;
    }
    setNewLocation("");
    await fetchLocations(locationModal.warehouseId);
  }

  async function addBatchLocations() {
    if (!locationModal || !batchText.trim()) return;
    const names = batchText
      .split(/\n/)
      .map((line) => normalizeLocationName(line.trim()))
      .filter(Boolean);
    const uniqueNames = Array.from(new Set(names));
    if (uniqueNames.length === 0) {
      alert("没有有效的仓位名称（仅支持中文、英文、数字和-）");
      return;
    }
    const rows = uniqueNames.map((name) => ({
      warehouse_id: locationModal.warehouseId,
      name,
    }));
    const { error } = await supabase.from("warehouse_locations").insert(rows);
    if (error) {
      alert("批量添加失败：" + error.message);
      return;
    }
    setBatchText("");
    await fetchLocations(locationModal.warehouseId);
  }

  async function deleteLocation(id: string) {
    if (!confirm("确定删除该仓位？")) return;
    await supabase.from("warehouse_locations").delete().eq("id", id);
    if (locationModal) {
      await fetchLocations(locationModal.warehouseId);
    }
  }

  function startEditLoc(loc: any) {
    setEditingLoc(loc.id);
    setEditLocName(loc.name);
  }

  function cancelEditLoc() {
    setEditingLoc(null);
    setEditLocName("");
  }

  async function saveLoc(id: string) {
    const name = normalizeLocationName(editLocName.trim());
    if (!name) {
      alert("仓位名称只能包含中文、英文、数字和-");
      return;
    }
    const { error } = await supabase.from("warehouse_locations").update({ name }).eq("id", id);
    if (error) {
      alert("保存失败：" + error.message);
      return;
    }
    setEditingLoc(null);
    if (locationModal) {
      await fetchLocations(locationModal.warehouseId);
    }
  }

  function handlePrint(item: { name: string; id: string }) {
    setPrintItem({ open: true, name: item.name, id: item.id });
  }

  function doPrint() {
    window.print();
  }

  return (
    <div>
      <PageHeader
        title="仓库管理"
        description={`共 ${warehouses.length} 个仓库`}
        action={{ href: "/inventory/warehouses/new", label: "新增仓库" }}
      />

      {loading ? (
        <div className="text-center text-gray-400 py-12">加载中...</div>
      ) : warehouses.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 mb-4">暂无仓库数据</p>
          <button
            onClick={() => router.push("/inventory/warehouses/new")}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            新增仓库
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">仓库名称</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">地址</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">二维码</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {warehouses.map((w) => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      {editingWh === w.id ? (
                        <input
                          type="text"
                          value={editWhName}
                          onChange={(e) => setEditWhName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveWh(w.id);
                            if (e.key === "Escape") cancelEditWh();
                          }}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                      ) : (
                        <span className="font-medium text-gray-900">{w.name}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {editingWh === w.id ? (
                        <input
                          type="text"
                          value={editWhAddress}
                          onChange={(e) => setEditWhAddress(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveWh(w.id);
                            if (e.key === "Escape") cancelEditWh();
                          }}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-gray-600">{w.address || "-"}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(w.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => setQrModal({ open: true, name: w.name, id: w.id })}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        查看二维码
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right space-x-3">
                      {editingWh === w.id ? (
                        <>
                          <button
                            onClick={() => saveWh(w.id)}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            保存
                          </button>
                          <button
                            onClick={cancelEditWh}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditWh(w)}
                            className="text-xs text-gray-600 hover:text-gray-900"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => openLocationModal(w.id, w.name)}
                            className="text-xs text-gray-600 hover:text-gray-900"
                          >
                            仓位
                          </button>
                          <button
                            onClick={() => handleDelete(w.id)}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            删除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {qrModal?.open && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setQrModal(null)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{qrModal.name}</h3>
            <p className="text-xs text-gray-400 mb-4 font-mono">{qrModal.id}</p>
            <div className="flex justify-center mb-4">
              <QRCodeSVG value={qrModal.id} size={200} />
            </div>
            <p className="text-xs text-gray-500 mb-4">扫码可查看该仓库库存清单</p>
            <button
              onClick={() => setQrModal(null)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {locationModal?.open && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setLocationModal(null)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-lg w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{locationModal.warehouseName}</h3>
            <p className="text-xs text-gray-400 mb-4">仓位管理</p>

            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setBatchMode(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${!batchMode ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                单条添加
              </button>
              <button
                onClick={() => setBatchMode(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${batchMode ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                批量添加
              </button>
            </div>

            {!batchMode ? (
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addLocation();
                  }}
                  placeholder="输入仓位名称，如 A区-01货架"
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={addLocation}
                  disabled={!newLocation.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  新增
                </button>
              </div>
            ) : (
              <div className="mb-4">
                <textarea
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder="每行一个仓位名称，支持从Excel直接粘贴&#10;例：&#10;A-01-01&#10;A-01-02&#10;B区-货架2"
                  rows={6}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-gray-400">支持中文、英文、数字、-，英文自动转大写，自动去重</p>
                  <button
                    onClick={addBatchLocations}
                    disabled={!batchText.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    批量新增
                  </button>
                </div>
              </div>
            )}

            {locLoading ? (
              <div className="text-center text-gray-400 py-4 text-sm">加载中...</div>
            ) : locations.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">暂无仓位</div>
            ) : (
              <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
                {locations.map((loc) => (
                  <div key={loc.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50">
                    {editingLoc === loc.id ? (
                      <input
                        type="text"
                        value={editLocName}
                        onChange={(e) => setEditLocName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveLoc(loc.id);
                          if (e.key === "Escape") cancelEditLoc();
                        }}
                        className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 mr-3"
                        autoFocus
                      />
                    ) : (
                      <span className="text-sm text-gray-700">{loc.name}</span>
                    )}
                    <div className="flex items-center gap-3">
                      {editingLoc === loc.id ? (
                        <>
                          <button
                            onClick={() => saveLoc(loc.id)}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            保存
                          </button>
                          <button
                            onClick={cancelEditLoc}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditLoc(loc)}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handlePrint({ name: loc.name, id: loc.id })}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            打印标签
                          </button>
                          <button
                            onClick={() => deleteLocation(loc.id)}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 text-right">
              <button
                onClick={() => setLocationModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {printItem?.open && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 print:hidden"
          onClick={() => setPrintItem(null)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-md w-full mx-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4">打印仓位标签</h3>

            <div className="flex justify-center mb-6">
              <div
                className="label-preview"
                style={{
                  width: "50mm",
                  height: "30mm",
                  border: "1px dashed #ccc",
                  display: "flex",
                  alignItems: "center",
                  padding: "2mm",
                  gap: "2mm",
                  boxSizing: "border-box",
                  transform: "scale(3)",
                  transformOrigin: "center",
                  margin: "90px 0",
                }}
              >
                <QRCodeSVG value={printItem.id} size={72} />
                <div
                  style={{
                    flex: 1,
                    fontSize: "9pt",
                    fontWeight: 700,
                    lineHeight: 1.2,
                    wordBreak: "break-all",
                    textAlign: "left",
                    color: "#000",
                  }}
                >
                  {printItem.name}
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-400 mb-4">纸张尺寸：50mm × 30mm</p>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={doPrint}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                打印
              </button>
              <button
                onClick={() => setPrintItem(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {printItem?.open && (
        <div className="print-only fixed inset-0 bg-white flex items-center justify-center">
          <div
            className="print-label"
            style={{
              width: "50mm",
              height: "30mm",
              display: "flex",
              alignItems: "center",
              padding: "2mm",
              gap: "2mm",
              boxSizing: "border-box",
            }}
          >
            <QRCodeSVG value={printItem.id} size={80} />
            <div
              style={{
                flex: 1,
                fontSize: "10pt",
                fontWeight: 700,
                lineHeight: 1.2,
                wordBreak: "break-all",
                textAlign: "left",
                color: "#000",
              }}
            >
              {printItem.name}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @media print {
          @page {
            size: 50mm 30mm;
            margin: 0;
          }
          body * {
            visibility: hidden;
          }
          .print-only,
          .print-only * {
            visibility: visible;
          }
          .print-only {
            position: fixed;
            left: 0;
            top: 0;
            width: 100vw;
            height: 100vh;
            display: flex !important;
            align-items: center;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}
