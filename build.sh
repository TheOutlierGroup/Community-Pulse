#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/backend"
npm install
npm run migrate
npm run seed
cd "$ROOT/frontend"
# Render (and many CI envs) set NODE_ENV=production, which skips devDependencies.
# Vite is a devDependency — install it explicitly so `vite build` works.
npm install --include=dev
npm run build
echo "Build complete."
