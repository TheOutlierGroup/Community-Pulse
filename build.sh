#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/backend"
npm install
npm run migrate
npm run seed
cd "$ROOT/frontend"
npm install
npm run build
echo "Build complete."
