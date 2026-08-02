import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 酒馆",
  description: "由 AI 驱动的世界观与角色扮演互动叙事程序。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
