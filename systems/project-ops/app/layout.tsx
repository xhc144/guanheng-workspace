import type { Metadata } from "next";
import { faviconMetadata } from "@/lib/base-path.ts";
import "./globals.css";

export const metadata: Metadata = {
  ...faviconMetadata(),
  title: "项目经营管理系统",
  description: "客户、合同、应收、服务费、提成与研发任务一体化管理",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
