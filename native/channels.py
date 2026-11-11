"""Display names for services announced by the antenna."""

import re
import unicodedata


def clean_channel_name(name):
    name = "".join(character for character in name
                   if character.isprintable() or character in "\t\r\n" or unicodedata.category(character) == "Zs")
    name = unicodedata.normalize("NFC", name)
    name = " ".join(name.split())
    match = re.fullmatch(r"(?:la\s*)?s[eé�]?p[t7]ima(?:\s*tv)?(?:\s+(sd|hd|uhd))?", name, re.IGNORECASE)
    if match:
        return "La Séptima" + (" " + match[1].upper() if match[1] else "")
    return name
