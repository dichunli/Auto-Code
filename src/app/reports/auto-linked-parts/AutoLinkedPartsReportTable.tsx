"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface AutoLinkedRow {
  id: string;
  notes: string | null;
  created_at: string;
  parts?: {
    id: string;
    name?: string;
    part_number?: string;
    part_names?: {
      name?: string;
      auto_link_vehicle_model?: boolean;
      part_categories?: {
        name?: string;
        auto_link_vehicle_model?: boolean;
      };
    };
  };
  vehicle_models?: {
    厂商?: string;
    品牌?: string;
    车系?: string;
    车型?: string;
    销售版本?: string;
    年款?: number;
    排量?: string;
    发动机型号?: string;
    燃油类型?: string;
    进气形式?: string;
    变速箱类型?: string;
    变速箱代号?: string;
    底盘代号?: string;
    驱动方式?: string;
    车身类型?: string;
    排放标准?: string;
  };
}

export default function AutoLinkedPartsReportTable({ rows: initialRows }: { rows: AutoLinkedRow[] }) {
  const supabase = createClient();
  const [rows, setRows] = useState<AutoLinkedRow[]>(initialRows);
  const [noteValues, setNoteValues] = useState<Record<string, string>>(
    Object.fromEntries(initialRows.map((row) => [row.id, row.notes || ""]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [partSearch, setPartSearch] = useState("");

  // 过滤数据
  const filteredRows = rows.filter((row) => {
    const vehicleMatch = !vehicleSearch ||
      `${row.vehicle_models?.厂商 || ""} ${row.vehicle_models?.品牌 || ""} ${row.vehicle_models?.车系 || ""} ${row.vehicle_models?.车型 || ""}`.toLowerCase().includes(vehicleSearch.toLowerCase());

    const partMatch = !partSearch ||
      (row.parts?.name || "").toLowerCase().includes(partSearch.toLowerCase()) ||
      (row.parts?.part_names?.name || "").toLowerCase().includes(partSearch.toLowerCase()) ||
      (row.parts?.part_number || "").toLowerCase().includes(partSearch.toLowerCase());

    return vehicleMatch && partMatch;
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleSave(id: string) {
    setSavingId(id);
    const notes = noteValues[id]?.trim() || null;
    const { error } = await supabase.from("part_vehicle_models").update({ notes }).eq("id", id);
    setSavingId(null);
    if (error) {
      alert("保存失败：" + error.message);
      return;
    }
    setRows((current) => current.map((row) => (row.id === id ? { ...row, notes } : row)));
  }

  async function handleDelete(id: string) {
    if (!confirm("确认删除该自动关联记录？删除后需要手动重新关联。")) {
      return;
    }
    setDeletingId(id);
    const { error } = await supabase.from("part_vehicle_models").delete().eq("id", id);
    setDeletingId(null);
    if (error) {
      alert("删除失败：" + error.message);
      return;
    }
    setRows((current) => current.filter((row) => row.id !== id));
  }

  return (
    <div className="space-y-4">
      {/* 搜索框 */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">搜索车型</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            placeholder="输入厂商、品牌、车系或车型名称"
            value={vehicleSearch}
            onChange={(e) => setVehicleSearch(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">搜索配件</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            placeholder="输入配件名称或编号"
            value={partSearch}
            onChange={(e) => setPartSearch(e.target.value)}
          />
        </div>
      </div>

      {/* 记录数提示 */}
      <div className="text-sm text-gray-600">
        显示 {filteredRows.length} 条记录
        {(vehicleSearch || partSearch) && (
          <span className="ml-2 text-blue-600">
            (共 {rows.length} 条记录，已筛选)
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-500">配件名称</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">配件编号</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">分类</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">车型</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">年款</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">发动机</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">自动关联</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filteredRows.length > 0 ? (
            filteredRows.map((row) => {
              const partName = row.parts?.name || row.parts?.part_names?.name || "-";
              const partNumber = row.parts?.part_number || "-";
              const category = row.parts?.part_names?.part_categories?.name || "-";
              const vehicle = row.vehicle_models;
              const vehicleLabel = vehicle
                ? [vehicle.厂商, vehicle.品牌, vehicle.车系, vehicle.车型, vehicle.销售版本].filter(Boolean).join(" ")
                : "-";
              const year = vehicle?.年款 ? String(vehicle.年款) : "-";
              const engine = vehicle?.发动机型号 || "-";
              const autoLinked =
                row.parts?.part_names?.auto_link_vehicle_model ||
                row.parts?.part_names?.part_categories?.auto_link_vehicle_model;
              return (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">
                    {row.parts?.id ? (
                      <Link href={`/parts/${row.parts.id}`} className="text-blue-600 hover:underline">
                        {partName}
                      </Link>
                    ) : (
                      partName
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{partNumber}</td>
                  <td className="px-4 py-3 text-gray-600">{category}</td>
                  <td className="px-4 py-3 text-gray-600">{vehicleLabel}</td>
                  <td className="px-4 py-3 text-gray-600">{year}</td>
                  <td className="px-4 py-3 text-gray-600">{engine}</td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      value={noteValues[row.id] ?? ""}
                      onChange={(e) =>
                        setNoteValues((prev) => ({ ...prev, [row.id]: e.target.value }))
                      }
                      placeholder="填写备注"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{autoLinked ? "是" : "否"}</td>
                  <td className="px-4 py-3 text-gray-600 space-x-2">
                    <button
                      type="button"
                      onClick={() => handleSave(row.id)}
                      disabled={savingId === row.id}
                      className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {savingId === row.id ? "保存中..." : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(row.id)}
                      disabled={deletingId === row.id}
                      className="px-3 py-1 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingId === row.id ? "删除中..." : "删除"}
                    </button>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                暂无自动关联记录
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </div>
  );
}
