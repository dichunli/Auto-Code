import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./print.css";
import { Navbar } from "@/components/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "汽修管家 - 汽车维修厂管理系统",
  description: "汽车维修厂工单、库存、客户一体化管理软件",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-screen flex bg-gray-50 overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-auto px-4 pt-14 pb-6 sm:px-6 md:pt-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
