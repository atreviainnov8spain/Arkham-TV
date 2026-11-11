#!/usr/bin/env python3
"""Build a portable executable and a Debian package for Ubuntu Desktop."""

import argparse
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from native.changelog import release_version

ARCHITECTURES = {"x86_64": 62, "aarch64": 183}
ICON = ROOT / "assets/arkhamtv-icon.png"
DESKTOP_ENTRY = ROOT / "linux/com.arkhamtv.desktop.desktop"


def verify_elf(path, arch):
    with path.open("rb") as binary:
        header = binary.read(64)
        if header[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<HH", header, 16) != (2, ARCHITECTURES[arch]):
            raise ValueError(f"{path.name} no es un ejecutable ELF de {arch}.")
        offset, = struct.unpack_from("<Q", header, 32)
        size, count = struct.unpack_from("<HH", header, 54)
        for i in range(count):
            binary.seek(offset + size * i)
            if binary.read(4) == b"\x03\x00\x00\x00":
                raise ValueError(f"{path.name} depende de un cargador dinámico.")


def archive_filter(member):
    if any(part in {".DS_Store", "__pycache__"} for part in Path(member.name).parts):
        return None
    return member


def deb_member(member):
    member.uid = member.gid = 0
    member.uname = member.gname = "root"
    return member


def package_deb(zig, work, executable, arch, version):
    (work / "debian-binary").write_bytes(b"2.0\n")
    control = work / "control"
    installed_size = sum((path.stat().st_size + 1023) // 1024 for path in (executable, DESKTOP_ENTRY, ICON))
    control.write_text(
        f"Package: arkham-tv\nVersion: {version}\nArchitecture: {arch}\n"
        f"Installed-Size: {installed_size}\n"
        "Section: video\nPriority: optional\nMaintainer: Óscar Peña\n"
        "Depends: python3, python3-gi, gir1.2-gtk-3.0, gir1.2-gstreamer-1.0, "
        "gir1.2-webkit2-4.1, gstreamer1.0-plugins-good, gstreamer1.0-plugins-bad, "
        "gstreamer1.0-libav, util-linux\n"
        "Description: Digital terrestrial television for Ubuntu\n"
        " Arkham TV scans and plays DVB-T channels in a GTK window.\n",
        encoding="utf-8",
    )
    with tarfile.open(work / "control.tar.gz", "w:gz", format=tarfile.USTAR_FORMAT) as archive:
        archive.add(control, "./control", filter=deb_member)
    with tarfile.open(work / "data.tar.gz", "w:gz", format=tarfile.USTAR_FORMAT, compresslevel=1) as archive:
        archive.add(executable, "./usr/bin/arkham-tv", filter=deb_member)
        archive.add(DESKTOP_ENTRY, f"./usr/share/applications/{DESKTOP_ENTRY.name}", filter=deb_member)
        archive.add(ICON, "./usr/share/icons/hicolor/512x512/apps/com.arkhamtv.desktop.png", filter=deb_member)

    destination = executable.with_name(f"{executable.name}.deb")
    with tempfile.TemporaryDirectory(dir=executable.parent, prefix=".arkham-") as staging:
        deb = Path(staging).resolve() / destination.name
        subprocess.run([str(zig), "ar", "--format=gnu", "-rc", str(deb),
                        "debian-binary", "control.tar.gz", "data.tar.gz"], cwd=work, check=True)
        deb.replace(destination)
    print(destination, flush=True)


def package(args, arch, version):
    with tempfile.TemporaryDirectory(prefix="arkham-ubuntu-") as directory:
        work = Path(directory)
        environment = {**os.environ, "ZIG_GLOBAL_CACHE_DIR": str(args.media / "zig-cache"),
                       "ZIG_LOCAL_CACHE_DIR": str(work / "zig-cache")}

        def compile_elf(source, output):
            subprocess.run([str(args.zig), "cc", "-target", f"{arch}-linux-musl", "-O2",
                            "-static", "-no-pie", "-s", "-Wall", "-Wextra", "-Werror",
                            "-I", str(work), str(ROOT / "linux" / source), "-o", str(output)],
                           check=True, env=environment)
            verify_elf(output, arch)

        helper = work / "arkham-dvb"
        compile_elf("dvb.c", helper)
        payload = work / "payload.tar.gz"
        with tarfile.open(payload, "w:gz", compresslevel=5) as archive:
            for name in ("app.py", "assets", "web", "native"):
                archive.add(ROOT / name, name, filter=archive_filter)
            archive.add(ROOT / "linux/preparar.py", "preparar.py")
            archive.add(ROOT / "linux/desktop.py", "desktop.py")
            archive.add(helper, "bin/arkham-dvb")
            for name in ("ffmpeg", "ffprobe"):
                tool = args.media / arch / "bin" / name
                verify_elf(tool, arch)
                archive.add(tool, f"bin/{name}")
            archive.add(args.ffmpeg_source, "sources/" + args.ffmpeg_source.name)
            archive.add(args.x264_source, "sources/" + args.x264_source.name)
            archive.add(ROOT / "linux", "sources/linux", filter=archive_filter)
            archive.add(ROOT / "native/LICENSE", "sources/COPYING.GPLv2")
            archive.add(args.zig.parent / "lib/libc/musl/COPYRIGHT", "sources/COPYRIGHT-musl")
            archive.add(args.zig.parent / "LICENSE", "sources/LICENSE-Zig")

        script = (ROOT / "linux/launch.sh").read_text(encoding="utf-8")
        (work / "payload.h").write_text(
            f"#define ARKHAM_PAYLOAD_SIZE \"{payload.stat().st_size}\"\n"
            f"#define ARKHAM_SCRIPT {json.dumps(script, ensure_ascii=False)}\n", encoding="utf-8")
        launcher = work / "launcher"
        compile_elf("launcher.c", launcher)
        label = {"x86_64": "Intel-x86_64", "aarch64": "ARM64"}[arch]
        destination = args.output / f"Arkham-TV-{version}-Ubuntu-{label}"
        with tempfile.NamedTemporaryFile(dir=args.output, prefix=".arkham-", delete=False) as binary:
            pending = Path(binary.name)
            for part in (launcher, payload):
                with part.open("rb") as source:
                    shutil.copyfileobj(source, binary)
        pending.chmod(0o755)
        pending.replace(destination)
        print(destination, flush=True)
        deb_arch = {"x86_64": "amd64", "aarch64": "arm64"}[arch]
        package_deb(args.zig, work, destination, deb_arch, version)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zig", type=lambda value: Path(value).resolve())
    parser.add_argument("media", type=lambda value: Path(value).resolve())
    parser.add_argument("ffmpeg_source", type=Path)
    parser.add_argument("x264_source", type=Path)
    parser.add_argument("--arch", choices=ARCHITECTURES)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    version = release_version(ROOT)
    args.output.mkdir(parents=True, exist_ok=True)
    for arch in (args.arch,) if args.arch else ARCHITECTURES:
        package(args, arch, version)


if __name__ == "__main__":
    main()
