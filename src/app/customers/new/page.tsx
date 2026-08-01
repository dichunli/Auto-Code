"use client";

import {useState, useEffect, useRef, useMemo} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { VehicleModelSearch } from "@/components/VehicleModelSearch";
import { ImageUploader } from "@/components/ImageUploader";
import LicensePlateOcrButton from "@/components/LicensePlateOcrButton";
import { 新建客户 } from "../actions";

interface VehicleForm {
  id: string;
  plate_number: string;
  vin: string;
  brand: string;
  model: string;
  engine_no: string;
  chassis_code: string;
  transmission_type: string;
  transmission_code: string;
  color: string;
  year: string;
  mileage: string;
  notes: string;
}

let vehicleIdCounter = 0;

export default function NewCustomerPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);

  interface ContactForm {
    id: string;
    name: string;
    phone: string;
    relationship: string;
    notes: string;
    searchResult?: { name: string; phone: string; relationship: string; notes: string } | null;
  }

  const [customer, setCustomer] = useState({
    name: "",
    phone: "",
    gender: "",
    address: "",
    company: "",
    id_card: "",
    notes: "",
  });

  const [contacts, setContacts] = useState<ContactForm[]>([]);

  const [customerPhones, setCustomerPhones] = useState<{ id: string; phone: string; label: string }[]>([]);

  const [customerPhotos, setCustomerPhotos] = useState<string[]>([]);

  const [phoneSearchResult, setPhoneSearchResult] = useState<{ name: string; phone: string } | null>(null);

  const [hasPhone, setHasPhone] = useState(true);

  const [vehicles, setVehicles] = useState<VehicleForm[]>([]);

  function addVehicle() {
    vehicleIdCounter++;
    setVehicles((prev) => [
      ...prev,
      {
        id: `v-${vehicleIdCounter}`,
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
      },
    ]);
  }

  function removeVehicle(id: string) {
    setVehicles((prev) => prev.filter((v) => v.id !== id));
  }

  const contactIdCounterRef = useRef(0);
  const phoneIdCounterRef = useRef(0);
  const [pendingPhoneSearch, setPendingPhoneSearch] = useState<{contactId: string; phone: string} | null>(null);
  const debouncedPhoneSearch = useDebounce(pendingPhoneSearch, 300);

  function addPhone() {
    phoneIdCounterRef.current++;
    setCustomerPhones((prev) => [
      ...prev,
      { id: `p-${Date.now()}-${phoneIdCounterRef.current}`, phone: "", label: "" },
    ]);
  }

  function removePhone(id: string) {
    setCustomerPhones((prev) => prev.filter((p) => p.id !== id));
  }

  function updatePhone(id: string, field: "phone" | "label", value: string) {
    setCustomerPhones((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  function addContact() {
    contactIdCounterRef.current++;
    setContacts((prev) => [
      ...prev,
      { id: `c-${Date.now()}-${contactIdCounterRef.current}`, name: "", phone: "", relationship: "", notes: "" },
    ]);
  }

  function removeContact(id: string) {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  function updateContact(id: string, field: keyof ContactForm, value: string) {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value, searchResult: field === "phone" ? undefined : c.searchResult } : c))
    );
  }

  async function searchContactByPhone(contactId: string, phone: string) {
    if (!phone.trim()) return;
    const { data } = await supabase
      .from("customers")
      .select("name, phone")
      .eq("phone", phone.trim())
      .limit(1)
      .maybeSingle();
    if (data) {
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? { ...c, searchResult: { name: data.name, phone: data.phone, relationship: "", notes: "" } } : c))
      );
    }
  }

  useEffect(() => {
    if (debouncedPhoneSearch) {
      searchContactByPhone(debouncedPhoneSearch.contactId, debouncedPhoneSearch.phone);
    }
  }, [debouncedPhoneSearch]);

  async function searchMainPhone(phone: string) {
    if (!phone.trim()) { setPhoneSearchResult(null); return; }
    const { data } = await supabase
      .from("customer_contacts")
      .select("name, phone")
      .eq("phone", phone.trim())
      .limit(1)
      .maybeSingle();
    if (data) {
      setPhoneSearchResult(data);
    } else {
      setPhoneSearchResult(null);
    }
  }

  function applyPhoneSearch() {
    if (phoneSearchResult) {
      setCustomer({ ...customer, name: phoneSearchResult.name });
      setPhoneSearchResult(null);
    }
  }

  function fillContactFromSearch(contactId: string) {
    setContacts((prev) =>
      prev.map((c) =>
        c.id === contactId && c.searchResult
          ? { ...c, name: c.searchResult.name, relationship: c.searchResult.relationship || "", notes: c.searchResult.notes || "", searchResult: undefined }
          : c
      )
    );
  }

  function updateVehicle(id: string, field: keyof VehicleForm, value: string) {
    setVehicles((prev) =>
      prev.map((v) => (v.id === id ? { ...v, [field]: value } : v))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customer.name.trim()) {
      alert("请填写客户姓名");
      return;
    }
    if (hasPhone && !customer.phone.trim()) {
      alert("请填写手机号");
      return;
    }
    setLoading(true);

    /* 保存走 Server Action（服务端写库，含手机号唯一性校验），
     * 避免客户端 session 异常导致保存失败 */
    let result;
    try {
      result = await 新建客户({
        customer,
        hasPhone,
        customerPhotos,
        customerPhones,
        contacts,
        vehicles,
      });
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
      setLoading(false);
      return;
    }

    if (!result.success) {
      alert(result.error);
      setLoading(false);
      return;
    }

    router.push("/customers");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="新增客户" description="录入客户档案与车辆信息" />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl">
        <div className="space-y-6">
          {/* 客户信息 */}
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-4">客户信息</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">客户姓名 *</label>
                <input
                  required
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    id="hasPhone"
                    checked={hasPhone}
                    onChange={(e) => {
                      setHasPhone(e.target.checked);
                      if (!e.target.checked) {
                        setCustomer({ ...customer, phone: "" });
                        setPhoneSearchResult(null);
                      }
                    }}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="hasPhone" className="text-sm text-gray-700">有手机号</label>
                </div>
                {hasPhone && (
                  <>
                    <input
                      type="tel"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={customer.phone}
                      onChange={(e) => {
                        setCustomer({ ...customer, phone: e.target.value });
                        if (!e.target.value.trim()) setPhoneSearchResult(null);
                      }}
                      onBlur={(e) => searchMainPhone(e.target.value)}
                    />
                    {phoneSearchResult && (
                      <div className="mt-1 p-2 bg-blue-50 border border-blue-200 rounded text-xs flex items-center justify-between">
                        <span className="text-blue-800">系统中已有该手机号的联系人：{phoneSearchResult.name}</span>
                        <button type="button" onClick={applyPhoneSearch} className="text-blue-700 font-medium hover:text-blue-900">使用该姓名</button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="sm:col-span-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">备用手机号</label>
                  <button
                    type="button"
                    onClick={addPhone}
                    className="px-3 py-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                  >
                    + 添加手机号
                  </button>
                </div>
                {customerPhones.length === 0 && (
                  <p className="text-sm text-gray-400">暂无备用手机号</p>
                )}
                <div className="space-y-2">
                  {customerPhones.map((p) => (
                    <div key={p.id} className="flex gap-2 items-center">
                      <input
                        type="tel"
                        placeholder="手机号"
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={p.phone}
                        onChange={(e) => updatePhone(p.id, "phone", e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="标签，如：工作、家庭"
                        className="w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={p.label}
                        onChange={(e) => updatePhone(p.id, "label", e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => removePhone(p.id)}
                        className="px-2 py-2 text-xs text-red-600 hover:text-red-700"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">性别</label>
                <div className="flex gap-4 mt-2">
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="gender"
                      value="男"
                      checked={customer.gender === "男"}
                      onChange={(e) => setCustomer({ ...customer, gender: e.target.value })}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    男
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="gender"
                      value="女"
                      checked={customer.gender === "女"}
                      onChange={(e) => setCustomer({ ...customer, gender: e.target.value })}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    女
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">所属单位</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={customer.company}
                  onChange={(e) => setCustomer({ ...customer, company: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">身份证号</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={customer.id_card}
                  onChange={(e) => setCustomer({ ...customer, id_card: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={customer.address}
                  onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
              <textarea
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={customer.notes}
                onChange={(e) => setCustomer({ ...customer, notes: e.target.value })}
              />
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">客户照片</label>
              <ImageUploader
                bucket="customer-media"
                folder="customer-media"
                maxImages={20}
                existingImages={customerPhotos}
                onUpload={setCustomerPhotos}
              />
            </div>
          </div>

          {/* 联系人 */}
          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">联系人</h2>
              <button
                type="button"
                onClick={addContact}
                className="px-3 py-1.5 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
              >
                + 添加联系人
              </button>
            </div>
            {contacts.length === 0 && <p className="text-sm text-gray-400">暂无联系人，点击上方按钮添加</p>}
            <div className="space-y-4">
              {contacts.map((c, idx) => (
                <div key={c.id} className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">联系人 #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeContact(c.id)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">姓名 *</label>
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={c.name}
                        onChange={(e) => updateContact(c.id, "name", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">电话 *</label>
                      <input
                        type="tel"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={c.phone}
                        onChange={(e) => {
                          const value = e.target.value;
                          updateContact(c.id, "phone", value);
                          setPendingPhoneSearch({ contactId: c.id, phone: value });
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">与客户关系</label>
                      <input
                        type="text"
                        placeholder="如：配偶、朋友"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={c.relationship}
                        onChange={(e) => updateContact(c.id, "relationship", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">备注</label>
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={c.notes}
                        onChange={(e) => updateContact(c.id, "notes", e.target.value)}
                      />
                    </div>
                  </div>
                  {c.searchResult && (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs flex items-center justify-between">
                      <span className="text-blue-800">
                        系统中已存在客户：{c.searchResult.name}，是否关联为联系人？
                      </span>
                      <button
                        type="button"
                        onClick={() => fillContactFromSearch(c.id)}
                        className="text-blue-700 font-medium hover:text-blue-900"
                      >
                        关联
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 车辆信息 */}
          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">车辆信息（可选）</h2>
              <button
                type="button"
                onClick={addVehicle}
                className="px-3 py-1.5 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
              >
                + 添加车辆
              </button>
            </div>

            {vehicles.length === 0 && (
              <p className="text-sm text-gray-400">点击&ldquo;添加车辆&rdquo;按钮为客户添加车辆</p>
            )}

            <div className="space-y-4">
              {vehicles.map((v, idx) => (
                <div key={v.id} className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">车辆 #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeVehicle(v.id)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">车牌号</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="如：京A12345"
                          className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={v.plate_number}
                          onChange={(e) => updateVehicle(v.id, "plate_number", e.target.value.toUpperCase())}
                        />
                        <LicensePlateOcrButton
                          onRecognize={(plate) => updateVehicle(v.id, "plate_number", plate)}
                          className="px-2 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">VIN 码</label>
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.vin}
                        onChange={(e) => updateVehicle(v.id, "vin", e.target.value.toUpperCase())}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">车型信息（从车型库选择）</label>
                      <VehicleModelSearch
                        placeholder="智能模糊搜索：品牌、车系、车型、厂商、发动机、底盘代号..."
                        onSelect={(m) => {
                          updateVehicle(v.id, "brand", m.brand);
                          updateVehicle(v.id, "model", m.model);
                          updateVehicle(v.id, "engine_no", m.engine_no);
                          updateVehicle(v.id, "chassis_code", m.chassis_code);
                          updateVehicle(v.id, "transmission_type", m.transmission_type);
                          updateVehicle(v.id, "transmission_code", m.transmission_code);
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">品牌</label>
                      <input
                        type="text"
                        placeholder="如：大众"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.brand}
                        onChange={(e) => updateVehicle(v.id, "brand", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">型号</label>
                      <input
                        type="text"
                        placeholder="如：迈腾"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.model}
                        onChange={(e) => updateVehicle(v.id, "model", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">发动机型号</label>
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.engine_no}
                        onChange={(e) => updateVehicle(v.id, "engine_no", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">底盘型号</label>
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.chassis_code}
                        onChange={(e) => updateVehicle(v.id, "chassis_code", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">变速箱形式</label>
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.transmission_type}
                        onChange={(e) => updateVehicle(v.id, "transmission_type", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">变速箱型号</label>
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.transmission_code}
                        onChange={(e) => updateVehicle(v.id, "transmission_code", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">颜色</label>
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.color}
                        onChange={(e) => updateVehicle(v.id, "color", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">年份</label>
                      <input
                        type="number"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.year}
                        onChange={(e) => updateVehicle(v.id, "year", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">当前里程</label>
                      <input
                        type="number"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.mileage}
                        onChange={(e) => updateVehicle(v.id, "mileage", e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">备注</label>
                      <textarea
                        rows={1}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={v.notes}
                        onChange={(e) => updateVehicle(v.id, "notes", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
