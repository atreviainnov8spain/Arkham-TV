#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

label=com.arkhamtv.local
domain="gui/$(id -u)"
agent="$HOME/Library/LaunchAgents/$label.plist"
runtime="$HOME/Library/Application Support/Arkham TV"

if [[ "${1:-}" == "--desactivar" ]]; then
  if /bin/launchctl print "$domain/$label" >/dev/null 2>&1; then
    /bin/launchctl bootout "$domain/$label"
  fi
  rm -f -- "$agent"
  printf 'Arranque automático de Arkham TV desactivado.\n'
  exit
fi

if /bin/launchctl print "$domain/$label" >/dev/null 2>&1; then
  /bin/launchctl bootout "$domain/$label"
fi

if /usr/sbin/lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  printf 'El puerto local 8765 está ocupado. Cierra el servidor de Arkham TV antes de activar index.html.\n' >&2
  exit 1
fi

mkdir -p -- "$HOME/Library/LaunchAgents" "$runtime"
/usr/bin/python3 - "$agent" "$runtime" <<'PY'
from pathlib import Path
import plistlib
import shutil
import sys
import tempfile

agent = Path(sys.argv[1])
source = Path.cwd()
project = Path(sys.argv[2])
shutil.copy2(source / "app.py", project)
for folder in ("web", "assets", "native"):
    shutil.copytree(source / folder, project / folder, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"))
data = project / ".datos"
data.mkdir(exist_ok=True)
for name in ("canales.json", "ultimo-canal", "dvb-usb-af9035-02.fw"):
    original = source / ".datos" / name
    if original.is_file() and not (data / name).exists():
        shutil.copy2(original, data / name)

configuration = {
    "Label": "com.arkhamtv.local",
    "ProgramArguments": ["/usr/bin/python3", str(project / "app.py"), "--launchd"],
    "WorkingDirectory": str(project),
    "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
    "StandardOutPath": str(project / ".datos" / "launchd.log"),
    "StandardErrorPath": str(project / ".datos" / "launchd.log"),
    "Sockets": {"ArkhamTV": {
        "SockNodeName": "127.0.0.1", "SockServiceName": "8765",
        "SockFamily": "IPv4", "SockType": "stream",
    }},
}
with tempfile.NamedTemporaryFile(dir=agent.parent, delete=False) as output:
    plistlib.dump(configuration, output)
Path(output.name).replace(agent)
PY

if ! /bin/launchctl bootstrap "$domain" "$agent"; then
  rm -f -- "$agent"
  exit 1
fi
printf 'Arkham TV activado. Abre index.html desde Finder.\n'
