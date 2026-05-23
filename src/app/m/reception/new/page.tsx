"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MobilePageHeader } from "@/components/mobile/MobilePageHeader";
import { useMobileToast } from "@/components/mobile/MobileToast";
import { ImageUploader } from "@/components/ImageUploader";
import VinDecodeInput from "@/components/VinDecodeInput";
import LicensePlateOcrButton from "@/components/LicensePlateOcrButton";
import LicensePlateKeyboard from "@/components/LicensePlateKeyboard";

/* ============================================================
   接车登记 — 手机端新建工单（一步提交）
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
  customers: Customer | Customer[] | null;
}

function getVehicleCustomer(v: Vehicle | null): Customer | null {
  if (!v || !v.customers) return null;
  return Array.isArray(v.customers) ? v.customers[0] : v.customers;
}

export default function MobileReceptionNewPage() {
  const router = useRouter();
  const supabase = createClient();
  const { showToast } = useMobileToast();

  /* ---------- 车辆 ---------- */
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [vehicleResults, setVehicleResults] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isNewVehicle, setIsNewVehicle] = useState(false);
  const [newPlate, setNewPlate] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newVin, setNewVin] = useState("");
  const vehicleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /* ---------- 客户 ---------- */
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  const customerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /* ---------- 送修人 ---------- */
  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");

  /* ---------- 接车检查 ---------- */
  const [mileage, setMileage] = useState("");
  const [dashboardPaths, setDashboardPaths] = useState<string[]>([]);

  /* ---------- 提交 ---------- */
  const [submitting, setSubmitting] = useState(false);

  /* ---------- 主管授权码 ---------- */
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [authVerifying, setAuthVerifying] = useState(false);
  const [pendingOrderNo, setPendingOrderNo] = useState("");

  /* ---------- 草稿恢复 ---------- */
  useEffect(() => {
    const draft = sessionStorage.getItem("reception-draft");
    if (draft) {
      try {
        const data = JSON.parse(draft);
        if (data.selectedVehicle) setSelectedVehicle(data.selectedVehicle);
        if (data.selectedCustomer) setSelectedCustomer(data.selectedCustomer);
        if (data.isNewVehicle !== undefined) setIsNewVehicle(data.isNewVehicle);
        if (data.newPlate !== undefined) setNewPlate(data.newPlate);
        if (data.newBrand !== undefined) setNewBrand(data.newBrand);
        if (data.newModel !== undefined) setNewModel(data.newModel);
        if (data.newVin !== undefined) setNewVin(data.newVin);
        if (data.isNewCustomer !== undefined) setIsNewCustomer(data.isNewCustomer);
        if (data.newCustomerName !== undefined) setNewCustomerName(data.newCustomerName);
        if (data.newCustomerPhone !== undefined) setNewCustomerPhone(data.newCustomerPhone);
        if (data.showCustomerSelect !== undefined) setShowCustomerSelect(data.showCustomerSelect);
        if (data.senderName !== undefined) setSenderName(data.senderName);
        if (data.senderPhone !== undefined) setSenderPhone(data.senderPhone);
        if (data.mileage !== undefined) setMileage(data.mileage);
        if (data.dashboardPaths !== undefined) setDashboardPaths(data.dashboardPaths);
      } catch {
        /* ignore */
      }
      sessionStorage.removeItem("reception-draft");
    }
  }, []);

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
     校验
     ============================================================ */
  function canSubmit() {
    if (isNewVehicle) {
      const hasCustomer = isNewCustomer
        ? newCustomerName.trim()
        : !!selectedCustomer;
      return newPlate.trim() && hasCustomer;
    }
    if (selectedVehicle) {
      const hasCustomer = isNewCustomer
        ? newCustomerName.trim()
        : !!(selectedCustomer || getVehicleCustomer(selectedVehicle));
      return hasCustomer;
    }
    return false;
  }

  /* ============================================================
     保存草稿到 sessionStorage
     ============================================================ */
  function saveDraft() {
    const draft = {
      selectedVehicle,
      selectedCustomer,
      isNewVehicle,
      newPlate,
      newBrand,
      newModel,
      newVin,
      isNewCustomer,
      newCustomerName,
      newCustomerPhone,
      showCustomerSelect,
      senderName,
      senderPhone,
      mileage,
      dashboardPaths,
    };
    sessionStorage.setItem("reception-draft", JSON.stringify(draft));
  }

  /* ============================================================
     检查是否有未完成工单
     ============================================================ */
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

  /* ============================================================
     验证主管授权码
     ============================================================ */
  async function verifySupervisorCode(code: string): Promise<boolean> {
    const { data } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "supervisor_code")
      .single();
    return data?.value === code.trim();
  }

  /* ============================================================
     提交接车
     ============================================================ */
  async function handleSubmit(skipDuplicateCheck = false) {
    if (!canSubmit()) return;
    setSubmitting(true);

    try {
      /* 重复开单检查 */
      const plate = isNewVehicle ? newPlate : selectedVehicle?.plate_number;
      if (!skipDuplicateCheck && plate) {
        const dup = await checkDuplicateWorkOrder(plate);
        if (dup.hasDuplicate) {
          setPendingOrderNo(dup.orderNo || "");
          setShowAuthDialog(true);
          setSubmitting(false);
          return;
        }
      }

      let vehicleId: string;
      let customerId: string;

      /* 1. 处理车辆 */
      if (isNewVehicle) {
        const { data: v, error: ve } = await supabase
          .from("vehicles")
          .insert({
            plate_number: newPlate.trim().toUpperCase(),
            brand: newBrand.trim() || null,
            model: newModel.trim() || null,
            vin: newVin.trim().toUpperCase() || null,
          })
          .select("id")
          .single();
        if (ve) throw new Error("创建车辆失败: " + ve.message);
        vehicleId = v.id;
      } else if (selectedVehicle) {
        vehicleId = selectedVehicle.id;
      } else {
        throw new Error("请选择或新建车辆");
      }

      /* 2. 处理客户 */
      if (isNewCustomer) {
        const { data: c, error: ce } = await supabase
          .from("customers")
          .insert({ name: newCustomerName.trim(), phone: newCustomerPhone.trim() || null })
          .select("id")
          .single();
        if (ce) throw new Error("创建客户失败: " + ce.message);
        customerId = c.id;
      } else if (selectedCustomer) {
        customerId = selectedCustomer.id;
      } else if (getVehicleCustomer(selectedVehicle)) {
        customerId = getVehicleCustomer(selectedVehicle)!.id;
      } else {
        throw new Error("请选择或新建客户");
      }

      /* 3. 关联车辆和客户 */
      const { error: linkErr } = await supabase
        .from("vehicles")
        .update({ customer_id: customerId })
        .eq("id", vehicleId);
      if (linkErr) throw new Error("关联车辆客户失败: " + linkErr.message);

      /* 4. 生成工单号 */
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const prefix = `WO${dateStr}`;
      const { data: last, error: lastErr } = await supabase
        .from("work_orders")
        .select("order_no")
        .ilike("order_no", `${prefix}%`)
        .order("order_no", { ascending: false })
        .limit(1);
      if (lastErr) throw new Error("生成工单号失败: " + lastErr.message);
      let seq = 1;
      if (last && last.length > 0 && last[0].order_no) {
        const suffix = last[0].order_no.slice(prefix.length);
        const num = parseInt(suffix, 10);
        if (!isNaN(num)) seq = num + 1;
      }
      const orderNo = `${prefix}${String(seq).padStart(3, "0")}`;

      /* 5. 创建工单 */
      const { data: order, error: oe } = await supabase
        .from("work_orders")
        .insert({
          order_no: orderNo,
          customer_id: customerId,
          vehicle_id: vehicleId,
          mileage_in: parseInt(mileage) || 0,
          customer_complaint: null,
          sender_name: senderName.trim() || null,
          sender_phone: senderPhone.trim() || null,
          status: "received",
        })
        .select("id")
        .single();
      if (oe) throw new Error("创建工单失败: " + oe.message);

      /* 6. 创建接车检查 */
      const { data: inspection, error: ie } = await supabase
        .from("work_order_inspections")
        .insert({
          work_order_id: order.id,
          inspection_type: "reception",
          inspection_mileage: parseInt(mileage) || null,
        })
        .select("id")
        .single();
      if (ie) throw new Error("创建接车检查失败: " + ie.message);

      /* 7. 保存里程表照片 */
      if (dashboardPaths.length > 0 && inspection) {
        const { error: me } = await supabase.from("work_order_inspection_media").insert(
          dashboardPaths.map((path) => ({
            inspection_id: inspection.id,
            media_type: "dashboard",
            storage_path: path,
          }))
        );
        if (me) throw new Error("保存里程表照片失败: " + me.message);
      }

      showToast("接车登记成功", "success");
      router.push(`/work-orders/${order.id}?newReq=1`);
      /* 成功跳转后保持 submitting=true，防止重复点击 */
      return;
    } catch (err: any) {
      console.error("接车提交异常:", err);
      showToast(err.message || "提交失败", "error");
      setSubmitting(false);
    }
  }

  /* ============================================================
     渲染
     ============================================================ */
  return (
    <div className="bg-gray-50">
      <MobilePageHeader title="新建接车登记" />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 车辆信息 */}
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
                        const vc = getVehicleCustomer(v as any);
                        if (vc) {
                          setSelectedCustomer(vc);
                          setShowCustomerSelect(false);
                        } else {
                          setSelectedCustomer(null);
                        }
                      }}
                    >
                      <div className="font-medium">{v.plate_number}</div>
                      <div className="text-gray-500 text-xs">{v.brand} {v.model} {v.vin && `· VIN:${v.vin}`}</div>
                      {getVehicleCustomer(v as any) ? (
                        <div className="text-blue-600 text-xs mt-0.5">车主: {getVehicleCustomer(v as any)!.name} · {getVehicleCustomer(v as any)!.phone}</div>
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
              {/* 车辆卡片 */}
              <div className="flex items-start justify-between bg-green-50 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{selectedVehicle.plate_number}</div>
                  <div className="text-xs text-gray-500">{selectedVehicle.brand} {selectedVehicle.model}</div>
                  {selectedVehicle.vin && <div className="text-xs text-gray-400">VIN: {selectedVehicle.vin}</div>}
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      saveDraft();
                      router.push(`/vehicles/${selectedVehicle.id}/edit?returnTo=/m/reception/new`);
                    }}
                    className="text-xs text-blue-600"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVehicle(null);
                      setSelectedCustomer(null);
                      setShowCustomerSelect(false);
                    }}
                    className="text-xs text-red-600"
                  >
                    更换
                  </button>
                </div>
              </div>

              {/* 关联客户 */}
              {getVehicleCustomer(selectedVehicle) && !showCustomerSelect && (
                <div className="flex items-start justify-between bg-blue-50 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{getVehicleCustomer(selectedVehicle)!.name}</div>
                    <div className="text-xs text-gray-500">{getVehicleCustomer(selectedVehicle)!.phone}</div>
                  </div>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        saveDraft();
                        router.push(`/customers/${getVehicleCustomer(selectedVehicle)!.id}/edit?returnTo=/m/reception/new`);
                      }}
                      className="text-xs text-blue-600"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCustomerSelect(true);
                        setSelectedCustomer(null);
                        setIsNewCustomer(false);
                      }}
                      className="text-xs text-red-600"
                    >
                      更换
                    </button>
                  </div>
                </div>
              )}

              {/* 车辆无关联客户提示 */}
              {selectedVehicle && !getVehicleCustomer(selectedVehicle) && !showCustomerSelect && (
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
        {(isNewVehicle || (selectedVehicle && (!getVehicleCustomer(selectedVehicle) || showCustomerSelect))) && (
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
                      const q = customerQuery.trim();
                      setIsNewCustomer(true);
                      if (/^\d{7,}$/.test(q)) {
                        setNewCustomerName("");
                        setNewCustomerPhone(q);
                      } else {
                        setNewCustomerName(q);
                        setNewCustomerPhone("");
                      }
                    }}
                    className="text-sm text-blue-600"
                  >
                    + 未找到，新建客户「{customerQuery}」
                  </button>
                )}
              </>
            )}

            {selectedCustomer && !isNewCustomer && (
              <div className="flex items-start justify-between bg-blue-50 rounded-lg px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{selectedCustomer.name}</div>
                  <div className="text-xs text-gray-500">{selectedCustomer.phone}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      saveDraft();
                      router.push(`/customers/${selectedCustomer.id}/edit?returnTo=/m/reception/new`);
                    }}
                    className="text-xs text-blue-600"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedCustomer(null); }}
                    className="text-xs text-red-600"
                  >
                    更换
                  </button>
                </div>
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

        {/* 本次送修人 */}
        {(selectedCustomer || (getVehicleCustomer(selectedVehicle) && !showCustomerSelect) || isNewCustomer) && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="text-sm font-medium text-gray-900">本次送修人</div>
            <input
              type="text"
              placeholder="送修人姓名"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
            />
            <input
              type="tel"
              placeholder="送修人电话"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={senderPhone}
              onChange={(e) => setSenderPhone(e.target.value)}
            />
          </div>
        )}

        {/* 接车检查 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="text-sm font-medium text-gray-900">接车检查</div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">当前里程 (km)</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="例如 52000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={mileage}
              onChange={(e) => setMileage(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">里程表拍照</label>
            <ImageUploader onUpload={setDashboardPaths} maxImages={3} />
          </div>
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="p-3 bg-white border-t border-gray-200 shrink-0">
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={!canSubmit() || submitting}
          className="w-full py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "提交中..." : "提交接车"}
        </button>
      </div>

      {/* 主管授权码弹窗 */}
      {showAuthDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
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
                onClick={() => { setShowAuthDialog(false); setAuthCode(""); setSubmitting(false); }}
                className="flex-1 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!authCode.trim()) {
                    showToast("请输入授权码", "error");
                    return;
                  }
                  setAuthVerifying(true);
                  const ok = await verifySupervisorCode(authCode);
                  if (ok) {
                    setShowAuthDialog(false);
                    setAuthCode("");
                    handleSubmit(true);
                  } else {
                    showToast("授权码错误", "error");
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
