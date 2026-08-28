"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { VehicleModelSearch } from "@/components/VehicleModelSearch";
import { ImageUploader } from "@/components/ImageUploader";
import VinDecodeInput from "@/components/VinDecodeInput";
import LicensePlateOcrButton from "@/components/LicensePlateOcrButton";
import { 更新车辆 } from "../../actions";

type OwnerMode = "existing" | "new";

export default function EditVehiclePage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    plate_number: "",
    vin: "",
    vehicle_model_id: null as number | null,
    brand: "",
    model: "",
    engine_no: "",
    chassis_code: "",
    transmission_type: "",
    transmission_code: "",
    color: "",
    year: "",
    mileage: "",
    notes: "",
  });

  const [customerId, setCustomerId] = useState("");
  const [currentCustomerName, setCurrentCustomerName] = useState("");
  const [ownerMode, setOwnerMode] = useState<OwnerMode>("existing");
  const [customerQuery, setCustomerQuery] = useState("");
  interface CustomerResult {
    id: string;
    name: string;
    phone: string | null;
  }
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", gender: "" });
  const [changingOwner, setChangingOwner] = useState(false);
  const [changingPlate, setChangingPlate] = useState(false);
  const [originalPlateNumber, setOriginalPlateNumber] = useState("");

  const [companyQuery, setCompanyQuery] = useState("");
  interface CompanyResult {
    id: string;
    name: string;
  }
  const [companyResults, setCompanyResults] = useState<CompanyResult[]>([]);
  const [companySearching, setCompanySearching] = useState(false);
  const [companyId, setCompanyId] = useState("");

  const [exteriorPhotos, setExteriorPhotos] = useState<string[]>([]);
  const [nameplatePhotos, setNameplatePhotos] = useState<string[]>([]);
  const [licenseFrontPhotos, setLicenseFrontPhotos] = useState<string[]>([]);
  const [licenseBackPhotos, setLicenseBackPhotos] = useState<string[]>([]);
  const [vinSearchKeyword, setVinSearchKeyword] = useState("");

  interface 车型详情 {
    id: number;
    排量: string | null;
  }
  const [vehicleModelDetail, setVehicleModelDetail] = useState<车型详情 | null>(null);

  interface 客户标签 {
    name: string;
    color: string;
  }
  const [customerStar, setCustomerStar] = useState<number | null>(null);
  const [customerTags, setCustomerTags] = useState<客户标签[]>([]);

  interface 工单统计 {
    type: string;
    label: string;
    count: number;
  }
  const [orderStats, setOrderStats] = useState<工单统计[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("vehicles")
        .select("*, customers(id, name, phone, star_level), companies(id, name)")
        .eq("id", id)
        .single();
      if (data) {
        const plate = data.plate_number || "";
        setOriginalPlateNumber(plate);
        setForm({
          plate_number: plate,
          vin: data.vin || "",
          vehicle_model_id: data.vehicle_model_id || null,
          brand: data.brand || "",
          model: data.model || "",
          engine_no: data.engine_no || "",
          chassis_code: data.chassis_code || "",
          transmission_type: data.transmission_type || "",
          transmission_code: data.transmission_code || "",
          color: data.color || "",
          year: data.year?.toString() || "",
          mileage: data.mileage?.toString() || "",
          notes: data.notes || "",
        });
        setCustomerId(data.customer_id || "");
        const c = data.customers as { id: string; name: string; phone: string | null; star_level?: number | null } | null;
        if (c) {
          setCurrentCustomerName(`${c.name} (${c.phone})`);
          setCustomerStar(c.star_level ?? null);
        }
        const comp = data.companies;
        if (comp) {
          setCompanyId(comp.id);
          setCompanyQuery(comp.name);
        }

        /* 查询客户标签 */
        if (data.customer_id) {
          const { data: tagData } = await supabase
            .from("customer_tags")
            .select("tags(name, color)")
            .eq("customer_id", data.customer_id);
          if (tagData) {
            setCustomerTags(
              tagData
                .filter((t: unknown) => (t as { tags?: { name: string; color: string } | null }).tags)
                .map((t: unknown) => (t as { tags: { name: string; color: string } }).tags)
            );
          }
        }

        /* 查询车辆历史工单统计 */
        const { data: orderData } = await supabase
          .from("work_orders")
          .select("id, order_no, order_type")
          .eq("vehicle_id", id);
        const typeLabelMap: Record<string, string> = {
          appointment: "预约工单",
          quote: "历史报价单",
          cancelled: "作废工单",
          maintenance: "保养工单",
        };
        const statsMap: Record<string, number> = {};
        (orderData || []).forEach((o: { order_type?: string }) => {
          const t = o.order_type || "normal";
          if (t === "normal") return;
          statsMap[t] = (statsMap[t] || 0) + 1;
        });
        setOrderStats(
          Object.entries(statsMap).map(([t, count]) => ({
            type: t,
            label: typeLabelMap[t] || t,
            count,
          }))
        );

        /* 如果已有车型关联，查询详细信息显示在输入框 */
        if (data.vehicle_model_id) {
          const { data: vmData } = await supabase
            .from("vehicle_models")
            .select("id,品牌,车系,车型,年款,销售版本,排量,发动机型号")
            .eq("id", data.vehicle_model_id)
            .single();
          if (vmData) {
            const vm = vmData as unknown as { id: number; 品牌?: string | null; 车系?: string | null; 车型?: string | null; 年款?: number | null; 销售版本?: string | null; 排量?: string | null; 发动机型号?: string | null };
            setVehicleModelDetail({ id: vm.id, 排量: vm.排量 || null });
            const parts = [
              vm.年款 ? `${vm.年款}款` : null,
              vm.品牌,
              vm.车系,
              vm.车型,
              vm.销售版本,
              vm.排量,
              vm.发动机型号,
            ].filter(Boolean);
            setVinSearchKeyword(`${parts.join(" ")} [ID:${data.vehicle_model_id}]`);
          }
        }

        const { data: photoData, error: photoError } = await supabase
          .from("vehicle_photos")
          .select("category, url, storage_path")
          .eq("vehicle_id", id)
          .order("created_at", { ascending: false });
        if (photoError) {
          console.error("加载车辆照片失败:", photoError);
        }
        if (photoData) {
          setExteriorPhotos(photoData.filter((p) => p.category === "exterior").map((p) => p.url || p.storage_path));
          setNameplatePhotos(photoData.filter((p) => p.category === "nameplate").map((p) => p.url || p.storage_path));
          setLicenseFrontPhotos(photoData.filter((p) => p.category === "license_front").map((p) => p.url || p.storage_path));
          setLicenseBackPhotos(photoData.filter((p) => p.category === "license_back").map((p) => p.url || p.storage_path));
        }
      }
      setLoading(false);
    }
    load();
  }, [id]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!customerQuery.trim()) { setCustomerResults([]); setSearching(false); return; }
      setSearching(true);
      const q = customerQuery.trim();
      const supabase = createClient();
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone")
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(10);
      setCustomerResults(data || []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [customerQuery]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!companyQuery.trim()) { setCompanyResults([]); setCompanySearching(false); return; }
      setCompanySearching(true);
      const q = companyQuery.trim();
      const supabase = createClient();
      const { data } = await supabase
        .from("companies")
        .select("id, name")
        .ilike("name", `%${q}%`)
        .limit(10);
      setCompanyResults(data || []);
      setCompanySearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [companyQuery]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.plate_number.trim()) { alert("请填写车牌号"); return; }

    /* 组装照片清单 */
    const photos: { category: string; url: string }[] = [];
    exteriorPhotos.forEach((url) => photos.push({ category: "exterior", url }));
    nameplatePhotos.forEach((url) => photos.push({ category: "nameplate", url }));
    licenseFrontPhotos.forEach((url) => photos.push({ category: "license_front", url }));
    licenseBackPhotos.forEach((url) => photos.push({ category: "license_back", url }));

    setSaving(true);
    /* 写库走 Server Action（建车主→查重→改车→照片全量替换，服务端一次完成） */
    try {
      const result = await 更新车辆({
        id,
        existingCustomerId: ownerMode === "new" ? "" : customerId,
        newCustomer: ownerMode === "new" ? newCustomer : null,
        companyId,
        form,
        photos,
      });
      if (!result.success) {
        alert("保存失败: " + (result.error || "未知错误"));
        setSaving(false);
        return;
      }
    } catch {
      alert("保存失败：网络异常，请重试");
      setSaving(false);
      return;
    }

    const returnTo = searchParams.get("returnTo");
    /* 移动端浏览器 router.push 不可靠，强制整页跳转避免缓存和状态问题 */
    window.location.href = returnTo || `/vehicles/${id}`;
  }

  if (loading) return <div className="py-8 text-sm text-gray-500">加载中...</div>;

  return (
    <div>
      <PageHeader title="编辑车辆" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">车牌号 *</label>
            {!changingPlate ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-900 font-medium">{form.plate_number}</span>
                <button
                  type="button"
                  onClick={() => setChangingPlate(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                >
                  变更车牌
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  required
                  type="text"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.plate_number}
                  onChange={(e) => setForm({ ...form, plate_number: e.target.value.toUpperCase() })}
                />
                <LicensePlateOcrButton
                  onRecognize={(plate) => setForm((prev) => ({ ...prev, plate_number: plate }))}
                  buttonText={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  }
                  className="flex items-center justify-center w-10 h-10 text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 shrink-0"
                />
                <button
                  type="button"
                  onClick={() => {
                    setChangingPlate(false);
                    setForm((prev) => ({ ...prev, plate_number: originalPlateNumber }));
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 hover:underline whitespace-nowrap"
                >
                  取消变更
                </button>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">VIN 码</label>
            <VinDecodeInput
              value={form.vin}
              onChange={(v) => setForm({ ...form, vin: v })}
              onDecode={async (result) => {
                if (!result) return;
                /* 先填充VIN解析的基本信息 */
                setForm((prev) => ({
                  ...prev,
                  brand: result.brand || prev.brand,
                  model: result.series && result.model ? [...new Set([result.series, result.model])].join(" ") : prev.model,
                  engine_no: result.engineNo || prev.engine_no,
                  chassis_code: result.chassisCode || prev.chassis_code,
                  transmission_type: result.transmissionType || prev.transmission_type,
                  transmission_code: result.transmissionCode || prev.transmission_code,
                  year: result.year || prev.year,
                }));

                /* 自动匹配车型库 */
                const searchTerms = [...new Set([result.brand, result.series, result.model].filter(Boolean))];
                const keyword = searchTerms.join(" ");
                if (!keyword) {
                  setVinSearchKeyword("");
                  return;
                }

                const supabase = createClient();
                try {
                  const { data } = await supabase
                    .from("vehicle_models")
                    .select("id,品牌,车系,车型,年款,排量,销售版本,底盘代号,发动机型号,变速箱类型,变速箱代号")
                    .ilike("搜索字段", `%${keyword}%`)
                    .limit(5);

                  if (data && data.length > 0) {
                    const m = data[0] as unknown as {
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
                    const modelParts = [...new Set([m.车系, m.车型].filter(Boolean))];
                    setForm((prev) => ({
                      ...prev,
                      vehicle_model_id: m.id,
                      brand: m.品牌 || prev.brand,
                      model: modelParts.join(" ") || m.品牌 || prev.model,
                      engine_no: m.发动机型号 || prev.engine_no,
                      chassis_code: m.底盘代号 || prev.chassis_code,
                      transmission_type: m.变速箱类型 || prev.transmission_type,
                      transmission_code: m.变速箱代号 || prev.transmission_code,
                    }));
                    const displayParts = [
                      m.年款 ? `${m.年款}款` : null,
                      m.品牌,
                      m.车系,
                      m.车型,
                      m.销售版本,
                      m.排量,
                      m.发动机型号,
                    ].filter(Boolean);
                    setVehicleModelDetail({ id: m.id, 排量: m.排量 || null });
                    setVinSearchKeyword(`${displayParts.join(" ")} [ID:${m.id}]`);
                  } else {
                    setVehicleModelDetail(null);
                    setVinSearchKeyword(keyword);
                  }
                } catch {
                  setVehicleModelDetail(null);
                  setVinSearchKeyword(keyword);
                }
              }}
              inputClassName="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              buttonClassName="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            />
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">车型信息（从车型库选择）</label>
          <VehicleModelSearch
            placeholder="智能模糊搜索：品牌、车系、车型、厂商、发动机、底盘代号..."
            searchKeyword={vinSearchKeyword}
            selectedModelId={form.vehicle_model_id}
            onSelect={(m) => {
              setForm({
                ...form,
                vehicle_model_id: m.vehicle_model_id,
                brand: m.brand,
                model: m.model,
                engine_no: m.engine_no,
                chassis_code: m.chassis_code,
                transmission_type: m.transmission_type,
                transmission_code: m.transmission_code,
              });
              setVehicleModelDetail(null);
            }}
          />
          {vehicleModelDetail && (
            <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
              <span>车型ID: <span className="text-blue-600 font-medium">{vehicleModelDetail.id}</span></span>
              {vehicleModelDetail.排量 && <span>排量: <span className="text-gray-700">{vehicleModelDetail.排量}</span></span>}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">型号</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">发动机型号</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.engine_no} onChange={(e) => setForm({ ...form, engine_no: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">底盘型号</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.chassis_code} onChange={(e) => setForm({ ...form, chassis_code: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">变速箱形式</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.transmission_type} onChange={(e) => setForm({ ...form, transmission_type: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">变速箱型号</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.transmission_code} onChange={(e) => setForm({ ...form, transmission_code: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">颜色</label>
            <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">年份</label>
            <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">当前里程</label>
            <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })} />
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        {/* 车主信息 */}
        <div className="border-t border-gray-100 mt-6 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">车主信息</h2>
          {!changingOwner && currentCustomerName ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-700">当前车主：{currentCustomerName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setChangingOwner(true);
                    setCustomerQuery("");
                    setCustomerResults([]);
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                >
                  变更车主
                </button>
              </div>
              {customerStar !== null && (
                <div className="text-sm">
                  <span className="text-gray-500">星级：</span>
                  <span className="text-amber-500">{"★".repeat(customerStar)}{"☆".repeat(5 - customerStar)}</span>
                </div>
              )}
              {customerTags.length > 0 && (
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="text-gray-500">标签：</span>
                  {customerTags.map((tag, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded text-xs border"
                      style={{ backgroundColor: tag.color + "20", color: tag.color, borderColor: tag.color + "40" }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
              {orderStats.length > 0 && (
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="text-gray-400 text-xs">历史工单：</span>
                  {orderStats.map((stat) => (
                    <span
                      key={stat.type}
                      className="px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200"
                    >
                      {stat.label}({stat.count})
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              {currentCustomerName && changingOwner && (
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm text-gray-500">原车主：{currentCustomerName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setChangingOwner(false);
                      setCustomerQuery("");
                      setCustomerResults([]);
                      setCustomerId("");
                    }}
                    className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                  >
                    取消变更
                  </button>
                </div>
              )}

              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setOwnerMode("existing")}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${ownerMode === "existing" ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-300 text-gray-600"}`}
                >
                  选择已有客户
                </button>
                <button
                  type="button"
                  onClick={() => setOwnerMode("new")}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${ownerMode === "new" ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-300 text-gray-600"}`}
                >
                  新建客户
                </button>
              </div>

              {ownerMode === "existing" ? (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="输入客户姓名或电话搜索..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={customerQuery}
                    onChange={(e) => { setCustomerQuery(e.target.value); setCustomerId(""); }}
                  />
                  {customerResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {customerResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setCustomerId(c.id);
                            setCustomerQuery(`${c.name} (${c.phone})`);
                            setCustomerResults([]);
                            setCurrentCustomerName("");
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          {c.name} ({c.phone})
                        </button>
                      ))}
                    </div>
                  )}
                  {customerId && customerQuery && (
                    <p className="text-xs text-green-600 mt-1">已选择新车主</p>
                  )}
                  {customerQuery.trim() && customerResults.length === 0 && !searching && !customerId && (
                    <div className="mt-2 px-1">
                      <p className="text-sm text-gray-500">未找到匹配的客户</p>
                      <button
                        type="button"
                        onClick={() => {
                          const q = customerQuery.trim();
                          setOwnerMode("new");
                          if (/^\d{7,}$/.test(q)) {
                            setNewCustomer({ name: "", phone: q, gender: "" });
                          } else {
                            setNewCustomer({ name: q, phone: "", gender: "" });
                          }
                          setCustomerQuery("");
                          setCustomerResults([]);
                        }}
                        className="mt-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        + 使用{'"'}{customerQuery.trim()}{'"'}新建客户
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">客户姓名 *</label>
                    <input
                      required={ownerMode === "new"}
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={newCustomer.name}
                      onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">联系电话 *</label>
                    <input
                      required={ownerMode === "new"}
                      type="tel"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={newCustomer.phone}
                      onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">性别</label>
                    <div className="flex gap-4 mt-2">
                      <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="radio"
                          name="new_customer_gender"
                          value="男"
                          checked={newCustomer.gender === "男"}
                          onChange={(e) => setNewCustomer({ ...newCustomer, gender: e.target.value })}
                          className="text-blue-600 focus:ring-blue-500"
                        />
                        男
                      </label>
                      <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="radio"
                          name="new_customer_gender"
                          value="女"
                          checked={newCustomer.gender === "女"}
                          onChange={(e) => setNewCustomer({ ...newCustomer, gender: e.target.value })}
                          className="text-blue-600 focus:ring-blue-500"
                        />
                        女
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 所属单位 */}
        <div className="border-t border-gray-100 mt-6 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">所属单位</h2>
          <div className="relative">
            <input
              type="text"
              placeholder="输入单位名称搜索..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={companyQuery}
              onChange={(e) => { setCompanyQuery(e.target.value); setCompanyId(""); }}
            />
            {companyResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {companyResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setCompanyId(c.id); setCompanyQuery(c.name); setCompanyResults([]); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {companyId && <p className="text-xs text-green-600 mt-1">已选择单位</p>}
            {companyQuery.trim() && companyResults.length === 0 && !companySearching && !companyId && (
              <p className="text-sm text-gray-500 mt-2">未找到匹配的单位</p>
            )}
          </div>
        </div>

        {/* 照片管理 */}
        <div className="border-t border-gray-100 mt-6 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">车辆照片</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">外观照片</label>
              <ImageUploader
                bucket="vehicle-media"
                folder="vehicle-media"
                maxImages={5}
                existingImages={exteriorPhotos}
                onUpload={setExteriorPhotos}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">厂牌照片</label>
              <ImageUploader
                bucket="vehicle-media"
                folder="vehicle-media"
                maxImages={1}
                existingImages={nameplatePhotos}
                onUpload={setNameplatePhotos}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">行驶证正本</label>
              <ImageUploader
                bucket="vehicle-media"
                folder="vehicle-media"
                maxImages={1}
                existingImages={licenseFrontPhotos}
                onUpload={setLicenseFrontPhotos}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">行驶证副本</label>
              <ImageUploader
                bucket="vehicle-media"
                folder="vehicle-media"
                maxImages={1}
                existingImages={licenseBackPhotos}
                onUpload={setLicenseBackPhotos}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button type="button" onClick={() => router.push("/vehicles")} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
        </div>
      </form>
    </div>
  );
}
