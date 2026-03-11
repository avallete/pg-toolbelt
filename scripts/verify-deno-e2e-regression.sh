#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Run multi-runtime e2e (Node, Bun, Deno) ==="
"$REPO_ROOT/scripts/e2e-docker.sh"
echo "PASS: Multi-runtime e2e succeeded."
