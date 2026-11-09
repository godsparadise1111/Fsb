#!/usr/bin/env sh
set -eu
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm is required." >&2; exit 1; }
[ -f package.json ] || { echo "ERROR: run this script from the monorepo root." >&2; exit 1; }

npm install --package-lock-only --ignore-scripts --no-audit --no-fund
[ -s package-lock.json ] || { echo "ERROR: npm did not create package-lock.json." >&2; exit 1; }
npm ci --ignore-scripts --no-audit --no-fund

echo "Root package-lock.json generated and npm ci validated. Review and commit package-lock.json before Production."
