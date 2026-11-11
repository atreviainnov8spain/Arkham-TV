"""Shared release history for the local interface and desktop packages."""

from html import escape
import json
import re

CATEGORIES = {
    "interfaz": "Diseño",
    "sintonia": "Sintonía",
    "audio": "Audio",
    "reproduccion": "Reproducción",
    "compatibilidad": "Compatibilidad",
    "guia": "Guía TV",
    "grabaciones": "Grabaciones",
}


def load_changelog(root, version):
    releases = json.loads((root / "assets" / "changelog.json").read_text(encoding="utf-8"))
    translations = json.loads((root / "assets" / "changelog.en.json").read_text(encoding="utf-8"))
    previous = (float("inf"),)
    for release in releases:
        number = release["version"]
        if not re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", number):
            raise ValueError(f"Versión inválida en el Changelog ({number}).")
        current = tuple(map(int, number.split(".")))
        if current >= previous or not release["title"].strip() or not release["changes"]:
            raise ValueError(f"Revisa el orden y las notas del Changelog ({number}).")
        if any(category not in CATEGORIES or not note.strip() for category, note in release["changes"]):
            raise ValueError(f"Revisa las categorías y los textos del Changelog ({number}).")
        english = translations.get(number, [])
        if len(english) != 1 + len(release["changes"]) or not all(text.strip() for text in english):
            raise ValueError(f"Falta la traducción del Changelog ({number}).")
        release["english"] = english
        previous = current
    if not releases or releases[0]["version"] != version or releases[-1]["version"] != "1.0":
        raise ValueError(f"El Changelog debe abarcar desde la versión {version} hasta la 1.0.")
    return releases


def release_version(root):
    version = (root / "assets" / "version.txt").read_text(encoding="ascii").strip()
    load_changelog(root, version)
    return version


def render_changelog(releases):
    entries = []
    for index, release in enumerate(releases):
        version = escape(release["version"])
        title = escape(release["title"])
        style = " release-current" if index == 0 else ""
        notes = "".join(
            f'<li><span class="release-category" data-category="{category}">{CATEGORIES[category]}</span>'
            f'<span data-en="{escape(english)}">{escape(note)}</span></li>'
            for (category, note), english in zip(release["changes"], release["english"][1:])
        )
        entries.append(
            f'<li class="release-entry{style}"><article class="panel release-card" aria-label="Versión {version}">'
            f'<span class="release-version">{version}</span><h3 data-en="{escape(release["english"][0])}">{title}</h3>'
            f'<ul class="release-notes" role="list">{notes}</ul></article></li>'
        )
    return "".join(entries)
