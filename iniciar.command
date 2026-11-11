#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
url=http://127.0.0.1:8765
if [[ $# -eq 0 && "$(curl -fsS --max-time 4 "$url/api/status" 2>/dev/null)" == *'"app": "Arkham TV"'* ]]; then
  exec /usr/bin/open "$url/"
fi
exec python3 app.py --open "$@"
