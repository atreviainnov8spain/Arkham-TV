"""Pack the Ubuntu edition and its redistributable runtime files on Linux."""

import argparse
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ARCHITECTURES = {"arm64": (183, "aarch64-linux-gnu"), "amd64": (62, "x86_64-linux-gnu")}
SUMMARY = "Watch and record live TV on Linux with a tuner or USB HDMI capture"
LICENSE = "GPL-2.0-or-later"
DESCRIPTION_LIMIT = 4096


def unpack_application(portable, architecture, application):
    content = portable.read_bytes()
    if content[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", content, 18)[0] != architecture:
        raise ValueError("El ejecutable portátil no corresponde a la arquitectura solicitada.")
    table = struct.unpack_from("<Q", content, 40)[0]
    entry_size, count = struct.unpack_from("<HH", content, 58)
    offset = table + entry_size * count
    with tarfile.open(fileobj=io.BytesIO(content[offset:]), mode="r:gz") as archive:
        archive.extractall(application, filter="data")
    # The data filter leaves directory modes to the packer's umask.
    # A system-installed Snap must let desktop users traverse its payload.
    application.chmod(0o755)
    for folder in application.rglob("*"):
        if folder.is_dir() and not folder.is_symlink():
            folder.chmod(0o755)


def add_codecs(downloads, root, triplet):
    plugins = root / "lib/gstreamer-1.0"
    plugins.mkdir(parents=True)
    plugin_packages = {
        "gstreamer1.0-libav": "libgstlibav.so",
        "gstreamer1.0-plugins-bad": "libgstvideoparsersbad.so",
    }
    tool_packages = {"gstreamer1.0-tools": "gst-launch-1.0", "pulseaudio-utils": "pactl"}
    required = set(plugin_packages) | set(tool_packages) | {"libavfilter9"}
    source_names = set()
    for binary in sorted(downloads.glob("*.deb")):
        package = binary.name.split("_", 1)[0]
        required.discard(package)
        source = subprocess.check_output(
            ["dpkg-deb", "-f", binary, "Source"], text=True,
        ).split()
        source_names.add(source[0] if source else package)
        with tempfile.TemporaryDirectory() as temporary:
            files = Path(temporary)
            subprocess.run(["dpkg-deb", "-x", binary, files], check=True)
            library = files / f"usr/lib/{triplet}"
            if plugin := plugin_packages.get(package):
                shutil.copy2(library / "gstreamer-1.0" / plugin, plugins)
            elif tool := tool_packages.get(package):
                shutil.copy2(files / "usr/bin" / tool, root / "app/bin")
            else:
                shared_objects = sorted(library.rglob("*.so.*"))
                if not shared_objects:
                    raise ValueError(f"No se encontraron bibliotecas en {package}.")
                for shared_object in shared_objects:
                    shutil.copy2(shared_object, root / "lib", follow_symlinks=False)
            shutil.copy2(files / f"usr/share/doc/{package}/copyright",
                         root / f"app/sources/{package}.copyright")
    sources = [*downloads.glob("*.dsc"), *downloads.glob("*.tar.*")]
    missing_sources = source_names - {path.name.split("_", 1)[0] for path in downloads.glob("*.dsc")}
    if required or missing_sources:
        raise ValueError("Faltan los paquetes de códecs o sus fuentes: "
                         + ", ".join(sorted(required | missing_sources)))
    for source in sources:
        shutil.copy2(source, root / "app/sources" / source.name)


def description(application):
    assets = application / "assets"
    history = json.loads((assets / "changelog.json").read_text(encoding="utf-8"))
    english = json.loads((assets / "changelog.en.json").read_text(encoding="utf-8"))
    introduction = (HERE / "description.txt").read_text(encoding="utf-8").strip()
    footer = "Open Changelog in Arkham TV to see the full release history."
    sections = [introduction, "", "Recent changes"]
    for release in history[:3]:
        version = release["version"]
        title, *notes = english[version]
        entry = [version + " · " + title, *("• " + note for note in notes)]
        if len("\n".join([*sections, *entry, footer]).encode("utf-8")) > DESCRIPTION_LIMIT:
            if len(sections) == 3:
                raise ValueError(f"Snap description with release {version} exceeds {DESCRIPTION_LIMIT} bytes.")
            break
        sections.extend(entry)
    return "\n".join([*sections, footer])


def make_manifest(application, architecture, triplet):
    version = (application / "assets/version.txt").read_text(encoding="utf-8").strip()
    text = description(application)
    formatted = "\n".join("  " + line for line in text.splitlines())
    return f"""name: arkham-tv
version: '{version}'
title: Arkham TV
summary: {SUMMARY}
description: |
{formatted}
license: {LICENSE}
base: core24
grade: stable
confinement: strict
architectures:
  - {architecture}
plugs:
  gnome-46-2404:
    interface: content
    target: $SNAP/gnome-platform
    default-provider: gnome-46-2404
  gpu-2404:
    interface: content
    target: $SNAP/gpu
    default-provider: mesa-2404
layout:
  /var/tmp:
    bind: $SNAP_COMMON/webkit-media-cache
  /usr/lib/{triplet}/webkit2gtk-4.1:
    bind: $SNAP/gnome-platform/usr/lib/{triplet}/webkit2gtk-4.1
apps:
  arkham-tv:
    command: bin/run
    plugs:
      - gnome-46-2404
      - gpu-2404
      - desktop
      - desktop-legacy
      - gsettings
      - wayland
      - x11
      - opengl
      - audio-playback
      - audio-record
      - camera
      - network
      - network-bind
      - home
      - dvb
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("architecture", choices=ARCHITECTURES)
    parser.add_argument("portable", type=Path)
    parser.add_argument("codecs", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    architecture, triplet = ARCHITECTURES[args.architecture]
    os.umask(0o022)
    args.output.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="arkham-snap-") as staging:
        root = Path(staging)
        root.chmod(0o755)
        application = root / "app"
        unpack_application(args.portable, architecture, application)
        subprocess.run(["sh", str(HERE / "hdmi-helper/build.sh"), str(application / "arkham-tv-hdmi.deb")],
                       check=True)
        add_codecs(args.codecs, root, triplet)
        gui = root / "meta/gui"
        gui.mkdir(parents=True)
        hooks = root / "meta/hooks"
        hooks.mkdir()
        shutil.copy2(HERE / "configure", hooks)
        (hooks / "configure").chmod(0o755)
        (root / "bin").mkdir()
        (root / "gnome-platform").mkdir()
        (root / "gpu").mkdir()
        shutil.copy2(HERE / "run", root / "bin/run")
        shutil.copy2(HERE / "arkham-tv.desktop", gui)
        shutil.copy2(application / "assets/arkhamtv-icon.png", gui / "icon.png")
        shutil.copy2(HERE.parent / "LICENSE.md", application)
        shutil.copytree(HERE, application / "sources/snap",
                        ignore=shutil.ignore_patterns("store", "__pycache__"))
        (root / "meta/snap.yaml").write_text(
            make_manifest(application, args.architecture, triplet), encoding="utf-8",
        )
        subprocess.run(["snap", "pack", str(root), str(args.output)], check=True)


if __name__ == "__main__":
    main()
