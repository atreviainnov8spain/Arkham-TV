"""Update the Arkham TV listing using the existing Snapcraft login."""

import argparse
from contextlib import ExitStack
from hashlib import sha256
import json
from pathlib import Path

from craft_cli import EmitterMode, emit
from craft_store.errors import StoreServerError
from snapcraft.store.client import StoreClientCLI, get_store_url

from build import HERE, LICENSE, SUMMARY, description


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshots-dir", type=Path, required=True,
                        help="Directory with reviewed screenshots of live broadcasts.")
    parser.add_argument("--banner", type=Path, help="Reviewed 3:1 featured banner in PNG format.")
    parser.add_argument("--dry-run", action="store_true", help="Print the listing without contacting the store.")
    parser.add_argument("--only", choices=("text", "media"), help="Update only this part of the listing.")
    parser.add_argument("--force-text", action="store_true", help="Use Snapcraft's metadata conflict override.")
    args = parser.parse_args()
    screenshots = sorted(args.screenshots_dir.glob("*.png"))
    if not screenshots or args.screenshots_dir.resolve() == HERE / "store":
        parser.error("Select reviewed PNG screenshots of real broadcasts, not the design previews.")
    metadata = {"title": "Arkham TV", "summary": SUMMARY,
                "description": description(HERE.parent), "license": LICENSE,
                "categories": ["photo-and-video"]}
    paths = [("icon", HERE.parent / "assets/arkhamtv-icon.png")]
    paths.extend(("screenshot", path) for path in screenshots)
    if args.banner:
        paths.append(("banner", args.banner))
    if args.dry_run:
        print(json.dumps(metadata, ensure_ascii=False, indent=2))
        for kind, path in paths:
            print(kind, path.name, path.stat().st_size)
        return

    emit.init(EmitterMode.QUIET, "snapcraft", "Arkham TV")
    client = StoreClientCLI()
    name = "arkham-tv"
    identifier = client.get_account_info()["snaps"]["16"][name]["snap-id"]
    base = get_store_url() + f"/dev/api/snaps/{identifier}"

    def request(method, path, **kwargs):
        try:
            return client.request(method, base + path, **kwargs).json()
        except StoreServerError as error:
            raise SystemExit(json.dumps(error.response.json()["error_list"], ensure_ascii=False)) from error

    if args.only != "media":
        request("PUT" if args.force_text else "POST", "/metadata", json=metadata,
                headers={"Content-Type": "application/json", "Accept": "application/json"})
        stored_text = request("GET", "/metadata")
        assert all(stored_text[field] == metadata[field] for field in ("title", "summary", "description", "license"))
        assert "photo-and-video" in {item["name"] for item in stored_text["categories"]["items"]}
        print("Título, categoría, resumen, descripción, historial reciente y licencia guardados.")
    if args.only == "text":
        return

    media = []
    with ExitStack() as stack:
        files = {}
        for index, (kind, path) in enumerate(paths):
            key = f"media_{index}"
            media.append({"type": kind, "key": key, "filename": path.name,
                          "hash": sha256(path.read_bytes()).hexdigest()})
            files[key] = (path.name, stack.enter_context(path.open("rb")), "image/png")
        request("PUT", "/binary-metadata", data={"info": json.dumps(media)}, files=files)
    stored = request("GET", "/binary-metadata")
    assert {(item["type"], item["hash"]) for item in media} == {(item["type"], item["hash"]) for item in stored}
    assert [item["hash"] for item in stored if item["type"] == "screenshot"] == [
        item["hash"] for item in media if item["type"] == "screenshot"
    ]
    banner_status = ", el banner destacado" if args.banner else ""
    print(f"Confirmados en la tienda el icono{banner_status} y {len(screenshots)} capturas.")


if __name__ == "__main__":
    main()
