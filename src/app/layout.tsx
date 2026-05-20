import type { Metadata } from "next";
import "./globals.css";
import "./print.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "汽修管家 - 汽车维修厂管理系统",
  description: "汽车维修厂工单、库存、客户一体化管理软件",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "汽修管家",
  },
};

export const viewport = {
  width: "device-width" as const,
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover" as const,
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="h-screen flex bg-gray-50 overflow-hidden">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
