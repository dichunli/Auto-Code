"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { VehicleModelSearch } from "@/components/VehicleModelSearch";
import { ImageUploader } from "@/components/ImageUploader";

type OwnerMode = "existing" | "new";

export default function NewVehiclePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [ownerMode, setOwnerMode] = useState<OwnerMode>("existing");

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const [existingCustomerId, setExistingCustomerId] = useState("");
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", gender: "" });

  const [companyQuery, setCompanyQuery] = useState("");
  const [companyResults, setCompanyResults] = useState<any[]>([]);
  const [companySearching, setCompanySearching] = useState(false);
  const [companyId, setCompanyId] = useState("");

  const [form, setForm] = useState({
    plate_number: "黑",
    vin: "",
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

  const [exteriorPhotos, setExteriorPhotos] = useState<string[]>([]);
  const [nameplatePhotos, setNameplatePhotos] = useState<string[]>([]);
  const [licenseFrontPhotos, setLicenseFrontPhotos] = useState<string[]>([]);
  const [licenseBackPhotos, setLicenseBackPhotos] = useState<string[]>([]);

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
    if (!form.plate_number.trim()) {
      alert("请填写车牌号");
      return;
    }

    let customerId = existingCustomerId;
    const supabase = createClient();

    if (ownerMode === "new") {
      if (!newCustomer.name.trim() || !newCustomer.phone.trim()) {
        alert("请填写新车主的姓名和电话");
        return;
      }
      const { data: cust, error: custErr } = await supabase
        .from("customers")
        .insert({ name: newCustomer.name.trim(), phone: newCustomer.phone.trim(), gender: newCustomer.gender || null })
        .select("id")
        .single();
      if (custErr || !cust) {
        alert("创建车主失败: " + (custErr?.message || "未知错误"));
        return;
      }
      customerId = cust.id;
    } else {
      if (!existingCustomerId) {
        alert("请选择已有车主");
        return;
      }
    }

    // 车牌号唯一性校验
    const { data: existingPlate } = await supabase
      .from("vehicles")
      .select("id")
      .eq("plate_number", form.plate_number.trim().toUpperCase())
      .maybeSingle();
    if (existingPlate) {
      alert("该车牌号已被使用，请更换");
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data: vehicleData, error } = await supabase.from("vehicles").insert({
      customer_id: customerId,
      company_id: companyId || null,
      plate_number: form.plate_number.trim(),
      vin: form.vin.trim() || null,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      engine_no: form.engine_no.trim() || null,
      chassis_code: form.chassis_code.trim() || null,
      transmission_type: form.transmission_type.trim() || null,
      transmission_code: form.transmission_code.trim() || null,
      color: form.color.trim() || null,
      year: form.year ? parseInt(form.year) : null,
      mileage: form.mileage ? parseInt(form.mileage) : null,
      notes: form.notes.trim() || null,
    }).select("id").single();

    if (error || !vehicleData?.id) { alert("保存失败: " + (error?.message || "未知错误")); setLoading(false); return; }

    const vehicleId = vehicleData.id;
    const photoInserts: { vehicle_id: string; category: string; url: string }[] = [];
    exteriorPhotos.forEach((url) => photoInserts.push({ vehicle_id: vehicleId, category: "exterior", url }));
    nameplatePhotos.forEach((url) => photoInserts.push({ vehicle_id: vehicleId, category: "nameplate", url }));
    licenseFrontPhotos.forEach((url) => photoInserts.push({ vehicle_id: vehicleId, category: "license_front", url }));
    licenseBackPhotos.forEach((url) => photoInserts.push({ vehicle_id: vehicleId, category: "license_back", url }));
    if (photoInserts.length > 0) {
      await supabase.from("vehicle_photos").insert(photoInserts);
    }

    router.push("/vehicles");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="新增车辆" description="添加车辆档案" />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl">
        {/* 车辆信息 */}
        <div className="mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">车辆信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">车牌号 *</label>
              <input required type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">VIN 码</label>
              <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value.toUpperCase() })} />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">车型信息（从车型库选择）</label>
            <VehicleModelSearch
              placeholder="智能模糊搜索：品牌、车系、车型、厂商、发动机、底盘代号..."
              onSelect={(m) => setForm({
                ...form,
                brand: m.brand,
                model: m.model,
                engine_no: m.engine_no,
                chassis_code: m.chassis_code,
                transmission_type: m.transmission_type,
                transmission_code: m.transmission_code,
              })}
            />
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
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
              <textarea rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
        </div>

        {/* 车主管理 */}
        <div className="border-t border-gray-100 pt-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">车主信息</h2>
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
                placeholder="输入客户姓名搜索..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={customerQuery}
                onChange={(e) => { setCustomerQuery(e.target.value); setExistingCustomerId(""); }}
              />
              {customerResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {customerResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setExistingCustomerId(c.id); setCustomerQuery(`${c.name} (${c.phone})`); setCustomerResults([]); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {c.name} ({c.phone})
                    </button>
                  ))}
                </div>
              )}
              {existingCustomerId && <p className="text-xs text-green-600 mt-1">已选择车主</p>}
              {customerQuery.trim() && customerResults.length === 0 && !searching && !existingCustomerId && (
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
                    + 使用"{customerQuery.trim()}"新建客户
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

        {/* 所属单位 */}
        <div className="border-t border-gray-100 pt-6 mb-6">
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
        <div className="border-t border-gray-100 pt-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">车辆照片</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{loading ? "保存中..." : "保存"}</button>
        </div>
      </form>
    </div>
  );
}
