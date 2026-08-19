#!/usr/bin/env bash
# 构建前端并启动只读数据服务（生产模式）
set -euo pipefail
cd "$(dirname "$0")"
if command -v pnpm >/dev/null 2>&1; then
  pnpm build
else
  node node_modules/vite/bin/vite.js build
fi
exec python3 server.py "$@"
