"""Local recording settings, programme schedule and MP4 output."""

from datetime import datetime
import json
import os
from pathlib import Path
import re
import secrets
import stat
import time

from .channels import clean_channel_name


RECORDING_QUALITIES = {
    480: (854, 480, "3500k"),
    720: (1280, 720, "6500k"),
    1080: (1920, 1080, "12000k"),
    2160: (3840, 2160, "30000k"),
}


class RecordingError(Exception):
    pass


class Recordings:
    def __init__(self, data, default_folder):
        self.path = data / "grabaciones.json"
        self.default_folder = default_folder
        self.folder = default_folder
        self.jobs = []
        try:
            stored = json.loads(self.path.read_text(encoding="utf-8"))
            folder, jobs = Path(stored["folder"]), stored["jobs"]
            if folder.is_absolute() and isinstance(jobs, list):
                self.folder = folder
                self.jobs = [job for job in jobs if isinstance(job, dict) and "state" in job]
        except (OSError, ValueError, KeyError, TypeError):
            pass
        for job in self.jobs:
            channel = job.get("channel")
            if isinstance(channel, dict) and isinstance(channel.get("name"), str):
                channel["name"] = clean_channel_name(channel["name"]) or channel["name"]
            if job["state"] in {"recording", "finishing"}:
                job.update(state="error", message="La aplicación se cerró durante la grabación.")

    def save(self, *, folder=None, jobs=None):
        folder = self.folder if folder is None else folder
        jobs = self.jobs if jobs is None else jobs
        pending = self.path.with_suffix(".tmp")
        try:
            pending.write_text(json.dumps({"folder": str(folder), "jobs": jobs}, ensure_ascii=False), encoding="utf-8")
            pending.replace(self.path)
        finally:
            pending.unlink(missing_ok=True)
        self.folder, self.jobs = folder, jobs

    def set_folder(self, value):
        try:
            path = Path(value).expanduser()
        except RuntimeError:
            raise RecordingError("Escribe la ruta completa de una carpeta local.") from None
        if not path.is_absolute():
            raise RecordingError("Escribe la ruta completa de una carpeta local.")
        path.mkdir(parents=True, exist_ok=True)
        self.save(folder=path.resolve())

    def schedule(self, channel, title, start, end, programme_start, *, manual=False, audio=None, quality=1080):
        now = int(time.time())
        if end <= max(now, start):
            raise RecordingError("Este programa ya ha terminado.")
        if any(job["state"] in {"scheduled", "recording", "finishing"} and job["start"] < end
               and max(now, start) < job["end"] for job in self.jobs):
            raise RecordingError("Ya hay una grabación que coincide con ese horario.")
        job = {"id": secrets.token_hex(8), "channel": {key: value for key, value in channel.items() if key != "audioTracks"}, "title": title, "start": start,
               "end": end, "programme_start": programme_start, "manual": manual,
               "state": "scheduled", "folder": str(self.folder), "audio": audio, "quality": quality}
        self.save(jobs=[*self.jobs, job])
        return job

    def update(self, job, **fields):
        updated = {**job, **fields}
        self.save(jobs=[updated if item is job else item for item in self.jobs])
        return updated

    def file_path(self, job):
        if not job.get("file"):
            return None
        path = Path(job["file"])
        if not path.is_absolute() or path.parent != Path(job.get("folder") or "") or path.suffix != ".mp4":
            raise RecordingError("La ruta de la grabación no es válida.")
        return path

    def open_video(self, identifier):
        job = next((item for item in self.jobs if item["id"] == identifier and item["state"] in {"done", "error"}), None)
        path = self.file_path(job) if job else None
        if path is None:
            raise FileNotFoundError
        handle = os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb")
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode):
            handle.close()
            raise FileNotFoundError
        return handle, info.st_size

    def delete(self, identifier):
        job = next((item for item in self.jobs if item["id"] == identifier), None)
        if job is None or job["state"] not in {"done", "error", "cancelled"}:
            raise RecordingError("Esa grabación no se puede eliminar.")
        path = self.file_path(job)
        staged = None
        if path is not None:
            try:
                info = path.lstat()
            except FileNotFoundError:
                pass
            else:
                if not stat.S_ISREG(info.st_mode):
                    raise RecordingError("El archivo de la grabación no es válido.")
                staged = path.with_name(f".arkham-delete-{secrets.token_hex(16)}")
                path.rename(staged)
        try:
            self.save(jobs=[item for item in self.jobs if item is not job])
        except OSError:
            if staged is not None:
                staged.rename(path)
            raise
        if staged is not None:
            staged.unlink()

    def reserve(self, job):
        folder = Path(job["folder"])
        folder.mkdir(parents=True, exist_ok=True)
        cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", job["title"])
        title = " ".join(cleaned.split()).strip(" .") or "Grabación"
        title = title.encode("utf-8")[:145].decode("utf-8", "ignore").strip(" .")
        date = datetime.fromtimestamp(job["start"]).strftime("%Y-%m-%d %H-%M")
        for number in range(1, 1000):
            suffix = f" ({number})" if number > 1 else ""
            path = folder / f"{title} · {date}{suffix}.mp4"
            try:
                with path.open("xb"):
                    return path
            except FileExistsError:
                continue
        raise RecordingError("No hay un nombre de archivo disponible para esta grabación.")
