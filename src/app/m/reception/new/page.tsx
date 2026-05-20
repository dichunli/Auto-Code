"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MobilePageHeader } from "@/components/mobile/MobilePageHeader";
import { useMobileToast } from "@/components/mobile/MobileToast";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import VinDecodeInput from "@/components/VinDecodeInput";
import LicensePlateOcrButton from "@/components/LicensePlateOcrButton";
import LicensePlateKeyboard from "@/components/LicensePlateKeyboard";

/* ============================================================
   接车登记 — 手机端新建工单（车辆优先）
   ============================================================ */

interface Customer {
  id: string;
  name: string;
  phone: string;
}

interface Vehicle {
  id: string;
  plate_number: string;
  brand: string;
  model: string;
  vin: string;
  customer_id: string | null;
  customers: Customer[] | null;
}

interface ServiceItem {
  id: string;
  name: string;
}

interface AddedPart {
  id: string;
  part_number: string;
  oe_number: string | null;
  name: string;
  quantity: number;
  unit_price: number | null;
}

export default function MobileReceptionNewPage() {
  const router = useRouter();
  const supabase = createClient();
  const { showToast } = useMobileToast();

  /* ---------- 步骤 ---------- */
  const [step, setStep] = useState(1);

  /* ---------- 步骤1：车辆 ---------- */
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [vehicleResults, setVehicleResults] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isNewVehicle, setIsNewVehicle] = useState(false);
  const [newPlate, setNewPlate] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newVin, setNewVin] = useState("");
  const vehicleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /* ---------- 步骤1：客户 ---------- */
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  const customerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /* ---------- 步骤2：工单信息 ---------- */
  const [mileage, setMileage] = useState("");
  const [fuelLevel, setFuelLevel] = useState(50);
  const [complaint, setComplaint] = useState("");

  /* ---------- 步骤2：维修项目 ---------- */
  const [serviceQuery, setServiceQuery] = useState("");
  const [serviceResults, setServiceResults] = useState<ServiceItem[]>([]);
  const [addedServices, setAddedServices] = useState<ServiceItem[]>([]);
  const serviceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /* ---------- 步骤2：配件 ---------- */
  const [addedParts, setAddedParts] = useState<AddedPart[]>([]);

  /* ---------- 提交 ---------- */
  const [submitting, setSubmitting] = useState(false);

  /* ============================================================
     车辆搜索
     ============================================================ */
  useEffect(() => {
    if (vehicleTimeoutRef.current) clearTimeout(vehicleTimeoutRef.current);
    const q = vehicleQuery.trim();
    if (!q) {
      setVehicleResults([]);
      return;
    }
    vehicleTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, plate_number, brand, model, vin, customer_id, customers(id, name, phone)")
        .ilike("plate_number", `%${q}%`)
        .limit(8);
      setVehicleResults((data || []) as Vehicle[]);
    }, 300);
    return () => {
      if (vehicleTimeoutRef.current) clearTimeout(vehicleTimeoutRef.current);
    };
  }, [vehicleQuery, supabase]);

  /* ============================================================
     客户搜索
     ============================================================ */
  useEffect(() => {
    if (customerTimeoutRef.current) clearTimeout(customerTimeoutRef.current);
    const q = customerQuery.trim();
    if (!q) {
      setCustomerResults([]);
      return;
    }
    customerTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone")
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(8);
      setCustomerResults(data || []);
    }, 300);
    return () => {
      if (customerTimeoutRef.current) clearTimeout(customerTimeoutRef.current);
    };
  }, [customerQuery, supabase]);

  /* ============================================================
     维修项目搜索
     ============================================================ */
  useEffect(() => {
    if (serviceTimeoutRef.current) clearTimeout(serviceTimeoutRef.current);
    const q = serviceQuery.trim();
    if (!q) {
      setServiceResults([]);
      return;
    }
    serviceTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("service_names")
        .select("id, name")
        .ilike("name", `%${q}%`)
        .limit(8);
      setServiceResults(data || []);
    }, 300);
    return () => {
      if (serviceTimeoutRef.current) clearTimeout(serviceTimeoutRef.current);
    };
  }, [serviceQuery, supabase]);

  /* ============================================================
     步骤校验
     ============================================================ */
  function canNextStep() {
    if (step === 1) {
      if (isNewVehicle) {
        const hasCustomer = isNewCustomer
          ? (newCustomerName.trim() && newCustomerPhone.trim())
          : !!selectedCustomer;
        return newPlate.trim() && hasCustomer;
      }
      if (selectedVehicle) {
        if (selectedVehicle.customers?.[0] && !showCustomerSelect) {
          return true;
        }
        const hasCustomer = isNewCustomer
          ? (newCustomerName.trim() && newCustomerPhone.trim())
          : !!selectedCustomer;
        return hasCustomer;
      }
      return false;
    }
    if (step === 2) {
      return mileage.trim() && (addedServices.length > 0 || complaint.trim());
    }
    return true;
  }

  /* ============================================================
     步骤1 → 步骤2：先保存车辆和客户
     ============================================================ */
  async function handleNextStep() {
    if (step !== 1) {
      setStep((s) => s + 1);
      return;
    }

    if (!canNextStep()) return;
    setSubmitting(true);

    try {
      if (isNewVehicle) {
        /* 1. 创建/获取客户 */
        let customerId: string;
        let savedCustomer: Customer | null = null;

        if (isNewCustomer) {
          const { data: c, error: ce } = await supabase
            .from("customers")
            .insert({ name: newCustomerName.trim(), phone: newCustomerPhone.trim() })
            .select("id, name, phone")
            .single();
          if (ce) throw new Error("创建客户失败: " + ce.message);
          customerId = c.id;
          savedCustomer = c;
        } else if (selectedCustomer) {
          customerId = selectedCustomer.id;
        } else {
          throw new Error("请选择或新建客户");
        }

        /* 2. 创建车辆 */
        const { data: v, error: ve } = await supabase
          .from("vehicles")
          .insert({
            customer_id: customerId,
            plate_number: newPlate.trim().toUpperCase(),
            brand: newBrand.trim() || null,
            model: newModel.trim() || null,
            vin: newVin.trim().toUpperCase() || null,
          })
          .select("id, plate_number, brand, model, vin, customer_id, customers(id, name, phone)")
          .single();
        if (ve) throw new Error("创建车辆失败: " + ve.message);

        /* 3. 更新状态为已选车辆 */
        setSelectedVehicle(v as Vehicle);
        setIsNewVehicle(false);
        if (savedCustomer) {
          setSelectedCustomer(savedCustomer);
          setIsNewCustomer(false);
          setNewCustomerName("");
          setNewCustomerPhone("");
        }
        setNewPlate("");
        setNewBrand("");
        setNewModel("");
        setNewVin("");
      } else if (selectedVehicle) {
        /* 已有车辆，检查是否需要关联/更换客户 */
        if (!selectedVehicle.customers?.[0] || showCustomerSelect) {
          let customerId: string;
          let savedCustomer: Customer | null = null;

          if (isNewCustomer) {
            const { data: c, error: ce } = await supabase
              .from("customers")
              .insert({ name: newCustomerName.trim(), phone: newCustomerPhone.trim() })
              .select("id, name, phone")
              .single();
            if (ce) throw new Error("创建客户失败: " + ce.message);
            customerId = c.id;
            savedCustomer = c;
          } else if (selectedCustomer) {
            customerId = selectedCustomer.id;
          } else {
            throw new Error("请选择或新建客户");
          }

          /* 更新车辆的 customer_id */
          const { data: v, error: ve } = await supabase
            .from("vehicles")
            .update({ customer_id: customerId })
            .eq("id", selectedVehicle.id)
            .select("id, plate_number, brand, model, vin, customer_id, customers(id, name, phone)")
            .single();
          if (ve) throw new Error("更新车辆客户关联失败: " + ve.message);

          setSelectedVehicle(v as Vehicle);
          setShowCustomerSelect(false);
          if (savedCustomer) {
            setSelectedCustomer(savedCustomer);
            setIsNewCustomer(false);
            setNewCustomerName("");
            setNewCustomerPhone("");
          }
        }
      }

      setStep(2);
    } catch (err: any) {
      showToast(err.message || "保存失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  /* ============================================================
     提交（步骤3：只创建工单）
     ============================================================ */
  async function handleSubmit() {
    if (!canNextStep()) return;
    setSubmitting(true);

    try {
      if (!selectedVehicle || isNewVehicle) {
        throw new Error("车辆信息未保存，请返回第一步重新填写");
      }

      const vehicleId = selectedVehicle.id;
      const customerId = selectedCustomer?.id || selectedVehicle.customers?.[0]?.id;
      if (!customerId) {
        throw new Error("车辆未关联客户信息");
      }

      /* 3. 生成工单号 */
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const prefix = `WO${dateStr}`;
      const { data: last } = await supabase
        .from("work_orders")
        .select("order_no")
        .ilike("order_no", `${prefix}%`)
        .order("order_no", { ascending: false })
        .limit(1);
      let seq = 1;
      if (last && last.length > 0 && last[0].order_no) {
        const suffix = last[0].order_no.slice(prefix.length);
        const num = parseInt(suffix, 10);
        if (!isNaN(num)) seq = num + 1;
      }
      const orderNo = `${prefix}${String(seq).padStart(3, "0")}`;

      /* 4. 创建工单 */
      const { data: order, error: oe } = await supabase
        .from("work_orders")
        .insert({
          order_no: orderNo,
          customer_id: customerId,
          vehicle_id: vehicleId,
          mileage_in: parseInt(mileage) || 0,
          fuel_level: fuelLevel,
          customer_complaint: complaint.trim() || null,
          status: "pending_diagnosis",
        })
        .select("id")
        .single();
      if (oe) throw new Error("创建工单失败: " + oe.message);

      /* 5. 添加维修项目 */
      if (addedServices.length > 0 && order) {
        const { data: siLinks } = await supabase
          .from("service_items")
          .select("id, service_name_id, name, default_price")
          .in("service_name_id", addedServices.map((s) => s.id));

        if (siLinks && siLinks.length > 0) {
          await supabase.from("work_order_items").insert(
            siLinks.map((si: any) => ({
              work_order_id: order.id,
              service_item_id: si.id,
              name: si.name,
              unit_price: si.default_price || 0,
              quantity: 1,
            }))
          );
        }
      }

      /* 6. 添加配件 */
      if (addedParts.length > 0 && order) {
        for (const part of addedParts) {
          await supabase.from("work_order_item_parts").insert({
            work_order_id: order.id,
            part_id: part.id,
            part_name: part.name,
            quantity: part.quantity,
            unit_price: part.unit_price || 0,
          });
        }
      }

      showToast("接车登记成功", "success");
      router.push(`/m/reception`);
    } catch (err: any) {
      showToast(err.message || "提交失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  /* ============================================================
     渲染
     ============================================================ */
  return (
    <div className="flex flex-col h-full bg-gray-50">
      <MobilePageHeader title="新建接车登记" />

      {/* 步骤指示器 */}
      <div className="bg-white px-4 py-3 flex items-center gap-2 border-b border-gray-200 shrink-0">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
              step >= s ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
            }`}>
              {s}
            </div>
            <span className={`text-xs ${step >= s ? "text-blue-600" : "text-gray-400"}`}>
              {s === 1 ? "车辆客户" : s === 2 ? "需求项目" : "确认"}
            </span>
            {s < 3 && <div className="w-6 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* 表单区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {step === 1 && (
          <div className="space-y-4">
            {/* 车辆 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="text-sm font-medium text-gray-900">车辆信息</div>

              {!selectedVehicle && !isNewVehicle && (
                <>
                  <div className="flex gap-2">
                    <LicensePlateKeyboard
                      value={vehicleQuery}
                      onChange={(val) => setVehicleQuery(val)}
                      placeholder="输入车牌号搜索"
                      className="flex-1"
                    />
                    <LicensePlateOcrButton
                      onRecognize={(plate) => setVehicleQuery(plate)}
                      className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                    />
                  </div>
                  {vehicleResults.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      {vehicleResults.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                          onClick={() => {
                            setSelectedVehicle(v);
                            setVehicleQuery("");
                            setVehicleResults([]);
                            setShowCustomerSelect(false);
                            if (v.customers?.[0]) {
                              setSelectedCustomer(v.customers[0]);
                            } else {
                              setSelectedCustomer(null);
                            }
                          }}
                        >
                          <div className="font-medium">{v.plate_number}</div>
                          <div className="text-gray-500 text-xs">{v.brand} {v.model} {v.vin && `· VIN:${v.vin}`}</div>
                          {v.customers?.[0] ? (
                            <div className="text-blue-600 text-xs mt-0.5">车主: {v.customers[0].name} · {v.customers[0].phone}</div>
                          ) : (
                            <div className="text-orange-500 text-xs mt-0.5">未关联客户</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {vehicleQuery.trim() && vehicleResults.length === 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsNewVehicle(true);
                        setNewPlate(vehicleQuery);
                      }}
                      className="text-sm text-blue-600"
                    >
                      + 未找到，新建车辆「{vehicleQuery}」
                    </button>
                  )}
                </>
              )}

              {selectedVehicle && !isNewVehicle && (
                <div className="space-y-2">
                  {/* 车辆信息卡片 */}
                  <div className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{selectedVehicle.plate_number}</div>
                      <div className="text-xs text-gray-500">{selectedVehicle.brand} {selectedVehicle.model}</div>
                      {selectedVehicle.vin && <div className="text-xs text-gray-400">VIN: {selectedVehicle.vin}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVehicle(null);
                        setSelectedCustomer(null);
                        setShowCustomerSelect(false);
                      }}
                      className="text-xs text-red-600"
                    >
                      更换车辆
                    </button>
                  </div>

                  {/* 关联客户 */}
                  {selectedVehicle.customers?.[0] && !showCustomerSelect && (
                    <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">{selectedVehicle.customers[0].name}</div>
                        <div className="text-xs text-gray-500">{selectedVehicle.customers[0].phone}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomerSelect(true);
                          setSelectedCustomer(null);
                          setIsNewCustomer(false);
                        }}
                        className="text-xs text-red-600"
                      >
                        更换客户
                      </button>
                    </div>
                  )}

                  {/* 车辆无关联客户提示 */}
                  {selectedVehicle && !selectedVehicle.customers?.[0] && !showCustomerSelect && (
                    <div className="text-sm text-orange-600 bg-orange-50 rounded-lg px-3 py-2">
                      该车辆未关联客户，请选择或新建客户
                    </div>
                  )}
                </div>
              )}

              {isNewVehicle && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <LicensePlateKeyboard
                      value={newPlate}
                      onChange={(val) => setNewPlate(val)}
                      placeholder="车牌号 *"
                      className="flex-1"
                    />
                    <LicensePlateOcrButton
                      onRecognize={setNewPlate}
                      className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                    />
                  </div>
                  <VinDecodeInput
                    value={newVin}
                    onChange={setNewVin}
                    onDecode={(result) => {
                      if (result) {
                        setNewBrand(result.brand || "");
                        setNewModel((result.series || "") + (result.model ? " " + result.model : ""));
                      }
                    }}
                    placeholder="VIN码（17位）"
                    inputClassName="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    buttonClassName="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                  />
                  <input
                    type="text"
                    placeholder="品牌"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={newBrand}
                    onChange={(e) => setNewBrand(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="车型"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setIsNewVehicle(false);
                      setNewPlate("");
                      setNewBrand("");
                      setNewModel("");
                      setNewVin("");
                    }}
                    className="text-xs text-gray-500"
                  >
                    取消，重新搜索已有车辆
                  </button>
                </div>
              )}
            </div>

            {/* 客户（新建车辆、车辆无客户、或主动更换客户时显示） */}
            {(isNewVehicle || (selectedVehicle && (!selectedVehicle.customers?.[0] || showCustomerSelect))) && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="text-sm font-medium text-gray-900">客户信息</div>

                {!selectedCustomer && !isNewCustomer && (
                  <>
                    <input
                      type="text"
                      placeholder="搜索客户姓名或电话"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                    />
                    {customerResults.length > 0 && (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        {customerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                            onClick={() => {
                              setSelectedCustomer(c);
                              setCustomerQuery("");
                              setCustomerResults([]);
                              setShowCustomerSelect(false);
                            }}
                          >
                            <div className="font-medium">{c.name}</div>
                            <div className="text-gray-500 text-xs">{c.phone}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    {customerQuery.trim() && customerResults.length === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsNewCustomer(true);
                          setNewCustomerName(customerQuery);
                        }}
                        className="text-sm text-blue-600"
                      >
                        + 未找到，新建客户「{customerQuery}」
                      </button>
                    )}
                  </>
                )}

                {selectedCustomer && !isNewCustomer && (
                  <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{selectedCustomer.name}</div>
                      <div className="text-xs text-gray-500">{selectedCustomer.phone}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setSelectedCustomer(null); }}
                      className="text-xs text-red-600"
                    >
                      更换
                    </button>
                  </div>
                )}

                {isNewCustomer && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="客户姓名 *"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                    />
                    <input
                      type="tel"
                      placeholder="联系电话 *"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setIsNewCustomer(false);
                        setNewCustomerName("");
                        setNewCustomerPhone("");
                      }}
                      className="text-xs text-gray-500"
                    >
                      取消，重新搜索已有客户
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* 里程 & 油量 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="text-sm font-medium text-gray-900">车辆状态</div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">当前里程 (km) *</label>
                <input
                  type="number"
                  placeholder="例如 52000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">油量: {fuelLevel}%</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={fuelLevel}
                  onChange={(e) => setFuelLevel(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>空</span>
                  <span>满</span>
                </div>
              </div>
            </div>

            {/* 客户需求 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="text-sm font-medium text-gray-900">客户需求</div>
              <textarea
                placeholder="描述客户反映的问题或需求..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
              />
            </div>

            {/* 维修项目 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="text-sm font-medium text-gray-900">维修项目</div>
              <input
                type="text"
                placeholder="搜索维修项目名称"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={serviceQuery}
                onChange={(e) => setServiceQuery(e.target.value)}
              />
              {serviceResults.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {serviceResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                      onClick={() => {
                        if (!addedServices.find((x) => x.id === s.id)) {
                          setAddedServices((prev) => [...prev, s]);
                        }
                        setServiceQuery("");
                        setServiceResults([]);
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              {addedServices.length > 0 && (
                <div className="space-y-2">
                  {addedServices.map((s, idx) => (
                    <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-sm">{s.name}</span>
                      <button
                        type="button"
                        onClick={() => setAddedServices((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-xs text-red-600"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 配件 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="text-sm font-medium text-gray-900">所需配件</div>
              <PartSearchDropdown
                value=""
                onChange={() => {}}
                onSelect={(part) => {
                  if (!addedParts.find((p) => p.id === part.id)) {
                    setAddedParts((prev) => [
                      ...prev,
                      {
                        id: part.id,
                        part_number: part.part_number || "",
                        oe_number: part.oe_number || null,
                        name: part.name || part.part_names?.name || "",
                        quantity: 1,
                        unit_price: part.unit_price,
                      },
                    ]);
                  }
                }}
                onCreateNew={() => {}}
                placeholder="搜索配件编号或名称"
                inputClassName="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {addedParts.length > 0 && (
                <div className="space-y-2">
                  {addedParts.map((p, idx) => (
                    <div key={p.id} className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{p.name}</span>
                        <button
                          type="button"
                          onClick={() => setAddedParts((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-xs text-red-600"
                        >
                          删除
                        </button>
                      </div>
                      <div className="text-xs text-gray-500">编号: {p.part_number || "-"} {p.oe_number && `· OE: ${p.oe_number}`}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">数量:</span>
                        <input
                          type="number"
                          min={1}
                          value={p.quantity}
                          onChange={(e) => {
                            const q = parseInt(e.target.value) || 1;
                            setAddedParts((prev) =>
                              prev.map((pp, i) => (i === idx ? { ...pp, quantity: q } : pp))
                            );
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="text-sm font-medium text-gray-900">信息确认</div>

              <div className="text-sm">
                <span className="text-gray-500">车辆: </span>
                {isNewVehicle ? newPlate : selectedVehicle?.plate_number}
              </div>
              {(!isNewVehicle && selectedVehicle) && (
                <>
                  {selectedVehicle.brand && (
                    <div className="text-sm"><span className="text-gray-500">品牌: </span>{selectedVehicle.brand} {selectedVehicle.model}</div>
                  )}
                  {selectedVehicle.vin && (
                    <div className="text-sm"><span className="text-gray-500">VIN: </span>{selectedVehicle.vin}</div>
                  )}
                </>
              )}
              <div className="text-sm">
                <span className="text-gray-500">客户: </span>
                {isNewCustomer ? newCustomerName : (selectedCustomer?.name || selectedVehicle?.customers?.[0]?.name)}
              </div>
              <div className="text-sm">
                <span className="text-gray-500">里程: </span>
                {mileage} km
              </div>
              <div className="text-sm">
                <span className="text-gray-500">油量: </span>
                {fuelLevel}%
              </div>
              {complaint && (
                <div className="text-sm">
                  <span className="text-gray-500">需求: </span>
                  {complaint}
                </div>
              )}
              {addedServices.length > 0 && (
                <div className="text-sm">
                  <span className="text-gray-500">维修项目 ({addedServices.length}项): </span>
                  {addedServices.map((s) => s.name).join("、")}
                </div>
              )}
              {addedParts.length > 0 && (
                <div className="text-sm">
                  <span className="text-gray-500">配件 ({addedParts.length}项): </span>
                  {addedParts.map((p) => `${p.name}x${p.quantity}`).join("、")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="p-3 bg-white border-t border-gray-200 shrink-0 flex items-center gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="px-4 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg"
          >
            上一步
          </button>
        )}
        {step < 3 ? (
          <button
            type="button"
            onClick={handleNextStep}
            disabled={!canNextStep() || submitting}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "保存中..." : "下一步"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "提交中..." : "确认提交"}
          </button>
        )}
      </div>
    </div>
  );
}
