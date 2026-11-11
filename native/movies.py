"""Opt-in film metadata from OMDb, with links to the corresponding IMDb entries."""

import json
import os
import re
import tempfile
from urllib.parse import urlencode
from urllib.error import HTTPError
from urllib.request import urlopen

OMDB = "https://www.omdbapi.com/"
IMDB_ID = re.compile(r"tt[0-9]{7,12}")


class MovieLookupError(Exception):
    pass


def load_key(path):
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return ""


def save_key(path, key):
    if not key:
        path.unlink(missing_ok=True)
        return
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".omdb-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(key + "\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def verify_key(key):
    if not re.fullmatch(r"[A-Za-z0-9]{1,64}", key):
        raise MovieLookupError("Introduce una clave de OMDb válida.")
    details(key, "tt0816692")


def lookup_error(message, status=None):
    message = str(message).casefold()
    if status == 429 or "request limit" in message:
        return MovieLookupError("Se ha alcanzado el límite de consultas de OMDb. Vuelve a intentarlo más tarde.")
    if status == 401 or "invalid api key" in message or "no api key" in message:
        return MovieLookupError("OMDb rechazó la clave. Comprueba que la has activado desde el correo de OMDb.")
    return MovieLookupError("OMDb no pudo completar la consulta. Puedes consultar el título en IMDb.")


def request(key, **parameters):
    if not key:
        raise MovieLookupError("Añade una clave de OMDb en Configuración.")
    query = urlencode({"apikey": key, "type": "movie", **parameters})
    try:
        with urlopen(OMDB + "?" + query, timeout=7) as response:
            data = json.loads(response.read(256 * 1024))
    except HTTPError as error:
        message = ""
        with error:
            try:
                failure = json.loads(error.read(4096))
                if isinstance(failure, dict):
                    message = failure.get("Error", "")
            except (OSError, ValueError):
                pass
        raise lookup_error(message, error.code) from None
    except (OSError, ValueError):
        raise MovieLookupError("OMDb no responde. Puedes consultar el título en IMDb.") from None
    if not isinstance(data, dict):
        raise MovieLookupError("OMDb devolvió una respuesta inesperada.")
    if data.get("Response") == "False":
        if data.get("Error") in ("Movie not found!", "Incorrect IMDb ID."):
            return {}
        raise lookup_error(data.get("Error", ""))
    return data


def search(key, title, year):
    response = request(key, s=title, **({"y": year} if year else {}))
    matches = response.get("Search", [])
    if not isinstance(matches, list):
        raise MovieLookupError("OMDb devolvió una respuesta inesperada.")
    return [
        {"id": item["imdbID"], "title": item["Title"], "year": item.get("Year", "")}
        for item in matches[:8]
        if isinstance(item, dict) and item.get("Type") == "movie"
        and IMDB_ID.fullmatch(str(item.get("imdbID", ""))) and isinstance(item.get("Title"), str)
    ]


def details(key, identifier):
    result = request(key, i=identifier, plot="short")
    if result.get("Type") != "movie" or result.get("imdbID") != identifier:
        raise MovieLookupError("La ficha de esta película no está disponible.")
    fields = {"Title": "title", "Year": "year", "Runtime": "runtime", "Genre": "genre",
              "Director": "director", "Actors": "cast", "Plot": "plot", "imdbRating": "rating"}
    movie = {"id": identifier}
    for source, name in fields.items():
        value = result.get(source)
        if isinstance(value, str) and value not in ("", "N/A"):
            movie[name] = value[:600]
    return movie
