import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "コエミル - 音声トレーニングHUD",
  description: "リアルタイム音声解析・視覚化 HUDアプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full bg-black text-white overflow-hidden" suppressHydrationWarning>{children}</body>
    </html>
  );
}
