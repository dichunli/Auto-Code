"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface Customer {
  id: string;
  name: string;
  phone: string;
  company?: string;
}

interface Requirement {
  description: string;
  assigned_to: string;
}

export default function NewWorkOrderPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [mechanics, setMechanics] = useState<any[]>([]);

  // 车辆搜索
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [vehicleResults, setVehicleResults] = useState<any[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null);
  const [showVehicleResults, setShowVehicleResults] = useState(false);

  // 新建车辆
  const [isNewVehicle, setIsNewVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState({
    plate_number: "",
    brand: "",
    model: "",
    vin: "",
    mileage: "",
  });

  // 客户搜索（新建车辆时关联客户）
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    company: "",
  });

  // 工单其他信息
  const [requirements, setRequirements] = useState<Requirement[]>([
    { description: "", assigned_to: "" },
  ]);
  const [fuelLevel, setFuelLevel] = useState("50");
  const [inspectionNotes, setInspectionNotes] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => setMechanics(data || []));
  }, [supabase]);

  // 搜索车辆（含关联客户）
  const searchVehicles = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setVehicleResults([]);
        return;
      }
      const { data } = await supabase
        .from("vehicles")
        .select("id, plate_number, brand, model, vin, mileage, customer_id, customers(id, name, phone, company)")
        .ilike("plate_number", `%${query}%`)
        .limit(10);
      setVehicleResults(data || []);
    },
    [supabase]
  );

  useEffect(() => {
    const timer = setTimeout(() => searchVehicles(vehicleQuery), 300);
    return () => clearTimeout(timer);
  }, [vehicleQuery, searchVehicles]);

  // 搜索客户
  const searchCustomers = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setCustomerResults([]);
        return;
      }
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone, company")
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);
      setCustomerResults(data || []);
    },
    [supabase]
  );

  useEffect(() => {
    const timer = setTimeout(() => searchCustomers(customerQuery), 300);
    return () => clearTimeout(timer);
  }, [customerQuery, searchCustomers]);

  function handleSelectVehicle(v: any) {
    setSelectedVehicle(v);
    setVehicleQuery("");
    setShowVehicleResults(false);
    setIsNewVehicle(false);
  }

  function handleStartNewVehicle() {
    setIsNewVehicle(true);
    setSelectedVehicle(null);
    setShowVehicleResults(false);
    setNewVehicle({
      plate_number: vehicleQuery.trim(),
      brand: "",
      model: "",
      vin: "",
      mileage: "",
    });
    setSelectedCustomer(null);
    setIsNewCustomer(false);
    setNewCustomer({ name: "", phone: "", company: "" });
  }

  function addRequirement() {
    setRequirements([...requirements, { description: "", assigned_to: "" }]);
  }

  function updateRequirement(index: number, field: string, value: string) {
    const next = [...requirements];
    (next[index] as any)[field] = value;
    setRequirements(next);
  }

  function removeRequirement(index: number) {
    if (requirements.length <= 1) return;
    setRequirements(requirements.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedVehicle && !isNewVehicle) {
      alert("请先搜索并选择车辆");
      return;
    }

    let customerId = "";
    let vehicleId = "";

    try {
      // 场景1：已有车辆
      if (selectedVehicle) {
        vehicleId = selectedVehicle.id;
        customerId = selectedVehicle.customer_id;
      }

      // 场景2：新建车辆
      if (isNewVehicle) {
        if (!newVehicle.plate_number.trim()) {
          alert("请输入车牌号");
          return;
        }

        // 2a. 确保客户存在
        if (selectedCustomer) {
          customerId = selectedCustomer.id;
        } else if (isNewCustomer) {
          if (!newCustomer.name.trim() || !newCustomer.phone.trim()) {
            alert("请输入客户姓名和电话");
            return;
          }
          const { data: cData, error: cError } = await supabase
            .from("customers")
            .insert({
              name: newCustomer.name.trim(),
              phone: newCustomer.phone.trim(),
              company: newCustomer.company.trim() || null,
            })
            .select("id")
            .single();
          if (cError) throw new Error(cError.message);
          if (!cData?.id) throw new Error("创建客户失败");
          customerId = cData.id;
        } else {
          alert("请搜索并选择客户，或填写新客户信息");
          return;
        }

        // 2b. 创建车辆
        const { data: vData, error: vError } = await supabase
          .from("vehicles")
          .insert({
            customer_id: customerId,
            plate_number: newVehicle.plate_number.trim(),
            brand: newVehicle.brand.trim() || null,
            model: newVehicle.model.trim() || null,
            vin: newVehicle.vin.trim() || null,
            mileage: newVehicle.mileage ? parseInt(newVehicle.mileage) : null,
          })
          .select("id")
          .single();
        if (vError) throw new Error(vError.message);
        if (!vData?.id) throw new Error("创建车辆失败");
        vehicleId = vData.id;
      }

      setLoading(true);

      const reqPayload = requirements
        .filter((r) => r.description.trim())
        .map((r) => ({
          description: r.description.trim(),
          assigned_to: r.assigned_to || "",
        }));

      const mileageIn = isNewVehicle
        ? parseInt(newVehicle.mileage) || 0
        : selectedVehicle?.mileage || 0;

      const { data: result, error: rpcErr } = await supabase.rpc(
        "create_work_order",
        {
          p_customer_id: customerId,
          p_vehicle_id: vehicleId,
          p_mileage_in: mileageIn,
          p_fuel_level: parseInt(fuelLevel) || 50,
          p_customer_complaint: requirements.map((r) => r.description).join("; "),
          p_inspection_notes: inspectionNotes,
          p_receptionist_id: currentUserId || null,
          p_requirements: reqPayload,
        }
      );

      if (rpcErr) throw new Error(rpcErr.message);

      const rpcResult = result as {
        success: boolean;
        error?: string;
        order_id?: string;
      };
      if (!rpcResult?.success || !rpcResult.order_id) {
        throw new Error(rpcResult?.error || "创建工单失败");
      }

      router.push(`/work-orders/${rpcResult.order_id}`);
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
      setLoading(false);
    }
  }

  const customerInfo = selectedVehicle?.customers;

  return (
    <div>
      <PageHeader title="新建工单" description="搜索车辆并开单" />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl">
        <div className="space-y-6">
          {/* 车辆搜索 */}
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-4">搜索车辆 *</h2>
            {!selectedVehicle && !isNewVehicle ? (
              <div className="relative">
                <input
                  type="text"
                  placeholder="输入车牌号搜索，如：京A12345"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={vehicleQuery}
                  onChange={(e) => {
                    setVehicleQuery(e.target.value);
                    setShowVehicleResults(true);
                  }}
                  onFocus={() => setShowVehicleResults(true)}
                />
                {showVehicleResults && vehicleResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {vehicleResults.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => handleSelectVehicle(v)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <div className="text-sm font-medium text-gray-900">
                          {v.plate_number} {v.brand && v.model ? `(${v.brand} ${v.model})` : ""}
                        </div>
                        <div className="text-xs text-gray-500">
                          车主：{v.customers?.name || "-"} {v.customers?.phone || ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showVehicleResults && vehicleQuery && vehicleResults.length === 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-sm text-gray-500">
                    未找到该车辆
                    <button
                      type="button"
                      onClick={handleStartNewVehicle}
                      className="ml-2 text-blue-600 hover:underline font-medium"
                    >
                      新建车辆
                    </button>
                  </div>
                )}
              </div>
            ) : selectedVehicle ? (
              <div className="bg-blue-50 px-4 py-3 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-900">
                    {selectedVehicle.plate_number}
                    {selectedVehicle.brand && selectedVehicle.model
                      ? ` · ${selectedVehicle.brand} ${selectedVehicle.model}`
                      : ""}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVehicle(null);
                      setVehicleQuery("");
                    }}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    更换
                  </button>
                </div>
                {selectedVehicle.vin && (
                  <div className="text-xs text-gray-500">VIN：{selectedVehicle.vin}</div>
                )}
                {customerInfo && (
                  <div className="text-xs text-gray-500">
                    车主：{customerInfo.name} {customerInfo.phone}
                    {customerInfo.company ? ` · ${customerInfo.company}` : ""}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* 新建车辆 + 关联客户 */}
          {isNewVehicle && (
            <div className="border-t border-gray-100 pt-6 space-y-6">
              <h2 className="text-base font-semibold text-gray-900">新建车辆</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">车牌号 *</label>
                  <input
                    required
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={newVehicle.plate_number}
                    onChange={(e) => setNewVehicle({ ...newVehicle, plate_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
                  <input
                    type="text"
                    placeholder="如：大众"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={newVehicle.brand}
                    onChange={(e) => setNewVehicle({ ...newVehicle, brand: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">型号</label>
                  <input
                    type="text"
                    placeholder="如：迈腾"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={newVehicle.model}
                    onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">VIN 码</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={newVehicle.vin}
                    onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">当前里程</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={newVehicle.mileage}
                    onChange={(e) => setNewVehicle({ ...newVehicle, mileage: e.target.value })}
                  />
                </div>
              </div>

              {/* 关联客户 */}
              <div className="border-t border-gray-100 pt-6">
                <h2 className="text-base font-semibold text-gray-900 mb-4">关联客户 *</h2>
                {!selectedCustomer && !isNewCustomer ? (
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="搜索客户姓名或手机号"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={customerQuery}
                      onChange={(e) => {
                        setCustomerQuery(e.target.value);
                        setShowCustomerResults(true);
                      }}
                      onFocus={() => setShowCustomerResults(true)}
                    />
                    {showCustomerResults && customerResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {customerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(c);
                              setCustomerQuery("");
                              setShowCustomerResults(false);
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                          >
                            <div className="text-sm font-medium text-gray-900">{c.name}</div>
                            <div className="text-xs text-gray-500">
                              {c.phone} {c.company ? `· ${c.company}` : ""}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {showCustomerResults && customerQuery && customerResults.length === 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-sm text-gray-500">
                        未找到客户
                        <button
                          type="button"
                          onClick={() => {
                            setIsNewCustomer(true);
                            setShowCustomerResults(false);
                          }}
                          className="ml-2 text-blue-600 hover:underline font-medium"
                        >
                          新建客户
                        </button>
                      </div>
                    )}
                  </div>
                ) : selectedCustomer ? (
                  <div className="flex items-center justify-between bg-green-50 px-4 py-3 rounded-lg">
                    <div>
                      <span className="font-medium text-gray-900">{selectedCustomer.name}</span>
                      <span className="text-sm text-gray-500 ml-2">{selectedCustomer.phone}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setCustomerQuery("");
                        setIsNewCustomer(false);
                      }}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      更换
                    </button>
                  </div>
                ) : null}

                {/* 新建客户表单 */}
                {isNewCustomer && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">客户姓名 *</label>
                      <input
                        required
                        type="text"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={newCustomer.name}
                        onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">联系电话 *</label>
                      <input
                        required
                        type="tel"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={newCustomer.phone}
                        onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">所属单位</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={newCustomer.company}
                        onChange={(e) => setNewCustomer({ ...newCustomer, company: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <button
                        type="button"
                        onClick={() => {
                          setIsNewCustomer(false);
                          setNewCustomer({ name: "", phone: "", company: "" });
                        }}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        改为搜索已有客户
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 油量 */}
          <div className="border-t border-gray-100 pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">油量 ({fuelLevel}%)</label>
            <input
              type="range"
              min="0"
              max="100"
              className="w-full"
              value={fuelLevel}
              onChange={(e) => setFuelLevel(e.target.value)}
            />
          </div>

          {/* 客户需求 */}
          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">客户需求（逐条录入）</h2>
              <button type="button" onClick={addRequirement} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                + 添加需求
              </button>
            </div>
            <div className="space-y-3">
              {requirements.map((req, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-sm text-gray-500 pt-2 w-8">{i + 1}.</span>
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      placeholder="如：发动机异响、空调不冷..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={req.description}
                      onChange={(e) => updateRequirement(i, "description", e.target.value)}
                    />
                    <div className="flex gap-2">
                      <select
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        value={req.assigned_to}
                        onChange={(e) => updateRequirement(i, "assigned_to", e.target.value)}
                      >
                        <option value="">指派技师（可选）</option>
                        {mechanics.map((m) => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {requirements.length > 1 && (
                    <button type="button" onClick={() => removeRequirement(i)} className="text-sm text-red-500 hover:text-red-600 px-2 pt-2">
                      删除
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 初步检查 */}
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">初步检查记录</h2>
            <textarea
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={inspectionNotes}
              onChange={(e) => setInspectionNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            取消
          </button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? "保存中..." : "创建工单"}
          </button>
        </div>
      </form>
    </div>
  );
}
