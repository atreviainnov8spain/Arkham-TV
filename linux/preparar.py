"""Install the firmware required by the Linux AF9035 driver on request."""

import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.request import urlopen

from native.dvb_linux import FIRMWARE_BY_MODEL, USB_MODELS, find_tuner, firmware_present

FIRMWARE_URL = "https://raw.githubusercontent.com/LibreELEC/dvb-firmware/master/firmware/"


def main():
    sudo = shutil.which("sudo")
    if not sudo:
        raise OSError("Se necesita sudo para preparar el controlador de Ubuntu.")
    identifier, _ = find_tuner()
    model = USB_MODELS.get(identifier)
    models = (model,) if model else FIRMWARE_BY_MODEL
    missing = {name: sha256 for model in models for name, sha256 in FIRMWARE_BY_MODEL[model].items()
               if not firmware_present(name)}
    if missing:
        with tempfile.TemporaryDirectory(prefix="arkham-firmware-") as work:
            sources = []
            for name, sha256 in missing.items():
                print(f"Descargando y verificando {name}…", flush=True)
                with urlopen(FIRMWARE_URL + name, timeout=25) as response:
                    firmware = response.read(100_000)
                if hashlib.sha256(firmware).hexdigest() != sha256:
                    raise OSError(f"La suma SHA-256 de {name} no coincide con la esperada.")
                source = Path(work) / name
                source.write_bytes(firmware)
                sources.append(str(source))
            subprocess.run([sudo, "/usr/bin/install", "-m", "0644", "-t", "/lib/firmware", *sources], check=True)
    modprobe = shutil.which("modprobe") or "/sbin/modprobe"
    try:
        subprocess.run([sudo, modprobe, "dvb_usb_af9035"], check=True)
    except subprocess.CalledProcessError as error:
        raise OSError("No se pudo cargar dvb_usb_af9035. Comprueba los módulos del kernel de Ubuntu.") from error
    print("Firmware preparado. Vuelve a conectar el sintonizador a Ubuntu y abre Arkham TV.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
