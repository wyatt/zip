#!/usr/bin/env bash
# Resume-safe Ithaca 5 km lidar acquire. Restarts after EINTR / network drops.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export MAMBA_ROOT_PREFIX="$ROOT/.micromamba"
LOG="$ROOT/data/ithaca-acquire.log"
MANIFEST="$ROOT/Drone_Simulation/viewer/public/region/manifest.json"
mkdir -p "$(dirname "$LOG")"

if [[ -f "$MANIFEST" ]]; then
  echo "Region package already exists at $MANIFEST"
  exit 0
fi

attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) starting acquire attempt $attempt" | tee -a "$LOG"
  set +e
  "$ROOT/.tools/bin/micromamba" run -p "$ROOT/Drone_Simulation/.conda" \
    python "$ROOT/Drone_Simulation/viewer/tools/acquire_region.py" --workers 1
  code=$?
  set -e
  if [[ $code -eq 0 || -f "$MANIFEST" ]]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) acquire finished (exit $code)" | tee -a "$LOG"
    exit 0
  fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) acquire exited $code; retrying in 15s" | tee -a "$LOG"
  sleep 15
done
