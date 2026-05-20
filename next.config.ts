import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel上のESLintバージョン非互換を回避するため、ビルド中のLintをスキップ。
  // ローカルでの npm run lint は引き続き有効。
  eslint: { ignoreDuringBuilds: true },
  // LAN内の他デバイスからの開発サーバーアクセスを許可する。
  // Next.js 15.3+ はデフォルトで同一オリジン以外のdev接続を拒否するため、
  // LAN IPを明示的に許可しないとHMR WebSocketが失敗し、
  // Reactハイドレーション自体が完了しない。
  allowedDevOrigins: [
    "http://192.168.100.13:3000",
    "http://192.168.100.13",
    "http://localhost:3000",
    "http://localhost",
  ],
};

export default nextConfig;
