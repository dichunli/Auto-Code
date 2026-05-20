"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import LicensePlateOcrButton from "@/components/LicensePlateOcrButton";

interface Vehicle {
  id: string;
  plate_number: string;
  brand: string;
  model: string;
  vin: string;
  color: string;
  year: number;
  mileage: number;
}

interface Props {
  customerId: string;
  initialVehicles: Vehicle[];
}

export default function VehicleSearchAdd({ customerId, initialVehicles }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialVehicles);
  const [searchPlate, setSearchPlate] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [transferVehicle, setTransferVehicle] = useState<any | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newVehicle, setNewVehicle] = useState({
    plate_number: "",
    vin: "",
    brand: "",
    model: "",
    color: "",
    year: "",
    mileage: "",
  });
  const [saving, setSaving] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  async function doSearch(plate: string) {
    if (!plate.trim()) {
      setSearchResults(null);
      setShowNewForm(false);
      return;
    }
    setSearching(true);
    setShowNewForm(false);
    const supabase = createClient();
    const { data } = await supabase
      .from("vehicles")
      .select("id, plate_number, brand, model, vin, color, year, mileage, customer_id, customers(id, name)")
      .ilike("plate_number", `%${plate.trim()}%`)
      .limit(5);
    const results = data || [];
    setSearchResults(results);
    setSearching(false);
    // 无结果时自动展开新建表单，并带入当前输入
    if (results.length === 0) {
      setShowNewForm(true);
      setNewVehicle((prev) => ({ ...prev, plate_number: plate.trim().toUpperCase() }));
    }
  }

  function handleInputChange(value: string) {
    setSearchPlate(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      doSearch(value);
    }, 300);
  }

  async function handleDirectLink(vehicleId: string) {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("vehicles").update({ customer_id: customerId }).eq("id", vehicleId);
    if (error) {
      alert("关联车辆失败: " + error.message);
      setSaving(false);
      return;
    }
    setSearchPlate("");
    setSearchResults(null);
    window.location.reload();
  }

  async function handleTransfer(vehicleId: string) {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("vehicles").update({ customer_id: customerId }).eq("id", vehicleId);
    if (error) {
      alert("变更车主失败: " + error.message);
      setSaving(false);
      return;
    }
    setTransferVehicle(null);
    setSearchPlate("");
    setSearchResults(null);
    window.location.reload();
  }

  async function handleCreateVehicle() {
    if (!newVehicle.plate_number.trim()) {
      alert("请填写车牌号");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("vehicles").insert({
      customer_id: customerId,
      plate_number: newVehicle.plate_number.trim(),
      vin: newVehicle.vin.trim() || null,
      brand: newVehicle.brand.trim() || null,
      model: newVehicle.model.trim() || null,
      color: newVehicle.color.trim() || null,
      year: newVehicle.year ? parseInt(newVehicle.year) : null,
      mileage: newVehicle.mileage ? parseInt(newVehicle.mileage) : null,
    });
    if (error) {
      alert("创建车辆失败: " + error.message);
      setSaving(false);
      return;
    }
    setShowNewForm(false);
    setNewVehicle({ plate_number: "", vin: "", brand: "", model: "", color: "", year: "", mileage: "" });
    window.location.reload();
  }

  return (
    <div>
      {/* 搜索栏 */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="输入车牌号逐字搜索车辆"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchPlate}
          onChange={(e) => handleInputChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            setShowNewForm(true);
            setSearchResults(null);
            setNewVehicle({ plate_number: "", vin: "", brand: "", model: "", color: "", year: "", mileage: "" });
          }}
          className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
        >
          + 新建车辆
        </button>
      </div>

      {/* 搜索结果 */}
      {searchResults && searchResults.length > 0 && (
        <div className="mb-4 bg-gray-50 rounded-lg p-3">
          <p className="text-sm font-medium text-gray-700 mb-2">搜索结果：</p>
          <div className="space-y-2">
            {searchResults.map((v) => (
              <div key={v.id} className="flex items-center justify-between p-2 bg-white rounded border border-gray-200">
                <div className="text-sm">
                  <span className="font-medium text-gray-900">{v.plate_number}</span>
                  <span className="text-gray-500 ml-2">{v.brand || ""} {v.model || ""}</span>
                  {v.customers?.name ? (
                    <span className="text-gray-500 ml-2">车主：{v.customers.name}</span>
                  ) : (
                    <span className="text-gray-400 ml-2">暂无车主</span>
                  )}
                </div>
                {v.customer_id === customerId ? (
                  <span className="text-xs text-green-600">已属于当前客户</span>
                ) : !v.customer_id ? (
                  <button
                    type="button"
                    onClick={() => handleDirectLink(v.id)}
                    disabled={saving}
                    className="px-3 py-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50"
                  >
                    关联此车
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTransferVehicle(v)}
                    className="px-3 py-1 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                  >
                    变更车主
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 新建车辆表单 */}
      {showNewForm && (
        <div className="mb-4 bg-gray-50 rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">{searchResults && searchResults.length === 0 ? "系统中无此车辆，新建并关联" : "新建车辆并关联当前客户"}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">车牌号 *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={newVehicle.plate_number}
                  onChange={(e) => setNewVehicle({ ...newVehicle, plate_number: e.target.value.toUpperCase() })}
                />
                <LicensePlateOcrButton
                  onRecognize={(plate) => setNewVehicle((prev) => ({ ...prev, plate_number: plate }))}
                  className="px-2 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">VIN 码</label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={newVehicle.vin}
                onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">品牌</label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={newVehicle.brand}
                onChange={(e) => setNewVehicle({ ...newVehicle, brand: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">型号</label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={newVehicle.model}
                onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">颜色</label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={newVehicle.color}
                onChange={(e) => setNewVehicle({ ...newVehicle, color: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">年份</label>
              <input
                type="number"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={newVehicle.year}
                onChange={(e) => setNewVehicle({ ...newVehicle, year: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">里程</label>
              <input
                type="number"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={newVehicle.mileage}
                onChange={(e) => setNewVehicle({ ...newVehicle, mileage: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleCreateVehicle}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存并关联"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewForm(false);
                if (searchResults && searchResults.length === 0) {
                  setSearchResults(null);
                }
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 关联车辆列表 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">关联车辆</h2>
      </div>
      {vehicles.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">车牌号</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">品牌</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">型号</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">VIN</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">颜色</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">年份</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">里程</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vehicles.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{v.plate_number}</td>
                  <td className="px-4 py-3 text-gray-600">{v.brand || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{v.model || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{v.vin || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{v.color || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{v.year ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{v.mileage != null ? v.mileage.toLocaleString() : "-"}</td>
                  <td className="px-4 py-3">
                    <Link href={`/vehicles/${v.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-400">暂无关联车辆</p>
      )}

      {/* 变更车主确认弹窗 */}
      {transferVehicle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">变更车主确认</h3>
            <p className="text-sm text-gray-600 mb-4">
              车辆 <span className="font-medium">{transferVehicle.plate_number}</span>
              {transferVehicle.brand || transferVehicle.model ? `（${transferVehicle.brand || ""} ${transferVehicle.model || ""}）` : ""}
              当前车主为 <span className="font-medium">{transferVehicle.customers?.name || "未知"}</span>。
              确认将其车主变更为当前客户吗？
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setTransferVehicle(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleTransfer(transferVehicle.id)}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "处理中..." : "确认变更"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
