"""Use the Linux DVB driver for the AVerMedia A835 and A835B."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys

from .af9035 import FIRMWARE_SHA256, frequency_for, programs_from_transport
from .devices import USB_MODELS
from .audio_tracks import multiplex_metadata

FIRMWARE_BY_MODEL = {
    "A835": {"dvb-usb-af9035-02.fw": FIRMWARE_SHA256},
    # The driver selects the IT9135 firmware after reading the chip revision.
    "A835B": {
        "dvb-usb-it9135-01.fw": "2ce2f0da0054d64f14a5ec4a52f5e4ade2fcd9340f15df19516526eb3f6cae9a",
        "dvb-usb-it9135-02.fw": "65eb07f522b5f10f51bf70fa6ba758675b67da8982902a52b1331775a7159dec",
    },
}
HELPER = Path(__file__).resolve().parents[1] / "bin" / "arkham-dvb"


def usb_id(device):
    try:
        identifier = ":".join((device / key).read_text().strip().lower() for key in ("idVendor", "idProduct"))
    except OSError:
        return None
    return identifier if identifier in USB_MODELS else None


def find_tuner():
    for entry in sorted(Path("/sys/class/dvb").glob("dvb*.frontend*")):
        match = re.fullmatch(r"dvb(\d+)\.frontend(\d+)", entry.name)
        if not match:
            continue
        device = entry.resolve()
        identifier = next((identifier for parent in device.parents
                           if (identifier := usb_id(parent))), None)
        if identifier:
            adapter = Path("/dev/dvb") / f"adapter{match[1]}"
            return identifier, [adapter / (name + match[2]) for name in ("frontend", "demux", "dvr")]
    identifier = next((identifier for device in Path("/sys/bus/usb/devices").glob("*")
                       if (identifier := usb_id(device))), None)
    return identifier, []


def firmware_present(name):
    directory = Path("/lib/firmware")
    release = os.uname().release
    return any((folder / (name + suffix)).is_file()
               for folder in (directory, directory / release, directory / "updates", directory / "updates" / release)
               for suffix in ("", ".xz", ".zst"))


def probe():
    if os.environ.get("SNAP") and subprocess.run(
        ["snapctl", "is-connected", "dvb"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode:
        return {"usb": None, "ready": False, "message": "Activa el permiso de acceso DVB de Arkham TV en Ubuntu."}
    identifier, devices = find_tuner()
    model = USB_MODELS.get(identifier)
    if not identifier:
        message = "Conecta un AVerMedia A835 o A835B al USB de Ubuntu."
    elif not devices and not all(firmware_present(name) for name in FIRMWARE_BY_MODEL[model]):
        message = (f"Ubuntu necesita el firmware del {model}. Actualiza linux-firmware y vuelve a conectar el sintonizador."
                   if os.environ.get("SNAP") else
                   f"El {model} necesita firmware. Ejecuta arkham-tv --preparar y reconecta el USB.")
    elif not devices or not all(device.exists() for device in devices):
        message = f"Ubuntu aún no ha creado el dispositivo DVB. Reconecta el {model} y comprueba el módulo dvb_usb_af9035."
    elif not all(os.access(device, mode) for device, mode in zip(devices, (os.R_OK | os.W_OK, os.R_OK | os.W_OK, os.R_OK))):
        message = f"Tu usuario no tiene acceso al {model}. Comprueba el grupo video y vuelve a iniciar sesión."
    elif not os.access(HELPER, os.X_OK) or not all(shutil.which(tool) for tool in ("ffmpeg", "ffprobe")):
        message = "Faltan las herramientas de reproducción. Abre el ejecutable de Arkham TV para Ubuntu."
    else:
        return {"usb": identifier, "ready": True, "message": f"{model} conectado al controlador DVB de Ubuntu"}
    return {"usb": identifier, "ready": False, "message": message}


def main():
    parser = argparse.ArgumentParser(description="Sintonizador DVB-T de Arkham TV para Linux")
    parser.add_argument("action", choices=("scan", "stream", "guide"))
    parser.add_argument("channels", type=int, choices=range(21, 49), nargs="+")
    args = parser.parse_args()
    channels = args.channels
    if args.action == "scan":
        if len(channels) != 2 or channels[0] > channels[1]:
            parser.error("Especifica el rango UHF en orden ascendente.")
        channels = range(channels[0], channels[1] + 1)
    _, devices = find_tuner()
    if not devices:
        print(probe()["message"], file=sys.stderr)
        return 1
    command = [str(HELPER), *map(str, devices)]
    if args.action == "stream":
        if len(channels) != 1:
            parser.error("Especifica un único UHF.")
        os.execv(HELPER, [*command, str(channels[0]), "0"])

    def stop(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    services, programs, audio = {}, {}, {}
    guide = args.action == "guide"
    try:
        for channel in channels:
            print(f"UHF {channel}", file=sys.stderr, flush=True)
            capture = subprocess.run([*command, str(channel), "8" if guide else "3"], stdout=subprocess.PIPE, timeout=15)
            if capture.returncode == 2:
                continue
            if capture.returncode:
                return 1
            if guide:
                events, tracks = multiplex_metadata(capture.stdout, frequency_for(channel))
                programs.update(events)
                audio.update(tracks)
            elif capture.stdout:
                for service in programs_from_transport(capture.stdout, channel):
                    services[service["id"]] = service
                print(f"CHANNELS_FOUND {len(services)}", file=sys.stderr, flush=True)
    except KeyboardInterrupt:
        return 130
    except (OSError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        return 1
    result = ({"programs": programs, "audioTracks": audio} if guide else
              sorted(services.values(), key=lambda channel: channel["name"].casefold()))
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
