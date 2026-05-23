"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import VinDecodeInput from "@/components/VinDecodeInput";
import LicensePlateKeyboard from "@/components/LicensePlateKeyboard";
import { CustomerSearchDropdown, Customer } from "@/components/CustomerSearchDropdown";

export default function NewWorkOrderPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");

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
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    company: "",
  });

  // 工单其他信息
  const [mileageIn, setMileageIn] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");

  // 主管授权码
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [authVerifying, setAuthVerifying] = useState(false);
  const [pendingOrderNo, setPendingOrderNo] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
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

  function handleSelectVehicle(v: any) {
    setSelectedVehicle(v);
    setVehicleQuery("");
    setShowVehicleResults(false);
    setIsNewVehicle(false);
    setMileageIn(v?.mileage ? String(v.mileage) : "");
  }

  function handleStartNewVehicle() {
    setIsNewVehicle(true);
    setSelectedVehicle(null);
    setShowVehicleResults(false);
    setMileageIn("");
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

  /* 检查是否有未完成工单 */
  async function checkDuplicateWorkOrder(plate: string) {
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id")
      .eq("plate_number", plate.trim().toUpperCase())
      .single();
    if (!vehicle) return { hasDuplicate: false };

    const { data: orders } = await supabase
      .from("work_orders")
      .select("id, order_no, status")
      .eq("vehicle_id", vehicle.id)
      .not("status", "in", "(settled,delivered)")
      .limit(1);

    if (orders && orders.length > 0) {
      return { hasDuplicate: true, orderNo: orders[0].order_no };
    }
    return { hasDuplicate: false };
  }

  /* 验证主管授权码 */
  async function verifySupervisorCode(code: string): Promise<boolean> {
    const { data } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "supervisor_code")
      .single();
    return data?.value === code.trim();
  }

  async function handleSubmit(e: React.FormEvent, skipDuplicateCheck = false) {
    e.preventDefault();

    if (!selectedVehicle && !isNewVehicle) {
      alert("请先搜索并选择车辆");
      return;
    }

    /* 重复开单检查 */
    const plate = isNewVehicle ? newVehicle.plate_number : selectedVehicle?.plate_number;
    if (!skipDuplicateCheck && plate) {
      const dup = await checkDuplicateWorkOrder(plate);
      if (dup.hasDuplicate) {
        setPendingOrderNo(dup.orderNo || "");
        setShowAuthDialog(true);
        return;
      }
    }

    let customerId = "";
    let vehicleId = "";

    try {
      // 场景1：已有车辆
      if (selectedVehicle) {
        vehicleId = selectedVehicle.id;
        customerId = selectedVehicle.customer_id || "";
      }

      // 场景2：新建车辆 — 先保存客户和车辆
      if (isNewVehicle) {
        if (!newVehicle.plate_number.trim()) {
          alert("请输入车牌号");
          return;
        }

        // 2a. 确保客户存在
        if (selectedCustomer) {
          customerId = selectedCustomer.id;
        } else if (isNewCustomer) {
          if (!newCustomer.name.trim()) {
            alert("请输入客户姓名");
            return;
          }
          const { data: cData, error: cError } = await supabase
            .from("customers")
            .insert({
              name: newCustomer.name.trim(),
              phone: newCustomer.phone.trim() || null,
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
            mileage: mileageIn ? parseInt(mileageIn) : null,
          })
          .select("id")
          .single();
        if (vError) throw new Error(vError.message);
        if (!vData?.id) throw new Error("创建车辆失败");
        vehicleId = vData.id;
      }

      setLoading(true);

      let mileageInNum = 0;
      if (mileageIn.trim()) {
        const parsed = parseInt(mileageIn, 10);
        mileageInNum = isNaN(parsed) ? 0 : parsed;
      }

      const { data: result, error: rpcErr } = await supabase.rpc(
        "create_work_order",
        {
          p_customer_id: customerId,
          p_vehicle_id: vehicleId,
          p_mileage_in: mileageInNum,
          p_fuel_level: 50,
          p_customer_complaint: "",
          p_inspection_notes: "",
          p_receptionist_id: currentUserId || null,
          p_requirements: [],
          p_sender_name: senderName.trim() || null,
          p_sender_phone: senderPhone.trim() || null,
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

  const customerInfo = selectedVehicle?.customers
    ? (Array.isArray(selectedVehicle.customers) ? selectedVehicle.customers[0] : selectedVehicle.customers)
    : null;

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
                <LicensePlateKeyboard
                  value={vehicleQuery}
                  onChange={(val) => {
                    setVehicleQuery(val);
                    setShowVehicleResults(true);
                  }}
                  placeholder="输入车牌号搜索，如：京A12345"
                  className="w-full"
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
                          {(() => {
                            const c = Array.isArray(v.customers) ? v.customers[0] : v.customers;
                            return `车主：${c?.name || "-"} ${c?.phone || ""}`;
                          })()}
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
                      setMileageIn("");
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
                  <VinDecodeInput
                    value={newVehicle.vin}
                    onChange={(v) => setNewVehicle({ ...newVehicle, vin: v })}
                    onDecode={(result) => {
                      if (!result) return;
                      setNewVehicle((prev) => ({
                        ...prev,
                        brand: result.brand || prev.brand,
                        model: result.series && result.model ? [...new Set([result.series, result.model])].join(" ") : prev.model,
                        vin: prev.vin,
                      }));
                    }}
                    inputClassName="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    buttonClassName="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                  />
                </div>
              </div>

              {/* 关联客户 */}
              <div className="border-t border-gray-100 pt-6">
                <h2 className="text-base font-semibold text-gray-900 mb-4">关联客户 *</h2>
                {!selectedCustomer && !isNewCustomer ? (
                  <CustomerSearchDropdown
                    onSelect={(c) => setSelectedCustomer(c)}
                    emptyRender={
                      <span>
                        未找到客户
                        <button
                          type="button"
                          onClick={() => setIsNewCustomer(true)}
                          className="ml-2 text-blue-600 hover:underline font-medium"
                        >
                          新建客户
                        </button>
                      </span>
                    }
                  />
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

          {/* 本次接车里程 */}
          {(selectedVehicle || isNewVehicle) && (
            <div className="border-t border-gray-100 pt-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">本次接车里程</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="w-48 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="请输入当前里程"
                  value={mileageIn}
                  onChange={(e) => setMileageIn(e.target.value)}
                />
                <span className="text-sm text-gray-500">km</span>
              </div>
            </div>
          )}

          {/* 送修人信息 */}
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">送修人信息</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">送修人姓名</label>
                <input
                  type="text"
                  placeholder="如非车主本人，请填写实际送修人"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">送修人电话</label>
                <input
                  type="text"
                  placeholder="送修人联系电话"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={senderPhone}
                  onChange={(e) => setSenderPhone(e.target.value)}
                />
              </div>
            </div>
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

      {/* 主管授权码弹窗 */}
      {showAuthDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">需要主管授权</div>
              <div className="text-sm text-gray-500 mt-1">
                该车牌已有未完成工单
                {pendingOrderNo && <span className="text-orange-600">（{pendingOrderNo}）</span>}
              </div>
              <div className="text-sm text-gray-500">请输入主管授权码继续开单</div>
            </div>
            <input
              type="password"
              inputMode="numeric"
              placeholder="请输入授权码"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value.replace(/\D/g, ""))}
              maxLength={6}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setShowAuthDialog(false); setAuthCode(""); }}
                className="flex-1 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!authCode.trim()) {
                    alert("请输入授权码");
                    return;
                  }
                  setAuthVerifying(true);
                  const ok = await verifySupervisorCode(authCode);
                  if (ok) {
                    setShowAuthDialog(false);
                    setAuthCode("");
                    /* 构造一个假的 submit event 以兼容 handleSubmit 签名 */
                    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
                    handleSubmit(fakeEvent, true);
                  } else {
                    alert("授权码错误");
                  }
                  setAuthVerifying(false);
                }}
                disabled={authVerifying}
                className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {authVerifying ? "验证中..." : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
