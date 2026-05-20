"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import LicensePlateOcrButton from "@/components/LicensePlateOcrButton";

export default function NewAppointmentPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    plate_number: "",
    vehicle_brand: "",
    vehicle_model: "",
    appointment_date: "",
    appointment_time: "",
    service_type: "",
    notes: "",
  });

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_name || !form.customer_phone || !form.appointment_date) {
      alert("请填写客户姓名、电话和预约日期");
      return;
    }

    setLoading(true);
    const { error } = await supabase.from("appointments").insert({
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim(),
      plate_number: form.plate_number.trim() || null,
      vehicle_brand: form.vehicle_brand.trim() || null,
      vehicle_model: form.vehicle_model.trim() || null,
      appointment_date: form.appointment_date,
      appointment_time: form.appointment_time || null,
      service_type: form.service_type.trim() || null,
      notes: form.notes.trim() || null,
    });

    if (error) {
      alert("保存失败: " + error.message);
      setLoading(false);
      return;
    }

    router.push("/appointments");
    router.refresh();
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="新增预约" description="登记客户到店预约信息" />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">客户姓名 *</label>
            <input
              required
              value={form.customer_name}
              onChange={(e) => handleChange("customer_name", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="请输入客户姓名"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">联系电话 *</label>
            <input
              required
              value={form.customer_phone}
              onChange={(e) => handleChange("customer_phone", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="请输入联系电话"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">车牌号码</label>
            <div className="flex gap-2">
              <input
                value={form.plate_number}
                onChange={(e) => handleChange("plate_number", e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例如: 京A12345"
              />
              <LicensePlateOcrButton
                onRecognize={(plate) => handleChange("plate_number", plate)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">车辆品牌</label>
            <input
              value={form.vehicle_brand}
              onChange={(e) => handleChange("vehicle_brand", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">车辆型号</label>
            <input
              value={form.vehicle_model}
              onChange={(e) => handleChange("vehicle_model", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">预约日期 *</label>
            <input
              type="date"
              required
              min={today}
              value={form.appointment_date}
              onChange={(e) => handleChange("appointment_date", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">预约时间</label>
            <input
              type="time"
              value={form.appointment_time}
              onChange={(e) => handleChange("appointment_time", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">服务项目</label>
          <input
            value={form.service_type}
            onChange={(e) => handleChange("service_type", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="例如：常规保养、故障检修、钣金喷漆"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea
            value={form.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "保存中..." : "保存预约"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/appointments")}
            className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
