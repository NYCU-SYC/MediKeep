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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
