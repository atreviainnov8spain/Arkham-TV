#!/usr/bin/env python3
"""Fetch the pinned CPU speech runtime for Linux or universal macOS."""

import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

PACKAGES = {
    "aarch64": ("sherpa-onnx-v2.0.2-linux-aarch64-shared-cpu",
                "5c715c43c8b2a9e591a7146f6a397419780dc2af78921ed9d36d993333317d43"),
    "x86_64": ("sherpa-onnx-v2.0.2-linux-x64-shared-no-tts",
               "c6725b8994a5e559678f72ddffbf1c14b41fc3f6f650618b98eeb61581b63da2"),
}
LICENSES = Path(__file__).with_name("speech_licenses")
MAC_PACKAGE = ("sherpa-onnx-v2.0.2-osx-universal2-shared-no-tts",
               "282ed64d37b0885505637521686a50c9a9d6171320d01566f87a3190817de4dd")


def fetch(url, path):
    subprocess.run(["curl", "-fsSL", "--retry", "2", "--max-time", "180", url, "-o", str(path)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("helpers", type=Path)
    parser.add_argument("--platform", choices=("linux", "macos"),
                        default="macos" if sys.platform == "darwin" else "linux")
    args = parser.parse_args()
    packages = {"universal": MAC_PACKAGE} if args.platform == "macos" else PACKAGES
    for arch, (name, digest) in packages.items():
        destination = args.helpers / "sherpa" if args.platform == "macos" else args.helpers / arch / "bin/sherpa"
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="speech-runtime-", dir=destination.parent) as folder:
            temporary = Path(folder)
            archive = temporary / "runtime.tar.bz2"
            fetch(f"https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.2/{name}.tar.bz2", archive)
            with archive.open("rb") as file:
                if hashlib.file_digest(file, "sha256").hexdigest() != digest:
                    raise ValueError("The speech runtime checksum does not match.")
            with tarfile.open(archive) as package:
                package.extractall(temporary, filter="data")
            ready = temporary / "ready"
            (ready / "bin").mkdir(parents=True)
            for tool in ("sherpa-onnx-offline", "sherpa-onnx-offline-speaker-diarization"):
                shutil.copy2(temporary / name / "bin" / tool, ready / "bin")
            shutil.copytree(temporary / name / "lib", ready / "lib", symlinks=True)
            for source in LICENSES.iterdir():
                if source.is_file():
                    shutil.copy2(source, ready / source.name)
            (ready / "RUNTIME-SOURCES.txt").write_text(
                "Sherpa-ONNX v2.0.2 (Apache-2.0): https://github.com/k2-fsa/sherpa-onnx/tree/v2.0.2\n"
                "ONNX Runtime v1.28.2 (MIT): https://github.com/microsoft/onnxruntime/tree/v1.28.2\n"
                f"Runtime archive SHA-256: {digest}\n", encoding="utf-8")
            if destination.exists():
                shutil.rmtree(destination)
            ready.replace(destination)
        print(destination)


if __name__ == "__main__":
    main()
