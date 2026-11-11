# SPDX-License-Identifier: GPL-2.0-or-later
# AF9035 / AF9033 / TDA18218 protocol adapted from Linux v6.12.
# Copyright (C) 2009–2012 Antti Palosaari <crope@iki.fi>
"""macOS user-space driver for the A835 with NXP TDA18218."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import ctypes as c
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from .tables import DEMOD_INIT, TDA18218_INIT

NATIVE = Path(__file__).resolve().parent
DATA = NATIVE.parent / ".datos"
BUNDLED_LIBRARY = os.environ.get("ARKHAM_USB_LIBRARY")
LIBRARY = Path(BUNDLED_LIBRARY) if BUNDLED_LIBRARY else DATA / "a835-usb.dylib"
FIRMWARE = Path(os.environ.get("ARKHAM_FIRMWARE", DATA / "dvb-usb-af9035-02.fw"))
FIRMWARE_SHA256 = "9e0d15915387b8bddaaf4db978d3f891c2fb34d0db165191e88443f909158c2f"
TS_FRAME = 87 * 188
USB_BUSY = "El A835 está en uso. Detén la reproducción o la búsqueda en la otra ventana."
TUNER_DEFAULTS = bytes.fromhex(
    "c0 88 00 8e 03 00 00 d0 00 40 00 00 07 ff 84 09 00 13 00 00"
    " 01 84 09 f0 19 0a 8e 69 98 01 00 58 10 40 8c 00 0c 48 85 c9"
    " a7 00 00 00 30 81 80 00 39 00 8a 00 00 00 00 00 00 f6 f6"
)
COEFF_8MHZ = bytes.fromhex(
    "01 ce 55 c9 00 e7 2a e4 00 73 99 0f 00 73 95 72 00 73"
    " 91 d5 00 39 ca b9 00 e7 2a e4 00 73 95 72 37 02 ce 01"
)


class USBError(OSError):
    pass


def check(result, action):
    if result:
        raise USBError(f"{action} · IOKit 0x{result & 0xffffffff:08x}")


def build():
    if BUNDLED_LIBRARY:
        if not LIBRARY.is_file():
            raise USBError("Falta el controlador USB incluido en Arkham TV.")
        return
    source = NATIVE / "usb.c"
    if LIBRARY.exists() and LIBRARY.stat().st_mtime >= source.stat().st_mtime:
        return
    LIBRARY.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="build-", dir=LIBRARY.parent) as work:
        output = Path(work) / LIBRARY.name
        subprocess.run(
            ["/usr/bin/clang", "-Wall", "-Wextra", "-dynamiclib", str(source),
             "-framework", "CoreFoundation", "-framework", "IOKit", "-o", str(output)],
            check=True,
        )
        output.replace(LIBRARY)


def checksum(packet):
    return (~sum(byte << (8 if i % 2 == 0 else 0)
                 for i, byte in enumerate(packet))) & 0xffff


class USB:
    def __init__(self):
        lib = self.lib = c.CDLL(str(LIBRARY))
        lib.a835_open.argtypes = [c.POINTER(c.c_void_p)]
        lib.a835_open.restype = c.c_int32
        lib.a835_close.argtypes = [c.c_void_p]
        lib.a835_close.restype = None
        lib.a835_reset_stream.argtypes = [c.c_void_p]
        lib.a835_reset_stream.restype = None
        lib.a835_write.argtypes = [c.c_void_p, c.c_void_p, c.c_uint32]
        lib.a835_write.restype = c.c_int32
        lib.a835_read.argtypes = [c.c_void_p, c.c_int, c.c_void_p, c.POINTER(c.c_uint32), c.c_uint32]
        lib.a835_read.restype = c.c_int32
        self.handle = c.c_void_p()
        self.seq = 0
        result = lib.a835_open(c.byref(self.handle))
        if result & 0xffffffff == 0xe00002c5:
            raise USBError(USB_BUSY)
        check(result, "No se pudo abrir el A835")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.lib.a835_close(self.handle)

    def read(self, size, *, transport=False, timeout=2000):
        buffer = c.create_string_buffer(size)
        actual = c.c_uint32(size)
        result = self.lib.a835_read(self.handle, transport, buffer, c.byref(actual), timeout)
        if transport and result & 0xffffffff in {0xe00002d6, 0xe0004051}:
            return buffer.raw[:actual.value]
        check(result, "Error de lectura USB")
        return buffer.raw[:actual.value]

    def command(self, cmd, data=b"", *, mailbox=0, size=0, ack=True):
        if len(data) > 58 or size > 59:
            raise ValueError("Longitud de comando AF9035")
        seq = self.seq
        self.seq = (seq + 1) & 0xff
        message = bytes((mailbox, cmd, seq)) + data
        packet = bytes((len(message) + 2,)) + message + checksum(message).to_bytes(2, "big")
        check(self.lib.a835_write(self.handle, packet, len(packet)), "Error de escritura USB")
        if not ack:
            return b""
        response = self.read(size + 5)
        if (len(response) != size + 5 or response[1] != seq
                or checksum(response[1:-2]) != int.from_bytes(response[-2:], "big")):
            raise USBError(f"Respuesta AF9035 inválida para el comando 0x{cmd:02x} · {response.hex()}")
        if response[2]:
            raise USBError(f"AF9035 rechazó el comando 0x{cmd:02x} · estado {response[2]}")
        return response[3:-2]

    def registers(self, address, size):
        payload = bytes((size, 2, 0, 0, (address >> 8) & 255, address & 255))
        return self.command(0x00, payload, mailbox=address >> 16, size=size)

    def firmware_version(self):
        return self.command(0x22, b"\x01", size=4)

    def identify(self):
        version, low, high = self.registers(0x1222, 3)
        eeprom = self.registers(0x42f5 + 0x31, 12)
        return {"chip": f"{high:02x}{low:02x}", "version": version,
                "mode": eeprom[0], "tuner": eeprom[11],
                "firmware": ".".join(map(str, self.firmware_version()))}

    def write_registers(self, address, data):
        header = bytes((len(data), 2, 0, 0, (address >> 8) & 255, address & 255))
        self.command(0x01, header + data, mailbox=address >> 16)

    def register(self, address):
        return self.registers(address, 1)[0]

    def set_register(self, address, value, mask=0xff):
        if mask != 0xff:
            value = (self.register(address) & ~mask) | (value & mask)
        self.write_registers(address, bytes((value,)))

    def write_table(self, entries):
        start = None
        data = bytearray()
        for address, value in entries:
            if start is not None and (address != start + len(data) or len(data) == 40):
                self.write_registers(start, data)
                data.clear()
            if not data:
                start = address
            data.append(value)
        if data:
            self.write_registers(start, data)

    def upload_firmware(self):
        try:
            firmware = FIRMWARE.read_bytes()
        except FileNotFoundError as error:
            raise USBError("Falta el firmware AF9035. Ejecuta preparar.command.") from error
        if hashlib.sha256(firmware).hexdigest() != FIRMWARE_SHA256:
            raise USBError("El firmware AF9035 no coincide con la suma SHA-256 esperada.")
        offset = 0
        while offset < len(firmware):
            header = firmware[offset:offset + 7]
            end = offset + 7 + int.from_bytes(header[3:5], "big")
            if len(header) != 7 or header[0] not in {1, 2} or end > len(firmware):
                raise USBError("Bloque de firmware AF9035 inválido.")
            self.command(0x24)
            for cursor in range(offset, end, 58):
                self.command(0x21, firmware[cursor:min(cursor + 58, end)], ack=False)
            self.command(0x25)
            offset = end
        self.command(0x23)
        if not any(self.firmware_version()):
            raise USBError("El AF9035 no arrancó después de cargar el firmware.")

    @contextmanager
    def tuner_gate(self):
        self.set_register(0x00fa04, 1, 1)
        try:
            yield
        finally:
            self.set_register(0x00fa04, 0, 1)

    def tuner_write(self, register, values):
        for start in range(0, len(values), 20):
            block = bytes((register + start,)) + values[start:start + 20]
            self.command(0x03, bytes((len(block), 0xc0, 0, 0, 0)) + block)

    def initialize(self):
        details = self.identify()
        if details["chip"] != "3802" or details["mode"] != 0 or details["tuner"] != 0xa1:
            raise USBError("La revisión USB no coincide con el AF9035/TDA18218 implementado.")
        if details["firmware"] == "0.0.0.0":
            self.upload_firmware()
        if self.register(0x00d800) & 0x0f != 11:
            raise USBError("El reloj del AF9035 no coincide con la configuración de 12 MHz.")

        for register, value, mask in (
            (0x80f99d, 1, 1), (0x80f9a4, 1, 1), (0x00dd11, 0, 0x60),
            (0x00dd13, 0, 0x60), (0x00dd11, 0x20, 0x20), (0x80f9a3, 0, 1),
            (0x80f9cd, 0, 1),
        ):
            self.set_register(register, value, mask)
        frame_words = (TS_FRAME // 4).to_bytes(2, "little")
        self.write_registers(0x00dd88, frame_words * 2)
        self.write_registers(0x00dd0c, bytes((128, 128)))
        self.set_register(0x80f99d, 0, 1)
        self.set_register(0x80f9a4, 0, 1)

        self.write_registers(0x800025, (12_000_000 * 0x80000 // 1_000_000).to_bytes(4, "little"))
        self.write_registers(0x80f1cd, (20_250_000 * 0x80000 // 1_000_000).to_bytes(3, "little"))
        for register, value, mask in (
            (0x80fb24, 0, 8), (0x80004c, 0, 255), (0x00f641, 0xa1, 255),
            (0x80f5ca, 1, 1), (0x80f715, 1, 1), (0x00f41f, 4, 4), (0x00f41a, 1, 1),
            (0x80f731, 0, 1), (0x00d91e, 0, 1), (0x00d919, 0, 1), (0x80f732, 0, 1),
            (0x00d91f, 0, 1), (0x00d91a, 0, 1), (0x80f730, 0, 1), (0x80f778, 0, 255),
            (0x80f73c, 1, 1), (0x80f776, 0, 1), (0x00d8fd, 1, 255), (0x00d830, 1, 255),
            (0x00d831, 0, 255), (0x00d832, 0, 255), (0x80f985, 0, 1), (0x80f986, 0, 1),
            (0x00d827, 0, 255), (0x00d829, 0, 255), (0x800045, 1, 255),
            (0x80f9a5, 0, 1), (0x80f9b5, 1, 1), (0x80f993, 0, 1),
        ):
            self.set_register(register, value, mask)
        self.write_table(DEMOD_INIT)
        self.write_table(TDA18218_INIT)

        with self.tuner_gate():
            tuner_id = self.command(0x02, bytes((1, 0xc0, 1, 0, 0)), size=1)[0]
            if tuner_id != 0xc0:
                raise USBError(f"El sintonizador NXP no respondió con el ID esperado: 0x{tuner_id:02x}.")
            self.tuner_write(0, TUNER_DEFAULTS)
        self.write_registers(0x800001, COEFF_8MHZ)
        if_word = (4_000_000 * 0x800000 + 20_250_000) // 40_500_000
        self.write_registers(0x800029, if_word.to_bytes(3, "little"))
        return self.identify()

    def tune(self, frequency):
        self.lib.a835_reset_stream(self.handle)
        lo_khz = (frequency + 4_000_000) // 1000
        with self.tuner_gate():
            self.tuner_write(0x1a, bytes(((TUNER_DEFAULTS[0x1a] & ~7) | 6,
                                         (TUNER_DEFAULTS[0x1b] & ~3) | 2,
                                         TUNER_DEFAULTS[0x1c])))
            self.tuner_write(0x0a, bytes((lo_khz >> 12, (lo_khz >> 4) & 255,
                                         ((lo_khz & 15) << 4) | (TUNER_DEFAULTS[0x0c] & 15))))
            self.tuner_write(0x0f, bytes((TUNER_DEFAULTS[0x0f] | 0x40,)))
            self.tuner_write(0x0f, bytes((TUNER_DEFAULTS[0x0f] & ~0x40,)))
            for reg, value in (
                (0x20, 0x60), (0x23, 0x02), (0x20, 0xa0), (0x23, 0x09),
                (0x20, 0xe0), (0x23, 0x0c), (0x20, 0x40), (0x23, 0x01),
                (0x20, 0x80), (0x23, 0x08), (0x20, 0xc0), (0x23, 0x0b),
                (0x24, 0x1c), (0x24, 0x0c),
            ):
                self.tuner_write(reg, bytes((value,)))
        self.set_register(0x80f904, 2, 3)
        self.set_register(0x800040, 0)
        self.set_register(0x800047, 0)
        self.set_register(0x80f999, 0, 1)
        self.set_register(0x80004b, 1)
        self.set_register(0x800000, 0)

    def lock_signal(self, seconds=3):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.register(0x80f999) & 1:
                return True
            time.sleep(0.12)
        return False

    def transport(self):
        return self.read(TS_FRAME, transport=True, timeout=600)


def frequency_for(channel):
    return 474_000_000 + (channel - 21) * 8_000_000


def programs_from_transport(transport, channel):
    from .channels import clean_channel_name
    from .audio_tracks import multiplex_metadata

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-f", "mpegts", "-analyzeduration", "3500000",
         "-probesize", "12000000", "-show_programs", "-of", "json", "-i", "pipe:0"],
        input=transport, capture_output=True, timeout=10,
    )
    if probe.returncode:
        return []
    services = []
    frequency = frequency_for(channel)
    guide, tracks = multiplex_metadata(transport, frequency)
    for program in json.loads(probe.stdout).get("programs", []):
        service = program["program_id"]
        video = next((stream for stream in program.get("streams", []) if stream.get("codec_type") == "video"), None)
        if not 1 <= service <= 65535 or video is None:
            continue
        name = clean_channel_name(program.get("tags", {}).get("service_name", "")) or f"Servicio {service}"
        identifier = f"{frequency}-{service}"
        entry = {"id": identifier, "name": name, "frequency": frequency,
                 "uhf": channel, "sid": service, "programs": guide.get(identifier, [])}
        if video.get("width", 0) > 0 and video.get("height", 0) > 0:
            entry.update(width=video["width"], height=video["height"])
        if identifier in tracks:
            entry["audioTracks"] = tracks[identifier]
        services.append(entry)
    return services


def sample(usb, channel, seconds):
    print(f"UHF {channel}", file=sys.stderr, flush=True)
    usb.tune(frequency_for(channel))
    data = bytearray()
    locked = usb.lock_signal()
    print("RF LOCKED" if locked else "RF LOST", file=sys.stderr, flush=True)
    if locked:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            data.extend(usb.transport())
    return data


def scan(usb, first, last):
    services = {}
    for channel in range(first, last + 1):
        data = sample(usb, channel, 3)
        if data:
            for service in programs_from_transport(data, channel):
                services[service["id"]] = service
            print(f"CHANNELS_FOUND {len(services)}", file=sys.stderr, flush=True)
    return sorted(services.values(), key=lambda service: service["name"].casefold())


def main():
    parser = argparse.ArgumentParser(description="Controlador USB nativo del AVerMedia A835")
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("probe")
    actions.add_parser("init")
    scan_args = actions.add_parser("scan")
    scan_args.add_argument("first", type=int, choices=range(21, 49), metavar="UHF_INICIAL")
    scan_args.add_argument("last", type=int, choices=range(21, 49), metavar="UHF_FINAL")
    stream_args = actions.add_parser("stream")
    stream_args.add_argument("channel", type=int, choices=range(21, 49), metavar="UHF")
    guide_args = actions.add_parser("guide")
    guide_args.add_argument("channels", type=int, choices=range(21, 49), nargs="+", metavar="UHF")
    args = parser.parse_args()
    if args.action == "scan" and args.first > args.last:
        parser.error("El canal inicial debe ser menor o igual al final.")
    try:
        build()
        with USB() as usb:
            if args.action == "probe":
                print(json.dumps(usb.identify()))
                return
            details = usb.initialize()
            if args.action == "init":
                print(json.dumps(details))
            elif args.action == "scan":
                print(json.dumps(scan(usb, args.first, args.last), ensure_ascii=False))
            elif args.action == "guide":
                from .audio_tracks import multiplex_metadata

                programs, audio = {}, {}
                for channel in args.channels:
                    events, tracks = multiplex_metadata(sample(usb, channel, 8), frequency_for(channel))
                    programs.update(events)
                    audio.update(tracks)
                print(json.dumps({"programs": programs, "audioTracks": audio}, ensure_ascii=False))
            else:
                usb.tune(frequency_for(args.channel))
                if not usb.lock_signal(5):
                    print("RF LOST", file=sys.stderr, flush=True)
                    raise USBError(f"No se obtuvo señal DVB-T en UHF {args.channel}.")
                print("RF LOCKED", file=sys.stderr, flush=True)
                locked = True
                next_check = time.monotonic() + 1
                while True:
                    sys.stdout.buffer.write(usb.transport())
                    sys.stdout.buffer.flush()
                    now = time.monotonic()
                    if now >= next_check:
                        signal_locked = bool(usb.register(0x80f999) & 1)
                        if signal_locked != locked:
                            print("RF LOCKED" if signal_locked else "RF LOST", file=sys.stderr, flush=True)
                            locked = signal_locked
                        next_check = now + 1
    except BrokenPipeError:
        sys.stdout = None
    except (OSError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
