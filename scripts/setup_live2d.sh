#!/usr/bin/env bash
# Downloads the Live2D Cubism Core runtime (proprietary, cannot be committed to git) and an
# official sample model for development. Run once on your machine.
#
#   Cubism Core license: https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
#   Sample model license: https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_DIR="$ROOT/frontend/public/live2d/core"
CORE_URL="${CUBISM_CORE_URL:-https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js}"
MODEL="${1:-Haru}"

mkdir -p "$CORE_DIR"
if [ -s "$CORE_DIR/live2dcubismcore.min.js" ]; then
  echo "✓ Cubism Core already present: $CORE_DIR/live2dcubismcore.min.js"
else
  echo "Downloading Live2D Cubism Core from $CORE_URL ..."
  if curl -fsSL --retry 3 -o "$CORE_DIR/live2dcubismcore.min.js" "$CORE_URL"; then
    echo "✓ Cubism Core downloaded ($(wc -c < "$CORE_DIR/live2dcubismcore.min.js") bytes)"
  else
    echo "✗ Could not download Cubism Core automatically."
    echo "  Download the Cubism SDK for Web from https://www.live2d.com/sdk/download/web/ and copy"
    echo "  Core/live2dcubismcore.min.js into $CORE_DIR/"
    exit 1
  fi
fi

python3 "$ROOT/scripts/download_live2d_sample.py" "$MODEL"
echo
echo "Put your own model (e.g. Gura) in frontend/public/live2d/models/<Name>/<Name>.model3.json"
echo "and set LIVE2D_MODEL_URL in .env (or pick it in the in-app settings panel)."
