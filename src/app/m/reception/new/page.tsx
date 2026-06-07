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
import { StarDisplay, TagDisplay } from "@/components/CustomerSearchDropdown";
import { 标准化VIN } from "@/lib/vinValidator";
import { VehicleModelDetail } from "@/components/VehicleModelSearch";

/* ============================================================
   接车登记 — 手机端新建工单（一步提交）
   ============================================================ */

interface CustomerTag {
  id: string;
  name: string;
  color: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  star_level?: number;
  customer_tags?: { tags: CustomerTag | CustomerTag[] }[] | null;
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
  const [autoOpenVinCamera, setAutoOpenVinCamera] = useState(false);
  const [newVehicleModelId, setNewVehicleModelId] = useState<number | null>(null);
  const [newEngineNo, setNewEngineNo] = useState("");
  const [newChassisCode, setNewChassisCode] = useState("");
  const [newTransmissionType, setNewTransmissionType] = useState("");
  const [newTransmissionCode, setNewTransmissionCode] = useState("");
  const [newYear, setNewYear] = useState("");
  const [vehicleModelDetail, setVehicleModelDetail] = useState<{ id: number; 排量: string | null } | null>(null);
  const [showModelDetail, setShowModelDetail] = useState(false);
  const [modelDetailData, setModelDetailData] = useState<VehicleModelDetail | null>(null);
  const [modelDetailLoading, setModelDetailLoading] = useState(false);
  const [vinSearchKeyword, setVinSearchKeyword] = useState("");
  const vehicleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /* ---------- VIN 查重 ---------- */
  const [vinDuplicateVehicle, setVinDuplicateVehicle] = useState<Vehicle | null>(null);
  const [showVinDuplicateDialog, setShowVinDuplicateDialog] = useState(false);
  const [showChangeOwnerDialog, setShowChangeOwnerDialog] = useState(false);
  const vinCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /* ---------- 车辆关联工单统计 ---------- */
  const [vehicleOrderStats, setVehicleOrderStats] = useState<{
    active: number;
    quotes: number;
    cancelled: number;
    appointments: number;
  } | null>(null);

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
        .select("id, plate_number, brand, model, vin, customer_id, customers(id, name, phone, star_level, customer_tags(tags(id, name, color)))")
        .ilike("plate_number", `%${q}%`)
        .limit(8);
      setVehicleResults((data || []) as unknown as Vehicle[]);
    }, 300);
    return () => {
      if (vehicleTimeoutRef.current) clearTimeout(vehicleTimeoutRef.current);
    };
  }, [vehicleQuery, supabase]);

  /* ============================================================
     选中车辆后加载关联工单统计
     ============================================================ */
  useEffect(() => {
    if (!selectedVehicle) {
      setVehicleOrderStats(null);
      return;
    }
    const vehicleId = selectedVehicle.id;
    async function load() {
      const { data } = await supabase
        .from("work_orders")
        .select("id, order_no, status, order_type")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false });
      if (data) {
        const active = data.filter(
          (o) => o.order_type === "normal" && !["settled", "delivered"].includes(o.status)
        ).length;
        const quotes = data.filter((o) => o.order_type === "quote").length;
        const cancelled = data.filter((o) => o.order_type === "cancelled").length;
        const appointments = data.filter((o) => o.order_type === "appointment").length;
        setVehicleOrderStats({ active, quotes, cancelled, appointments });
      }
    }
    load();
  }, [selectedVehicle, supabase]);

  /* ============================================================
     VIN 查重（新建车辆时）
     ============================================================ */
  useEffect(() => {
    if (vinCheckTimeoutRef.current) clearTimeout(vinCheckTimeoutRef.current);

    const vin = 标准化VIN(newVin);
    if (!isNewVehicle || vin.length !== 17) {
      setVinDuplicateVehicle(null);
      setShowVinDuplicateDialog(false);
      return;
    }

    vinCheckTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, plate_number, brand, model, vin, customer_id, customers(id, name, phone, star_level, customer_tags(tags(id, name, color)))")
        .eq("vin", vin)
        .maybeSingle();

      if (data) {
        setVinDuplicateVehicle(data as unknown as Vehicle);
        setShowVinDuplicateDialog(true);
      }
    }, 500);

    return () => {
      if (vinCheckTimeoutRef.current) clearTimeout(vinCheckTimeoutRef.current);
    };
  }, [newVin, isNewVehicle, supabase]);

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
        .select("id, name, phone, star_level, customer_tags(tags(id, name, color))")
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
     车牌格式校验（中国车牌）
     ============================================================ */
  function isValidPlate(plate: string): boolean {
    const p = plate.trim().toUpperCase();
    if (!p || p.length < 7 || p.length > 8) return false;
    const provinces = "京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领";
    if (!provinces.includes(p[0])) return false;
    if (!/[A-Z]/.test(p[1])) return false;
    return true;
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

    const timeoutId = setTimeout(() => {
      showToast("提交超时，请检查网络连接后重试", "error");
      setSubmitting(false);
    }, 15000);

    try {
      /* 重复开单检查 */
      const plate = isNewVehicle ? newPlate : selectedVehicle?.plate_number;
      if (!skipDuplicateCheck && plate) {
        const dup = await checkDuplicateWorkOrder(plate);
        if (dup.hasDuplicate) {
          clearTimeout(timeoutId);
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
            vin: 标准化VIN(newVin) || null,
            vehicle_model_id: newVehicleModelId,
            engine_no: newEngineNo.trim() || null,
            chassis_code: newChassisCode.trim() || null,
            transmission_type: newTransmissionType.trim() || null,
            transmission_code: newTransmissionCode.trim() || null,
            year: newYear ? parseInt(newYear) : null,
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

      clearTimeout(timeoutId);
      showToast("接车登记成功", "success");
      /* 移动端某些环境（PWA/WebView）下 router.push 不可靠，使用硬跳转 */
      window.location.href = `/work-orders/${order.id}?newReq=1`;
      return;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      console.error("接车提交异常:", err);
      showToast(err instanceof Error ? err.message : "提交失败", "error");
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
                  onRecognize={async (plate) => {
                    const upperPlate = plate.trim().toUpperCase();
                    /* 先搜索系统中是否已有该车辆 */
                    const { data } = await supabase
                      .from("vehicles")
                      .select("id, plate_number, brand, model, vin, customer_id, customers(id, name, phone, star_level, customer_tags(tags(id, name, color)))")
                      .eq("plate_number", upperPlate)
                      .maybeSingle();

                    if (data) {
                      /* 已有车辆，直接选中 */
                      const v = data as unknown as Vehicle;
                      setSelectedVehicle(v);
                      setVehicleQuery("");
                      setVehicleResults([]);
                      setShowCustomerSelect(false);
                      const vc = getVehicleCustomer(v);
                      if (vc) {
                        setSelectedCustomer(vc);
                        setShowCustomerSelect(false);
                      } else {
                        setSelectedCustomer(null);
                      }
                      showToast("已选中已有车辆", "success");
                    } else {
                      /* 没有该车辆，直接进入新建 */
                      if (!isValidPlate(upperPlate)) {
                        alert("车牌格式不正确，请检查");
                        setVehicleQuery(upperPlate);
                        return;
                      }
                      setIsNewVehicle(true);
                      setNewPlate(upperPlate);
                      setAutoOpenVinCamera(true);
                      showToast("车牌识别成功，请继续完善车辆信息", "success");
                    }
                  }}
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
                        const vc = getVehicleCustomer(v);
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
                      {(() => {
                        const vc = getVehicleCustomer(v);
                        return vc ? (
                          <div className="text-xs mt-0.5">
                            <div className="flex items-center gap-1 text-blue-600">
                              <span>车主: {vc.name} · {vc.phone}</span>
                              <StarDisplay level={vc.star_level} />
                            </div>
                            <TagDisplay tags={vc.customer_tags} />
                          </div>
                        ) : (
                          <div className="text-orange-500 text-xs mt-0.5">未关联客户</div>
                        );
                      })()}
                    </button>
                  ))}
                </div>
              )}
              {vehicleQuery.trim() && vehicleResults.length === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const plate = vehicleQuery.trim().toUpperCase();
                    if (!isValidPlate(plate)) {
                      alert("车牌格式不正确，请检查");
                      return;
                    }
                    setIsNewVehicle(true);
                    setNewPlate(plate);
                    setAutoOpenVinCamera(true);
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

              {/* 车辆关联工单统计 */}
              {vehicleOrderStats && (
                <div className="flex flex-wrap gap-2"
                >
                  <button
                    type="button"
                    onClick={() => router.push(`/work-orders?type=normal&keyword=${encodeURIComponent(selectedVehicle.plate_number)}`)}
                    className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border bg-orange-50 text-orange-700 border-orange-200"
                  >
                    在修工单（{vehicleOrderStats.active}）
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(`/work-orders?type=quote&keyword=${encodeURIComponent(selectedVehicle.plate_number)}`)}
                    className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border bg-purple-50 text-purple-700 border-purple-200"
                  >
                    历史报价单（{vehicleOrderStats.quotes}）
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(`/work-orders?type=cancelled&keyword=${encodeURIComponent(selectedVehicle.plate_number)}`)}
                    className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border bg-gray-50 text-gray-700 border-gray-200"
                  >
                    作废工单（{vehicleOrderStats.cancelled}）
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(`/work-orders?type=appointment&keyword=${encodeURIComponent(selectedVehicle.plate_number)}`)}
                    className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200"
                  >
                    预约工单（{vehicleOrderStats.appointments}）
                  </button>
                </div>
              )}

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
              {/* 车牌号 — 只读，已识别 */}
              <div className="flex gap-2">
                <LicensePlateKeyboard
                  value={newPlate}
                  onChange={(val) => setNewPlate(val)}
                  placeholder="车牌号 *"
                  className="flex-1"
                  readOnly
                />
              </div>

              {/* VIN 输入 */}
              <VinDecodeInput
                value={newVin}
                onChange={setNewVin}
                onRecognize={async (vin) => {
                  /* 1. 先查询系统中是否已有该 VIN 的车辆 */
                  const { data } = await supabase
                    .from("vehicles")
                    .select("id, plate_number, brand, model, vin, customer_id, customers(id, name, phone, star_level, customer_tags(tags(id, name, color)))")
                    .eq("vin", vin)
                    .maybeSingle();

                  if (data) {
                    /* 系统中有该VIN，显示重复询问弹窗（替换车牌/保留原车牌/取消） */
                    setVinDuplicateVehicle(data as unknown as Vehicle);
                    setShowVinDuplicateDialog(true);
                    setAutoOpenVinCamera(false); /* 防止再次自动触发拍照 */
                    return true;
                  }

                  /* 系统中没有，让 VinDecodeInput 打开编辑弹窗让用户确认修改 */
                  return false;
                }}
                onDecode={async (result) => {
                  if (!result) return;
                  /* 1. 填充VIN解析基本信息 */
                  const brand = result.brand || "";
                  const modelParts = [...new Set([result.series, result.model].filter(Boolean))];
                  const model = modelParts.join(" ");
                  setNewBrand(brand);
                  setNewModel(model);
                  setNewYear(result.year || "");
                  setNewEngineNo(result.engineNo || "");
                  setNewChassisCode(result.chassisCode || "");
                  setNewTransmissionType(result.transmissionType || "");
                  setNewTransmissionCode(result.transmissionCode || "");

                  /* 2. 自动匹配车型库 */
                  const searchTerms = [...new Set([result.brand, result.series, result.model].filter(Boolean))];
                  const keyword = searchTerms.join(" ");
                  if (!keyword) {
                    setNewVehicleModelId(null);
                    setVehicleModelDetail(null);
                    return;
                  }

                  try {
                    const { data } = await supabase
                      .from("vehicle_models")
                      .select("id,品牌,车系,车型,年款,排量,销售版本,底盘代号,发动机型号,变速箱类型,变速箱代号")
                      .ilike("搜索字段", `%${keyword}%`)
                      .limit(5);

                    if (data && data.length > 0) {
                      const m = data[0] as {
                        id: number;
                        品牌: string | null;
                        车系: string | null;
                        车型: string | null;
                        年款: number | null;
                        排量: string | null;
                        销售版本: string | null;
                        底盘代号: string | null;
                        发动机型号: string | null;
                        变速箱类型: string | null;
                        变速箱代号: string | null;
                      };
                      const matchedModelParts = [...new Set([m.车系, m.车型].filter(Boolean))];
                      setNewVehicleModelId(m.id);
                      setNewBrand(m.品牌 || brand);
                      setNewModel(matchedModelParts.join(" ") || m.品牌 || model);
                      setNewEngineNo(m.发动机型号 || result.engineNo || "");
                      setNewChassisCode(m.底盘代号 || result.chassisCode || "");
                      setNewTransmissionType(m.变速箱类型 || result.transmissionType || "");
                      setNewTransmissionCode(m.变速箱代号 || result.transmissionCode || "");
                      setVehicleModelDetail({ id: m.id, 排量: m.排量 || null });
                      /* 构造车型信息展示文本（去重） */
                      const displayParts = [...new Set([
                        m.年款 ? `${m.年款}款` : null,
                        m.品牌,
                        m.车系,
                        m.车型,
                        m.销售版本,
                        m.排量,
                        m.发动机型号,
                      ].filter(Boolean))];
                      setVinSearchKeyword(`${displayParts.join(" ")} [ID:${m.id}]`);
                    } else {
                      setNewVehicleModelId(null);
                      setVehicleModelDetail(null);
                      setVinSearchKeyword("");
                    }
                  } catch {
                    setNewVehicleModelId(null);
                    setVehicleModelDetail(null);
                    setVinSearchKeyword("");
                  }
                }}
                placeholder="VIN码（17位）"
                inputClassName="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                buttonClassName="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                autoOpenCamera={autoOpenVinCamera}
              />

              {/* 车型信息（从车型库选择） */}
              {vinSearchKeyword && (
                <div className="space-y-1.5">
                  <label className="block text-xs text-gray-500">车型信息（从车型库选择）</label>
                  <div className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-700">
                    {vinSearchKeyword}
                  </div>
                  {newVehicleModelId && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500">已关联车型:</span>
                      <span className="text-blue-600 font-medium">ID:{newVehicleModelId}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          setModelDetailLoading(true);
                          setShowModelDetail(true);
                          const { data } = await supabase
                            .from("vehicle_models")
                            .select("id,厂商,品牌,车系,车型,销售版本,年款,排量,发动机型号,燃油类型,进气形式,排放标准,功率,马力,驱动方式,变速箱类型,变速箱代号,档位数,底盘代号,车身类型,车身尺寸,轴距,整备质量,前轮胎规格,后轮胎规格,停产标志,厂商指导价,品牌图标")
                            .eq("id", newVehicleModelId)
                            .single();
                          setModelDetailData((data as unknown as VehicleModelDetail) || null);
                          setModelDetailLoading(false);
                        }}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        查看详情
                      </button>
                    </div>
                  )}
                  {vehicleModelDetail && (
                    <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-1.5">
                      车型ID: <span className="text-blue-600 font-medium">{vehicleModelDetail.id}</span>
                      {vehicleModelDetail.排量 && <span className="ml-3">排量: <span className="text-gray-700">{vehicleModelDetail.排量}</span></span>}
                    </div>
                  )}
                </div>
              )}

              {/* 手动编辑品牌和车型（收起在详情里） */}
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
                  setNewVehicleModelId(null);
                  setNewEngineNo("");
                  setNewChassisCode("");
                  setNewTransmissionType("");
                  setNewTransmissionCode("");
                  setNewYear("");
                  setVehicleModelDetail(null);
                  setVinSearchKeyword("");
                  setAutoOpenVinCamera(false);
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
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{c.name}</span>
                          <StarDisplay level={c.star_level} />
                        </div>
                        <div className="text-gray-500 text-xs">{c.phone}</div>
                        <TagDisplay tags={c.customer_tags} />
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
                  <div className="flex items-center gap-1">
                    <div className="text-sm font-medium">{selectedCustomer.name}</div>
                    <StarDisplay level={selectedCustomer.star_level} />
                  </div>
                  <div className="text-xs text-gray-500">{selectedCustomer.phone}</div>
                  <TagDisplay tags={selectedCustomer.customer_tags} />
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

      {/* VIN 重复车辆提示弹窗 */}
      {showVinDuplicateDialog && vinDuplicateVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">VIN 已存在</div>
              <div className="text-sm text-gray-500 mt-1">
                系统中已有该 VIN 码的车辆
              </div>
            </div>

            {/* 已有车辆信息 */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
              <div className="text-xs text-gray-400 mb-1">系统中现有车辆</div>
              <div className="font-medium text-gray-900">{vinDuplicateVehicle.plate_number}</div>
              <div className="text-gray-500">{vinDuplicateVehicle.brand} {vinDuplicateVehicle.model}</div>
              {getVehicleCustomer(vinDuplicateVehicle) && (
                <div className="text-blue-600 text-xs">
                  车主: {getVehicleCustomer(vinDuplicateVehicle)!.name} · {getVehicleCustomer(vinDuplicateVehicle)!.phone}
                </div>
              )}
            </div>

            {/* 新输入的车牌 */}
            {(() => {
              const newPlateClean = newPlate.trim().toUpperCase();
              const hasNewPlate = !!newPlateClean && newPlateClean !== vinDuplicateVehicle.plate_number;
              return (
                <>
                  {hasNewPlate && (
                    <div className="bg-orange-50 rounded-lg p-3 space-y-1 text-sm border border-orange-200">
                      <div className="text-xs text-orange-500 mb-1">您新输入的车牌</div>
                      <div className="font-medium text-orange-700">{newPlateClean}</div>
                    </div>
                  )}

                  <div className="text-sm text-gray-700 text-center">
                    {hasNewPlate
                      ? "新车牌与原车牌不一致，是否替换原车牌？"
                      : "该 VIN 已存在于系统中，直接选用该车辆。"}
                  </div>

                  <div className="flex flex-col gap-2">
                    {hasNewPlate && (
                      <button
                        type="button"
                        onClick={async () => {
                          /* 替换为新车牌：先校验 */
                          if (!isValidPlate(newPlateClean)) {
                            showToast("新车牌格式不正确，请检查", "error");
                            return;
                          }

                          const { error: updateErr } = await supabase
                            .from("vehicles")
                            .update({ plate_number: newPlateClean })
                            .eq("id", vinDuplicateVehicle.id);
                          if (updateErr) {
                            showToast("更新车牌失败: " + updateErr.message, "error");
                            return;
                          }

                          setShowVinDuplicateDialog(false);
                          setIsNewVehicle(false);
                          setNewPlate("");
                          setNewBrand("");
                          setNewModel("");
                          setNewVin("");
                          setSelectedVehicle({
                            ...vinDuplicateVehicle,
                            plate_number: newPlateClean,
                          });
                          setShowChangeOwnerDialog(true);
                        }}
                        className="w-full py-2.5 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700"
                      >
                        替换为新车牌并选用
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const v = vinDuplicateVehicle!;
                        setShowVinDuplicateDialog(false);
                        setVinDuplicateVehicle(null);
                        setIsNewVehicle(false);
                        setNewPlate("");
                        setNewBrand("");
                        setNewModel("");
                        setNewVin("");
                        setSelectedVehicle(v);
                        setShowChangeOwnerDialog(true);
                      }}
                      className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      {newPlate.trim().toUpperCase() && newPlate.trim().toUpperCase() !== vinDuplicateVehicle.plate_number
                        ? "保留原车牌，直接选用"
                        : "直接选用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowVinDuplicateDialog(false);
                        setVinDuplicateVehicle(null);
                        setNewVin("");
                      }}
                      className="w-full py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                    >
                      取消，重新输入
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* 是否变更车主弹窗 */}
      {showChangeOwnerDialog && vinDuplicateVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">是否变更车主？</div>
              <div className="text-sm text-gray-500 mt-1">
                该车辆当前车主：{getVehicleCustomer(vinDuplicateVehicle)?.name || "未关联车主"}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  /* 不变更车主：保留原有客户 */
                  const v = vinDuplicateVehicle;
                  const vc = getVehicleCustomer(v);
                  if (vc) {
                    setSelectedCustomer(vc);
                    setShowCustomerSelect(false);
                  } else {
                    setSelectedCustomer(null);
                    setShowCustomerSelect(true);
                  }
                  setShowChangeOwnerDialog(false);
                  setVinDuplicateVehicle(null);
                  showToast("已选用该车辆", "success");
                }}
                className="flex-1 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                不变更
              </button>
              <button
                type="button"
                onClick={() => {
                  /* 变更车主：清空已选客户，显示客户选择区域 */
                  setSelectedCustomer(null);
                  setShowCustomerSelect(true);
                  setShowChangeOwnerDialog(false);
                  setVinDuplicateVehicle(null);
                  showToast("请重新选择车主", "success");
                }}
                className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                变更车主
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 车型详情弹窗 */}
      {showModelDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <h3 className="text-base font-semibold text-gray-900">
                {modelDetailData ? `${modelDetailData.品牌} ${modelDetailData.车系} ${modelDetailData.车型}` : "车型详情"}
              </h3>
              <button
                type="button"
                onClick={() => { setShowModelDetail(false); setModelDetailData(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {modelDetailLoading ? (
                <div className="flex items-center justify-center gap-2 text-gray-500 py-8">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>加载中...</span>
                </div>
              ) : modelDetailData ? (
                <div className="space-y-3">
                  {[
                    { label: "ID", value: modelDetailData.id },
                    { label: "厂商", value: modelDetailData.厂商 },
                    { label: "品牌", value: modelDetailData.品牌 },
                    { label: "车系", value: modelDetailData.车系 },
                    { label: "车型", value: modelDetailData.车型 },
                    { label: "销售版本", value: modelDetailData.销售版本 },
                    { label: "年款", value: modelDetailData.年款 },
                    { label: "排量", value: modelDetailData.排量 },
                    { label: "发动机型号", value: modelDetailData.发动机型号 },
                    { label: "燃油类型", value: modelDetailData.燃油类型 },
                    { label: "进气形式", value: modelDetailData.进气形式 },
                    { label: "排放标准", value: modelDetailData.排放标准 },
                    { label: "功率", value: modelDetailData.功率 ? `${modelDetailData.功率}kW` : null },
                    { label: "马力", value: modelDetailData.马力 ? `${modelDetailData.马力}PS` : null },
                    { label: "驱动方式", value: modelDetailData.驱动方式 },
                    { label: "变速箱类型", value: modelDetailData.变速箱类型 },
                    { label: "变速箱代号", value: modelDetailData.变速箱代号 },
                    { label: "档位数", value: modelDetailData.档位数 },
                    { label: "底盘代号", value: modelDetailData.底盘代号 },
                    { label: "车身类型", value: modelDetailData.车身类型 },
                    { label: "车身尺寸", value: modelDetailData.车身尺寸 },
                    { label: "轴距", value: modelDetailData.轴距 ? `${modelDetailData.轴距}mm` : null },
                    { label: "整备质量", value: modelDetailData.整备质量 ? `${modelDetailData.整备质量}kg` : null },
                    { label: "前轮胎规格", value: modelDetailData.前轮胎规格 },
                    { label: "后轮胎规格", value: modelDetailData.后轮胎规格 },
                    { label: "状态", value: modelDetailData.停产标志 },
                    { label: "厂商指导价", value: modelDetailData.厂商指导价 ? `¥${modelDetailData.厂商指导价.toLocaleString()}` : null },
                  ].map((item) => (
                    item.value !== null && item.value !== undefined && item.value !== "" ? (
                      <div key={item.label} className="flex justify-between text-sm border-b border-gray-50 pb-1.5">
                        <span className="text-gray-500">{item.label}</span>
                        <span className="text-gray-900 font-medium">{String(item.value)}</span>
                      </div>
                    ) : null
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-8">未找到车型详情</div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={() => { setShowModelDetail(false); setModelDetailData(null); }}
                className="w-full py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
