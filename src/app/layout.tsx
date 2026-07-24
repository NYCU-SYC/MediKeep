import type { Metadata } from "next";
import "./globals.css";
import "./cmo/cmo.css";

export const metadata: Metadata = {
  title: "HealthKeep · 做醫家之主",
  description: "您的家庭健康守護者",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className="h-full antialiased">
      <head>
        {/* 改版視覺：Noto Sans TC（離線時自動退回系統字體，不影響功能） */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
