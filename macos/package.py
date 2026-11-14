#!/usr/bin/env python3
"""Package a universal Arkham TV app from the official Python and FFmpeg builds."""
import argparse
import hashlib
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from native.changelog import release_version

PYTHON_VERSION = "3.13"
ARCHITECTURES = ("arm64", "x86_64")
MIN_MACOS = "12.3"
PYTHON_INSTALL_NAME = "/Library/Frameworks/Python.framework/Versions/3.13/Python"
LIBRARY_PREFIX = "/Library/Frameworks/Python.framework/Versions/3.13/lib/"
FIRMWARE_SHA = "9e0d15915387b8bddaaf4db978d3f891c2fb34d0db165191e88443f909158c2f"


def command(*args):
    subprocess.run(args, check=True)


def sign(path):
    subprocess.run(
        ["/usr/bin/codesign", "--force", "--sign", "-", path],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )

def stamp_bundle(bundle):
    # Finder reads the outer directory's date, which a copy can inherit.
    info = (bundle / "Contents/Info.plist").stat()
    os.utime(bundle, ns=(info.st_atime_ns, info.st_mtime_ns))


def make_icon(destination, size=1024):
    logo = Image.open(ROOT / "assets/logo_arkhamtv.png").convert("RGBA")
    left, top, _, bottom = logo.getbbox()
    # The symbol is the square at the left edge of the wordmark.
    octopus = logo.crop((left, top, left + bottom - top, bottom))
    canvas = Image.new("RGBA", (1024, 1024))
    ImageDraw.Draw(canvas).rounded_rectangle((76, 76, 947, 947), 192, fill=(17, 27, 21, 255))
    art = octopus.resize((628, 628), Image.Resampling.LANCZOS)
    canvas.alpha_composite(art, (198, 198))
    canvas.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas.save(destination)


def bundle_python(source, contents):
    helpers = contents / "Helpers"
    frameworks = contents / "Frameworks"
    framework = frameworks / "Python.framework"
    target = framework / "Versions" / PYTHON_VERSION
    target.mkdir(parents=True)
    (target / "lib").mkdir()
    (target / "Resources").mkdir()
    shutil.copy2(source / "Resources/Info.plist", target / "Resources/Info.plist")
    shutil.copy2(source / "Python", target / "Python")
    command("/usr/bin/install_name_tool", "-id", "@rpath/Python.framework/Versions/3.13/Python",
            target / "Python")

    stdlib = f"lib/python{PYTHON_VERSION}"
    shutil.copytree(source / stdlib, target / stdlib, ignore=shutil.ignore_patterns(
        "__pycache__", "test", "tests", "idlelib", "ensurepip", "tkinter", "turtledemo",
        "config-*", "_tkinter.*", "site-packages",
    ))
    libraries = sorted(path for path in (source / "lib").glob("*.dylib") if not path.is_symlink())
    modules = sorted((target / stdlib / "lib-dynload").glob("*.so"))

    for path in libraries:
        target_lib = target / "lib" / path.name
        shutil.copy2(path, target_lib)
        command("/usr/bin/install_name_tool", "-id", "@rpath/" + path.name, target_lib)
        for dependency in linked_libraries(target_lib, LIBRARY_PREFIX):
            command("/usr/bin/install_name_tool", "-change", dependency,
                    "@loader_path/" + Path(dependency).name, target_lib)
        sign(target_lib)
    for module in modules:
        for dependency in linked_libraries(module, LIBRARY_PREFIX):
            command("/usr/bin/install_name_tool", "-change", dependency,
                    "@loader_path/../../" + Path(dependency).name, module)
        sign(module)

    (framework / "Versions/Current").symlink_to(PYTHON_VERSION)
    (framework / "Python").symlink_to("Versions/Current/Python")
    (framework / "Resources").symlink_to("Versions/Current/Resources")
    (frameworks / "libpython.dylib").symlink_to("Python.framework/Versions/3.13/Python")

    python = helpers / "python3"
    shutil.copy2(source / "Resources/Python.app/Contents/MacOS/Python", python)
    command("/usr/bin/install_name_tool", "-change", PYTHON_INSTALL_NAME,
            "@loader_path/../Frameworks/libpython.dylib", python)
    sign(target / "Python")
    sign(framework)
    sign(python)


def linked_libraries(path, prefix):
    links = subprocess.check_output(["/usr/bin/otool", "-L", path], text=True)
    return sorted({line.strip().split(" (", 1)[0] for line in links.splitlines()
                   if line.strip().startswith(prefix)})


