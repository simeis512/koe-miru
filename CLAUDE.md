# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code (claude.ai/code) に対するガイドラインを提供します。

## プロジェクト概要

「音声トレーニング」を目的とした、リアルタイム音声解析・視覚化 Web アプリケーション（HUD スタイル）。Web Audio API と Wasm ベースの
LPC 解析を使用し、ピッチ (F0)、フォルマント (F3, F4)、および倍音に対して視覚的なフィードバックを提供します。

## 技術スタック

- **フレームワーク**: Next.js (App Router)
- **スタイリング**: Tailwind CSS, shadcn/ui, lucide-react
- **音声処理**: Web Audio API, AudioWorklet
- **解析ライブラリ**: fairly-fast-formants (Wasm), pitchfinder (F0 検出)
- **視覚化**: HTML5 Canvas API (高パフォーマンスな 2D レンダリング)
- **デプロイ先**: Vercel

## コアアーキテクチャと制約事項

- **AudioContext の初期化**: ブラウザの自動再生ポリシーを遵守するため、必ずユーザーのインタラクション（クリックや「開始」ボタンの押下など）によって実行されるようにすること。
- **Wasm および AudioWorklet の配置**: Webpack/Next.js のバンドルエラーを回避するため、Wasm ファイルおよび AudioWorkletProcessor スクリプトは必ず public/ ディレクトリに配置し、URL 経由で読み込む設計にすること。
- **パフォーマンス (Canvas)**: Canvas 要素と解析データには useRef を使用すること。60fps のリアルタイム更新において React の useState を使用するのは避けること（再レンダリングによるパフォーマンス低下を防ぐため）。コンポーネント内の vanilla JS ループ内で requestAnimationFrame を用いて処理を完結させること。
- **プライバシー**: すべての音声処理はクライアントサイドのブラウザメモリ内で行うこと。外部サーバーにデータを送信してはならない。

## 開発コマンド

- `npm run dev` - 開発サーバーの起動
- `npm run build` - 本番用ビルド
- `npm run lint` - ESLint によるコードチェック