def compile_native(work, destination):
    sdk = subprocess.check_output(["/usr/bin/xcrun", "--show-sdk-path"], text=True).strip()
    binaries, libraries = [], []
    for arch in ARCHITECTURES:
        binary = work / f"ArkhamTV-{arch}"
        library = work / f"a835-usb-{arch}.dylib"
        target = f"{arch}-apple-macosx{MIN_MACOS}"
        command("/usr/bin/swiftc", "-swift-version", "5", "-O", "-target", target, "-sdk", sdk,
                "-module-cache-path", work / "swift-cache", ROOT / "macos/ArkhamTV.swift", "-o", binary)
        command("/usr/bin/clang", "-target", target, "-isysroot", sdk, "-O2", "-dynamiclib",
                ROOT / "native/usb.c", "-framework", "CoreFoundation", "-framework", "IOKit",
                "-install_name", "@rpath/a835-usb.dylib", "-o", library)
        binaries.append(binary)
        libraries.append(library)
    command("/usr/bin/lipo", "-create", *binaries, "-output", destination / "MacOS/ArkhamTV")
    usb = destination / "Frameworks/a835-usb.dylib"
    command("/usr/bin/lipo", "-create", *libraries, "-output", usb)
    sign(usb)


def verify_bundle(contents):
    codes = [
        contents / "MacOS/ArkhamTV", contents / "Helpers/python3",
        contents / "Helpers/ffmpeg", contents / "Helpers/ffprobe",
        contents / "Frameworks/a835-usb.dylib",
        contents / "Frameworks/Python.framework/Python",
    ]
    codes.extend((contents / "Frameworks/Python.framework/Versions/3.13/lib").glob("*.dylib"))
    codes.extend((contents / "Frameworks/Python.framework/Versions/3.13/lib/python3.13/lib-dynload").glob("*.so"))
    for path in codes:
        archs = subprocess.check_output(["/usr/bin/lipo", "-archs", path], text=True).split()
        if not set(ARCHITECTURES).issubset(archs):
            raise RuntimeError(f"Falta una arquitectura en {path.name}")
    command("/usr/bin/codesign", "--verify", "--deep", "--strict", contents.parent)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dependencies", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    version = release_version(ROOT)
    dependencies = args.dependencies.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="arkham-package-", dir=output) as workspace:
        work = Path(workspace)
        bundle = work / "Arkham TV.app"
        contents = bundle / "Contents"
        resources = contents / "Resources"
        for folder in (contents / "MacOS", contents / "Helpers", contents / "Frameworks", resources):
            folder.mkdir(parents=True, exist_ok=True)
        with (ROOT / "macos/Info.plist").open("rb") as template:
            info = plistlib.load(template)
        info["CFBundleShortVersionString"] = version
        with (contents / "Info.plist").open("wb") as plist:
            plistlib.dump(info, plist)
        make_icon(resources / "ArkhamTV.icns")
        compile_native(work, contents)
        bundle_python(dependencies / "python-expanded/Python_Framework.pkg/Payload/Versions/3.13", contents)
        for tool in ("ffmpeg", "ffprobe"):
            shutil.copy2(dependencies / "ffmpeg-built" / tool, contents / "Helpers" / tool)
            sign(contents / "Helpers" / tool)

        code = resources / "arkham"
        code.mkdir()
        shutil.copy2(ROOT / "app.py", code)
        for folder in ("web", "assets", "native"):
            shutil.copytree(ROOT / folder, code / folder,
                            ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"))
        firmware = ROOT / ".datos/dvb-usb-af9035-02.fw"
        if hashlib.sha256(firmware.read_bytes()).hexdigest() != FIRMWARE_SHA:
            raise RuntimeError("El firmware AF9035 no coincide con su SHA-256.")
        shutil.copy2(firmware, resources)

        licenses = resources / "Licenses"
        licenses.mkdir()
        shutil.copy2(dependencies / "ffmpeg-8.1.2/COPYING.LGPLv2.1", licenses)
        shutil.copy2(dependencies / "ffmpeg-8.1.2.tar.xz", licenses)
        shutil.copy2(ROOT / "macos/build-ffmpeg.sh", licenses)
        shutil.copy2(ROOT / "macos/avfoundation-audio-queue.patch", licenses)
        (licenses / "Fuentes.txt").write_text(
            "FFmpeg 8.1.2 (LGPL 2.1 o posterior) · https://ffmpeg.org/releases/\n"
            "Python 3.13.14 · https://www.python.org/downloads/release/python-31314/\n"
            "AF9035 · https://github.com/LibreELEC/dvb-firmware\n"
            "Controlador USB · Contents/Resources/arkham/native/LICENSE\n"
            "HLS.js · Contents/Resources/arkham/web/HLS-LICENSE\n", encoding="utf-8",
        )
        sign(bundle)
        stamp_bundle(bundle)
        verify_bundle(contents)

        archive = work / "Arkham-TV-macOS-Universal.zip"
        command("/usr/bin/ditto", "-c", "-k", "--keepParent", bundle, archive)
        app_output = output / bundle.name
        if app_output.exists():
            app_output.rename(work / "Anterior.app")
        bundle.rename(app_output)
        archive.replace(output / archive.name)
    print(app_output)
    print(output / archive.name)


if __name__ == "__main__":
    main()
