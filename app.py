#!/usr/bin/env python3
import argparse
import ctypes
import errno
import json
import os
import platform
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from native.af9035 import FIRMWARE, USB_BUSY, build
from native.audio import AudioLevels, FLAT, audio_chain, valid_gains
from native.channels import clean_channel_name
from native.changelog import load_changelog, render_changelog
from native.devices import USB_MODELS
from native.guide import Guide
from native import hdmi, movies
from native.recordings import RecordingError, Recordings, RECORDING_QUALITIES
from native.audio_tracks import match_track, primary_track
from native.mobile import MobileSession
from native.signal_analysis import SignalAnalysis
from native.transport import Transport

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
APP_VERSION = (ROOT / "assets" / "version.txt").read_text(encoding="ascii").strip()
CHANGELOG = render_changelog(load_changelog(ROOT, APP_VERSION)).encode("utf-8")
CHANNEL_LOGOS = ROOT / "assets" / "canales"
TOOLS = ("ffmpeg", "ffprobe")
MIN_CHANNEL, MAX_CHANNEL = 21, 48
SCAN_LIMIT = 600
MAX_AUDIO_DELAY_MS = 2000
# Allow the recorder to catch up after a short burst of work without delaying live playback.
RECORDING_BUFFER_BYTES = 32 * 1024 * 1024
RECORDING_BUFFER_ERROR = "La grabación no pudo seguir el ritmo de la emisión. Prueba con una resolución más baja."
ENV = {**os.environ, "LC_ALL": "C"}
VIDEO_ENCODER = (
    ["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-realtime", "1", "-b:v", "4500k"]
    if platform.system() == "Darwin" and os.environ.get("ARKHAM_VIDEOTOOLBOX") == "1"
    else ["-c:v", "libx264", "-preset", "ultrafast", "-sc_threshold", "0", "-crf", "23"]
)
SCAN_LINE = re.compile(r"(?m)^UHF (\d+)$")
SCAN_COUNT_LINE = re.compile(r"(?m)^CHANNELS_FOUND (\d+)\n")
RF_LINE = re.compile(r"(?m)^RF (LOCKED|LOST)$")
RF_CNR = re.compile(r"(?m)^RF CNR (-?\d+(?:\.\d+)?)$")
SIGNAL_ANALYSIS = platform.system() in {"Darwin", "Linux"}
MEDIA_PATH = re.compile(r"/tv/([0-9a-f]{16})/(live\.m3u8|init\.mp4|segment-\d+\.m4s)")


class TunerError(Exception):
    pass


def mac_usb():
    try:
        output = subprocess.check_output(
            ["/usr/sbin/ioreg", "-p", "IOUSB", "-c", "IOUSBHostDevice", "-r", "-d", "1", "-l", "-w0"],
            stderr=subprocess.DEVNULL, timeout=3, text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    detected = None
    for device in output.split("+-o "):
        vendor = re.search(r'"idVendor" = (\d+)', device)
        product = re.search(r'"idProduct" = (\d+)', device)
        if vendor and product:
            identifier = f"{int(vendor[1]):04x}:{int(product[1]):04x}"
            if identifier == "07ca:a835":
                return identifier
            if identifier in USB_MODELS:
                detected = detected or identifier
    return detected


def probe():
    if platform.system() == "Linux":
        from native.dvb_linux import probe as linux_probe

        return linux_probe()
    if platform.system() != "Darwin":
        return {"usb": None, "connected": None, "ready": False, "message": "Arkham TV requiere macOS o Linux."}
    device = mac_usb()
    if not device:
        message = "Conecta un sintonizador de TV compatible al Mac."
    elif device != "07ca:a835":
        message = f"{USB_MODELS[device]} detectado por USB. Esta variante se puede sintonizar en Ubuntu."
    elif not FIRMWARE.is_file():
        message = "A835 detectado. Ejecuta preparar.command para instalar el firmware."
    elif missing := [name for name in TOOLS if not shutil.which(name)]:
        message = "A835 detectado. Faltan herramientas · " + ", ".join(missing)
    else:
        return {"usb": device, "systems": ["DVB-T"], "ready": True, "message": "A835 conectado por USB"}
    return {"usb": device, "ready": False, "message": message}


def read_channels(path):
    if not path.is_file():
        return {}
    channels = json.loads(path.read_text(encoding="utf-8"))
    for channel in channels:
        channel["name"] = clean_channel_name(channel["name"]) or f"Servicio {channel['sid']}"
    return {channel["id"]: channel for channel in sorted(channels, key=lambda channel: channel["name"].casefold())}


def native_command(*args):
    module = "native.dvb_linux" if platform.system() == "Linux" else "native.af9035"
    return [sys.executable, "-m", module, *map(str, args)]


def write_json(path, value):
    pending = path.with_suffix(".tmp")
    try:
        pending.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        pending.replace(path)
    finally:
        pending.unlink(missing_ok=True)


def terminate(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def tail(path):
    try:
        with path.open("rb") as log:
            log.seek(max(0, path.stat().st_size - 24_000))
            return log.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


class TV:
    def __init__(self, data):
        self.data = data
        self.data.mkdir(parents=True, exist_ok=True)
        self.channels_path = data / "canales.json"
        self.channels = read_channels(self.channels_path)
        self.profiles_dir = data / "sintonizaciones"
        self.profiles = {}
        for file in self.profiles_dir.glob("*.json"):
            try:
                profile = json.loads(file.read_text(encoding="utf-8"))
                channels = profile["channels"]
                if isinstance(profile["name"], str) and isinstance(channels, list) and channels and all(
                        isinstance(channel["id"], str) and isinstance(channel["name"], str)
                    and type(channel["uhf"]) is int for channel in channels
                ):
                    for channel in channels:
                        channel["name"] = clean_channel_name(channel["name"]) or f"Servicio {channel.get('sid', '')}".rstrip()
                    channels.sort(key=lambda channel: channel["name"].casefold())
                    self.profiles[file.stem] = profile
            except (OSError, ValueError, KeyError, TypeError):
                continue
        self.guide = Guide(data / "guide.json")
        self.movie_key_path = data / "omdb.key"
        self.movie_key = movies.load_key(self.movie_key_path)
        self.equalizer_path = data / "equalizer.json"
        try:
            gains = json.loads(self.equalizer_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            gains = None
        self.equalizer = gains if valid_gains(gains) else FLAT.copy()
        self.audio_delays_path = data / "audio-delays.json"
        try:
            delays = json.loads(self.audio_delays_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            delays = {}
        self.audio_delays = {channel: delay for channel, delay in delays.items()
                             if type(delay) is int and 0 < abs(delay) <= MAX_AUDIO_DELAY_MS} if isinstance(delays, dict) else {}
        self.last_channel_path = data / "ultimo-canal"
        self.last_channel = self.last_channel_path.read_text().strip() if self.last_channel_path.is_file() else None
        self.lock = threading.RLock()
        self.job = None
        self.scan = {"state": "idle"}
        self.stream = None
        self.capture = None
        self.live_audio = {}
        self.rf_signal = None
        self.recording = None
        video_folder = Path.home() / ("Movies" if platform.system() == "Darwin" else "Videos")
        self.recordings = Recordings(data, video_folder / "Arkham TV")
        self.stream_error = None
        self.hdmi_permissions = set()
        self.autoplay_pending = False
        self.autoplay_channels = None
        self.mobile = MobileSession(self, WEB, CONTENT_TYPES, TunerError)

    def status(self):
        hardware = probe()
        hardware.setdefault("model", USB_MODELS.get(hardware.get("usb")))
        with self.lock:
            self.read_signal()
            if not hardware.get("connected", hardware.get("usb")):
                self.rf_signal = None
            hardware["signal"] = self.rf_signal
            scan = dict(self.scan)
            if self.job:
                scan_log = tail(self.job["log"])
                matches = SCAN_LINE.findall(scan_log)
                if matches:
                    channel = int(matches[-1])
                    scan["current"] = channel
                    frequencies = self.job["frequencies"]
                    if channel in frequencies:
                        scan["progress"] = round(100 * frequencies.index(channel) / len(frequencies))
                if scan["kind"] == "channels":
                    counts = SCAN_COUNT_LINE.findall(scan_log)
                    if counts:
                        self.scan["count"] = max(self.scan["count"], int(counts[-1]))
                    scan["count"] = self.scan["count"]
            self.collect_audio_tracks()
            stream = None
            if self.stream:
                stream = {
                    "id": self.stream["id"], "channel": self.stream["channel"],
                    "url": f'/tv/{self.stream["id"]}/live.m3u8',
                    "ready": self.stream["playlist"].is_file(),
                    "audioPid": self.stream["audioPid"],
                }
                if source := self.stream.get("hdmi"):
                    stream["hdmi"] = {"id": source[0]["id"], "name": source[0]["name"], "audio": source[1]["id"],
                                      "deinterlace": source[0].get("deinterlace", "auto"), "gain": source[1].get("gain", 0)}
            now = int(time.time())
            programs = self.guide.schedule((stream["channel"],), now, now + 1)[stream["channel"]] if stream else []
            program = max(programs, key=lambda item: item["start"], default=None)
            return {"app": "Arkham TV", "hardware": hardware, "scan": scan, "stream": stream,
                    "hdmiAvailable": hdmi.available(), "hdmiPermissionFlow": hdmi.linux_enabled(),
                    "program": program, "moviesConfigured": bool(self.movie_key),
                    "streamError": self.stream_error,
                    "autoplayPending": self.autoplay_pending, "mobileSharing": bool(self.mobile.status()["url"]),
                    "audioDelays": dict(self.audio_delays),
                    "equalizer": self.equalizer,
                    "channels": list(self.channels.values()),
                    "recordingFolder": str(self.recordings.folder), "recordings": self.recordings.jobs,
                    "recordingElapsed": time.monotonic() - self.recording["started"]
                    if self.recording and self.recording["finishing"] is None else None,
                    "recordingUhf": self.capture.uhf if self.recording else None,
                    "profiles": [{"id": identifier, "name": profile["name"], "count": len(profile["channels"])}
                                 for identifier, profile in self.profiles.items()]}

    def save_profile(self, name):
        name = " ".join(name.split())
        if not 0 < len(name) <= 60 or not name.isprintable():
            raise TunerError("Escribe un nombre de entre 1 y 60 caracteres.")
        with self.lock:
            if self.job:
                raise TunerError("Espera a que termine la búsqueda.")
            if not self.channels:
                raise TunerError("Sintoniza algún canal antes de guardar la lista.")
            if any(profile["name"].casefold() == name.casefold() for profile in self.profiles.values()):
                raise TunerError("Ya tienes una sintonización con ese nombre. Elige otro.")
            identifier = secrets.token_hex(8)
            profile = {"name": name, "channels": list(self.channels.values())}
            self.profiles_dir.mkdir(exist_ok=True)
            write_json(self.profiles_dir / (identifier + ".json"), profile)
            self.profiles[identifier] = profile

    def load_profile(self, identifier):
        with self.lock:
            if self.recording:
                raise TunerError("Detén la grabación antes de cargar otra sintonización.")
            if self.job:
                raise TunerError("Espera a que termine la búsqueda.")
            profile = self.profiles.get(identifier)
            if profile is None:
                raise TunerError("Esa sintonización ya no está disponible.")
            channels = {channel["id"]: channel for channel in profile["channels"]}
            if channels == self.channels:
                return
            write_json(self.channels_path, profile["channels"])
            self.stop_stream()
            self.channels = channels
            self.scan = {"state": "idle"}
            self.stream_error = None
            self.guide.clear()
            self.rf_signal = None
            self.autoplay_pending = probe()["ready"]
            self.autoplay_channels = None

    def delete_profile(self, identifier):
        with self.lock:
            if identifier not in self.profiles:
                raise TunerError("Esa sintonización ya no está disponible.")
            (self.profiles_dir / (identifier + ".json")).unlink(missing_ok=True)
            del self.profiles[identifier]

    def levels(self, stream_id, position):
        with self.lock:
            stream = self.stream
        if stream and stream["id"] == stream_id:
            return stream["levels"].near(position)
        return []

    def signal_analysis(self):
        with self.lock:
            capture, stream = self.capture, self.stream
            if not capture or not stream or not capture.analysis or capture.process.poll() is not None:
                return {}
            self.read_signal()
            channel = self.channels.get(stream["channel"])
            if not channel:
                return {}
            result = {"channel": stream["channel"], "stream": stream["id"], "locked": self.rf_signal}
            if self.rf_signal is not False:
                result.update(capture.analysis.snapshot(channel["sid"]))
            if self.rf_signal:
                last_cnr = None
                for line in tail(capture.log).splitlines():
                    if line in {"RF LOST", "RF LOCKED", "RF CNR UNAVAILABLE"}:
                        last_cnr = None
                    elif match := RF_CNR.fullmatch(line):
                        last_cnr = float(match[1])
                result["cnr"] = last_cnr
            return result

    def tune_for_analysis(self, channel_id):
        with self.lock:
            if self.stream and self.stream["channel"] == channel_id:
                return
            if self.recording:
                raise TunerError("Espera a que termine la grabación para cambiar de canal en Análisis de señal.")
            self.start_stream(channel_id)

    def teletext(self, number, subpage, revision):
        with self.lock:
            if not self.stream or not self.capture or self.capture.process.poll() is not None:
                return {"state": "idle"}
            channel = self.channels.get(self.stream["channel"])
            if not channel or not self.capture.teletext:
                return {"state": "idle"}
            self.read_signal()
            source = {"channel": channel["id"], "stream": self.stream["id"]}
            if self.rf_signal is False:
                return {**source, "state": "no-signal"}
            return {**source, **self.capture.teletext.snapshot(channel["sid"], number, subpage, revision)}

    def tune_for_teletext(self, channel_id):
        with self.lock:
            if self.stream and self.stream["channel"] == channel_id:
                return
            if self.recording:
                raise TunerError("Espera a que termine la grabación para cambiar de canal en Teletexto.")
            self.start_stream(channel_id)

    def require_hardware(self):
        hardware = probe()
        if not hardware["ready"]:
            raise TunerError(hardware["message"])

    def start_scan(self, first=MIN_CHANNEL, last=MAX_CHANNEL, *, guide=False, fresh=False):
        with self.lock:
            if self.recording:
                raise TunerError("Espera a que termine la grabación antes de buscar frecuencias.")
            if self.job:
                raise TunerError("Ya hay una búsqueda en curso.")
            frequencies = sorted({c["uhf"] for c in self.channels.values()}) if guide else list(range(first, last + 1))
            if not frequencies:
                raise TunerError("Sintoniza tus canales antes de actualizar la guía.")
            self.require_hardware()
            resume = self.stream["channel"] if guide and self.stream and not self.stream.get("hdmi") else None
            self.stop_stream()
            self.stream_error = None
            folder = Path(tempfile.mkdtemp(prefix="scan-", dir=self.data))
            log, output = folder / "scan.log", folder / "resultados.json"
            command = native_command("guide", *frequencies) if guide else native_command("scan", first, last)
            try:
                with log.open("wb") as log_file, output.open("wb") as channels_file:
                    process = subprocess.Popen(
                        command, cwd=ROOT,
                        stdout=channels_file, stderr=log_file,
                    )
            except OSError:
                shutil.rmtree(folder, ignore_errors=True)
                raise
            self.scan = {"state": "running", "kind": "guide" if guide else "channels", "first": frequencies[0],
                         "last": frequencies[-1], "current": frequencies[0], "progress": 0, "resume": bool(resume)}
            if not guide:
                self.scan["count"] = 0
            self.job = {"folder": folder, "log": log, "output": output, "process": process,
                        "started": time.monotonic(), "frequencies": frequencies, "resume": resume, "fresh": fresh}
            return self.scan

    def autoplay(self):
        with self.lock:
            if self.stream or self.autoplay_pending:
                return
            self.require_hardware()
            if not self.channels and not self.job:
                self.start_scan(MIN_CHANNEL, MAX_CHANNEL)
            self.autoplay_pending = True
            self.autoplay_channels = None

    def advance_autoplay(self):
        if not self.autoplay_pending or self.job:
            return
        if self.stream:
            if self.stream["playlist"].is_file():
                self.autoplay_pending = False
            return
        if self.autoplay_channels is None:
            channels = (identifier for identifier, channel in self.channels.items()
                        if not self.recording or channel["uhf"] == self.capture.uhf)
            self.autoplay_channels = iter(sorted(channels, key=lambda channel: channel != self.last_channel))
        channel = next(self.autoplay_channels, None)
        if channel is None:
            self.autoplay_pending = False
            return
        try:
            self.start_stream(channel, automatic=True)
        except (OSError, TunerError) as error:
            self.autoplay_pending = False
            self.stream_error = str(error)

    def finish_scan(self):
        job = self.job
        if not job:
            return
        result = job["process"].poll()
        if result is None and time.monotonic() - job["started"] < SCAN_LIMIT:
            return
        kind = self.scan["kind"]
        try:
            if result is None:
                terminate(job["process"])
                raise TunerError("La búsqueda superó el tiempo máximo.")
            if result != 0:
                diagnostics = tail(job["log"]).strip().splitlines()
                detail = diagnostics[-1] if diagnostics else "Revisa la conexión USB."
                raise TunerError("La búsqueda se interrumpió. " + detail)
            if kind == "guide":
                metadata = json.loads(job["output"].read_text(encoding="utf-8"))
                events = metadata["programs"]
                self.guide.update(events)
                if self.update_channel_audio(metadata["audioTracks"]):
                    write_json(self.channels_path, list(self.channels.values()))
                message = "Guía actualizada." if events else "La antena no ha recibido nuevos horarios."
                self.scan = {"state": "done", "kind": kind, "progress": 100, "message": message}
                return
            channels = read_channels(job["output"])
            programs = {key: channel.pop("programs", []) for key, channel in channels.items()}
            if channels:
                first, last = self.scan["first"], self.scan["last"]
                previous_channels = {} if job["fresh"] else self.channels
                merged = {key: channel for key, channel in previous_channels.items() if not first <= channel["uhf"] <= last}
                for channel in channels.values():
                    previous = previous_channels.get(channel["id"])
                    if previous and channel["name"] == f"Servicio {channel['sid']}":
                        channel["name"] = previous["name"]
                merged.update(channels)
                ordered = sorted(merged.values(), key=lambda channel: channel["name"].casefold())
                job["output"].write_text(json.dumps(ordered, ensure_ascii=False), encoding="utf-8")
                job["output"].replace(self.channels_path)
                self.channels = {channel["id"]: channel for channel in ordered}
                if job["fresh"]:
                    self.guide.clear()
                self.guide.update(programs)
            message = f"{len(channels)} canales de TV encontrados."
            signals = RF_LINE.findall(tail(job["log"]))
            self.rf_signal = "LOCKED" in signals if signals else True if channels else None
            if not channels:
                message = ("Sin canales DVB-T ni DVB-T2. Revisa la antena o prueba otro rango UHF."
                           if platform.system() == "Linux" else
                           "Sin canales DVB-T. Revisa la antena o prueba otro rango UHF.")
            self.scan = {"state": "done", "kind": kind, "progress": 100, "count": len(channels), "message": message}
        except (OSError, ValueError, TunerError) as error:
            self.scan = {"state": "error", "kind": kind, "message": str(error)}
        finally:
            shutil.rmtree(job["folder"], ignore_errors=True)
            self.job = None
            if job["resume"]:
                self.autoplay_pending = True
                self.autoplay_channels = iter((job["resume"],))

    def select_audio(self, channel_id, pid):
        with self.lock:
            if not self.stream or self.stream["channel"] != channel_id:
                raise TunerError("La emisión ha cambiado. Vuelve a elegir el audio.")
            self.collect_audio_tracks()
            track = next((track for track in self.channels.get(channel_id, {}).get("audioTracks", [])
                          if track["pid"] == pid), None)
            if not track:
                raise TunerError("Esa pista de audio ya no está disponible.")
            if self.stream["audioPid"] != pid:
                self.start_stream(channel_id, selected_audio=track)

    def start_hdmi(self, video_id, audio_id, deinterlace, gain):
        linux = hdmi.linux_enabled()
        if linux:
            from native.hdmi_linux import missing_interfaces

            if (missing_interfaces() if os.environ.get("SNAP") else not {"video", "audio"} <= self.hdmi_permissions):
                raise TunerError("Autoriza el vídeo y el audio de la capturadora HDMI.")
        try:
            inputs = hdmi.devices()
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            raise TunerError("No se pudieron consultar las entradas de captura HDMI." if linux
                             else "No se pudieron consultar las capturadoras de macOS.") from error
        if not linux and not inputs.get("authorized"):
            raise TunerError("Activa Cámara y Micrófono para Arkham TV en Privacidad y seguridad de macOS.")
        video = next((item for item in inputs["video"] if item["id"] == video_id), None)
        audio = next((item for item in inputs["audio"] if item["id"] == audio_id), None)
        if not video or not audio:
            raise TunerError("Selecciona la entrada de vídeo y el audio de la capturadora HDMI.")
        if linux:
            from native.hdmi_linux import CaptureError, capture_mode

            # Reuse the selected mode when the device is already open in this session.
            with self.lock:
                active_video = self.stream["hdmi"][0] if self.stream and self.stream.get("hdmi") else {}
                try:
                    mode = active_video["mode"] if active_video.get("id") == video_id else capture_mode(video)
                except CaptureError as error:
                    raise TunerError(str(error)) from error
                self.start_stream(hdmi.CHANNEL_ID, source=({**video, "mode": mode, "deinterlace": deinterlace},
                                                           {**audio, "gain": gain}))
            return
        self.start_stream(hdmi.CHANNEL_ID, source=({**video, "deinterlace": deinterlace}, {**audio, "gain": gain}))

    def start_stream(self, channel_id, *, automatic=False, selected_audio=None, source=None):
        with self.lock:
            if self.job:
                raise TunerError("Espera a que termine la búsqueda.")
            if source:
                channel = {"id": hdmi.CHANNEL_ID, "name": source[0]["name"],
                           "sid": hdmi.PROGRAM, "uhf": 0, "frequency": 0}
                if self.recording and (not self.stream or source != self.stream.get("hdmi")):
                    raise TunerError("Detén la grabación antes de cambiar la entrada HDMI.")
            else:
                channel = self.channels.get(channel_id)
            if channel is None:
                raise TunerError("Ese canal no está en la lista.")
            if not source:
                self.require_hardware()
                if self.recording and self.recording["job"]["channel"]["id"] == hdmi.CHANNEL_ID:
                    raise TunerError("Detén la grabación antes de cambiar la entrada HDMI.")
            if self.recording and self.recording["job"].get("manual") and self.recording["job"]["channel"]["id"] != channel_id:
                if self.recording["finishing"] is None:
                    self.end_recording()
                if channel["uhf"] != self.capture.uhf:
                    self.flush_recording()
            if self.recording and channel["uhf"] != self.capture.uhf:
                raise TunerError(f"Grabando en UHF {self.capture.uhf}. Elige un canal de esa frecuencia o detén la grabación.")
            reuse = bool(self.capture and self.capture.uhf == channel["uhf"] and self.capture.process.poll() is None)
            if source and reuse:
                reuse = bool(self.stream and source == self.stream.get("hdmi"))
            self.stop_stream(cancel_autoplay=not automatic, keep_capture=reuse)
            self.stream_error = None
            if source:
                # The Mac capture can fill a small probe with H.264 before the first AAC frame.
                analysis, probe_size = ("500000", "32768") if hdmi.linux_enabled() else ("1500000", "2000000")
                probe_options = ["-analyzeduration", analysis, "-probesize", probe_size, "-fpsprobesize", "0"]
            else:
                analysis, probe_size = ("1500000", "750000") if reuse else ("3000000", "5000000")
                probe_options = ["-analyzeduration", analysis, "-probesize", probe_size]
            folder = Path(tempfile.mkdtemp(prefix="tv-", dir=self.data))
            playlist = folder / "live.m3u8"
            delay = self.audio_delays.get(channel_id, 0)
            audio_filter = audio_chain(self.equalizer, delay, continuous=bool(source))
            video_options = []
            if source and hdmi.linux_enabled():
                from native.hdmi_linux import output_rate

                # Linux capture has already deinterlaced the image. The short
                # MPEG-TS probe cannot always determine its frame rate.
                video_filter = "null"
                video_options = ["-r", str(output_rate(source[0])), "-fps_mode", "cfr"]
            else:
                video_filter = "bwdif=mode=send_frame:deint=interlaced"
            if not source:
                video_filter += ",fps=25"
            if delay < 0:
                video_filter += f",tpad=start_mode=clone:start_duration={-delay}ms"
            encoder = None
            try:
                capture = self.ensure_transport(channel, source=source)
                # A new HDMI feed must start with the capture encoder's initial H.264 headers.
                tracks = [] if source else capture.audio.wait(channel["sid"]) or []
                preference = selected_audio or self.live_audio.get(channel_id)
                track = (match_track(tracks, preference) if preference else None) or primary_track(tracks)
                pid = track["pid"] if track else None
                program = f"0:p:{channel['sid']}"
                audio_map = f"0:i:{pid}" if pid is not None else f"{program}:a:0?"
                with (folder / "ffmpeg.log").open("wb") as log:
                    encoder = subprocess.Popen(
                        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning",
                         *probe_options, "-f", "mpegts",
                         "-i", "pipe:0", "-map", f"{program}:v:0", "-map", audio_map,
                         "-vf", video_filter,
                         *(["-force_key_frames", "expr:gte(t,n_forced*2)"] if source else []),
                         *VIDEO_ENCODER, *video_options, "-pix_fmt", "yuv420p", "-g", "120" if source else "50",
                         "-stats_enc_pre:v", "pipe:1", "-stats_enc_pre_fmt:v", "video:{n}:{t}",
                         "-af", audio_filter, "-c:a", "aac", "-ac", "2", "-b:a", "128k",
                         "-f", "hls", "-hls_segment_type", "fmp4", "-hls_time", "2",
                         "-hls_list_size", "6", "-hls_delete_threshold", "3",
                         "-hls_flags", "delete_segments+independent_segments+temp_file+program_date_time",
                         "-hls_segment_filename", str(folder / "segment-%06d.m4s"), str(playlist)],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, env=ENV,
                    )
                feed = capture.attach(encoder.stdin)
                if source and not reuse:
                    capture.worker.start()
            except OSError:
                terminate(encoder)
                if encoder:
                    encoder.stdin.close()
                    encoder.stdout.close()
                shutil.rmtree(folder, ignore_errors=True)
                self.release_transport()
                raise
            if selected_audio and track:
                self.live_audio[channel_id] = track
            levels = AudioLevels()
            self.stream = {"id": secrets.token_hex(8), "channel": channel_id, "folder": folder,
                           "playlist": playlist, "started": time.monotonic(),
                           "feed": feed, "encoder": encoder, "levels": levels, "audioPid": pid}
            if source:
                self.stream["hdmi"] = source
            if capture.analysis:
                capture.analysis.select(channel["sid"])
            worker = threading.Thread(target=levels.read, args=(encoder.stdout,), daemon=True)
            self.stream["levels_worker"] = worker
            worker.start()

    def ensure_transport(self, channel, *, source=None):
        if self.capture is None:
            self.rf_signal = None
            command = hdmi.capture_command(*source) if source else native_command("stream", channel["uhf"])
            self.capture = Transport(command, channel, self.guide, self.data, ROOT,
                                     analysis=SignalAnalysis() if SIGNAL_ANALYSIS and not source else None,
                                     teletext=SIGNAL_ANALYSIS and not source)
            if not source:
                self.capture.worker.start()
        return self.capture

    def update_channel_audio(self, tracks):
        changed = False
        for identifier, options in tracks.items():
            channel = self.channels.get(identifier)
            if channel is not None and channel.get("audioTracks") != options:
                self.channels[identifier] = {**channel, "audioTracks": options}
                changed = True
        return changed

    def collect_audio_tracks(self):
        if self.capture:
            self.update_channel_audio({f"{self.capture.frequency}-{sid}": tracks
                                       for sid, tracks in self.capture.audio.snapshot().items()})

    def release_transport(self):
        if self.capture and not self.stream and not self.recording:
            self.read_signal()
            self.collect_audio_tracks()
            capture, self.capture = self.capture, None
            terminate(capture.process)
            if capture.worker.ident is not None:
                capture.worker.join(timeout=2)
            else:
                capture.process.stdout.close()

    def read_signal(self):
        if self.capture:
            states = RF_LINE.findall(tail(self.capture.log))
            if states:
                self.rf_signal = states[-1] == "LOCKED"

    def set_equalizer(self, gains):
        with self.lock:
            if gains == self.equalizer:
                return
            pending = self.equalizer_path.with_suffix(".tmp")
            pending.write_text(json.dumps(gains), encoding="utf-8")
            pending.replace(self.equalizer_path)
            self.equalizer = gains
            if self.stream:
                self.start_stream(self.stream["channel"], source=self.stream.get("hdmi"))

    def set_audio_delay(self, channel_id, delay):
        with self.lock:
            if channel_id not in self.channels:
                raise TunerError("Ese canal no está en la lista.")
            if delay == self.audio_delays.get(channel_id, 0):
                return
            delays = dict(self.audio_delays)
            if delay:
                delays[channel_id] = delay
            else:
                delays.pop(channel_id, None)
            pending = self.audio_delays_path.with_suffix(".tmp")
            pending.write_text(json.dumps(delays), encoding="utf-8")
            pending.replace(self.audio_delays_path)
            self.audio_delays = delays
            if self.stream and self.stream["channel"] == channel_id:
                self.start_stream(channel_id)

    def set_recording_folder(self, path):
        with self.lock:
            self.recordings.set_folder(path)

    def open_recording_folder(self, identifier):
        with self.lock:
            if identifier is None:
                folder = self.recordings.folder
                if folder == self.recordings.default_folder:
                    folder.mkdir(parents=True, exist_ok=True)
            else:
                job = next((job for job in self.recordings.jobs if job.get("id") == identifier), None)
                path = self.recordings.file_path(job) if job else None
                if path is None:
                    raise RecordingError("Esta grabación ya no está disponible.")
                folder = path.parent
        if not folder.is_dir():
            raise RecordingError("La carpeta de grabaciones no está disponible.")

        if platform.system() == "Darwin":
            command = ["/usr/bin/open"]
        elif os.environ.get("SNAP"):
            command = ["snapctl", "user-open"]
        elif shutil.which("xdg-open"):
            command = ["xdg-open"]
        else:
            command = ["gio", "open"]
        try:
            opener = subprocess.Popen([*command, str(folder)], stdin=subprocess.DEVNULL)
            if opener.wait(timeout=1):
                raise RecordingError("No se pudo abrir la carpeta de grabaciones.")
        except subprocess.TimeoutExpired:
            # Some desktop file managers keep the launcher running.
            pass
        except OSError as error:
            raise RecordingError("No se pudo abrir la carpeta de grabaciones.") from error

    def schedule_recording(self, channel_id, start=None, *, audio_pid=None, quality=1080):
        with self.lock:
            now = int(time.time())
            manual = start is None
            if manual and (not self.stream or self.stream["channel"] != channel_id):
                raise RecordingError("La emisión ha cambiado. Vuelve a elegir qué grabar.")
            channel = self.channels.get(channel_id)
            if manual and self.stream and (source := self.stream.get("hdmi")):
                channel = {"id": hdmi.CHANNEL_ID, "name": source[0]["name"], "sid": hdmi.PROGRAM, "uhf": 0}
                audio_pid = None
                if quality > 1080:
                    raise RecordingError("La grabación por HDMI admite hasta 1080p.")
            if not channel:
                raise RecordingError("Elige un canal sintonizado.")
            at = now if manual else start
            events = self.guide.schedule((channel_id,), at, at + 1)[channel_id]
            event = max(events, key=lambda item: item["start"], default=None) if manual else next(
                (item for item in events if item["start"] == start), None)
            if not manual and event is None:
                raise RecordingError("La guía ha cambiado. Vuelve a seleccionar el programa.")
            if at <= now:
                if channel_id != hdmi.CHANNEL_ID:
                    self.require_hardware()
                if self.recording:
                    raise RecordingError("Ya hay una grabación en curso.")
            title = event["title"] if event else channel["name"]
            end = event["end"] if event else now + 4 * 3600
            programme_start = event["start"] if event else at
            self.collect_audio_tracks()
            tracks = self.channels.get(channel_id, channel).get("audioTracks", [])
            track = next((track for track in tracks if track["pid"] == audio_pid), None)
            if audio_pid is not None and track is None:
                raise RecordingError("Esa pista de audio ya no está disponible.")
            job = self.recordings.schedule(channel, title, at, end, programme_start,
                                           manual=manual, audio=track, quality=quality)
            if manual:
                self.check_recordings()
                current = next(item for item in self.recordings.jobs if item["id"] == job["id"])
                if current["state"] == "error":
                    raise RecordingError(current["message"])

    def cancel_recording(self, identifier):
        with self.lock:
            job = next((item for item in self.recordings.jobs if item["id"] == identifier), None)
            if job is None or job["state"] not in {"scheduled", "recording"}:
                raise RecordingError("Esa grabación ya no se puede detener.")
            if job["state"] == "scheduled":
                self.recordings.update(job, state="cancelled")
            else:
                self.end_recording()

    def start_recording(self, job):
        channel = job["channel"]
        if channel["id"] == hdmi.CHANNEL_ID:
            if not self.stream or not self.stream.get("hdmi") or not self.capture:
                raise RecordingError("Abre la entrada HDMI antes de grabar.")
        else:
            self.require_hardware()
        width, height, bitrate = RECORDING_QUALITIES.get(job.get("quality"), RECORDING_QUALITIES[1080])
        path = self.recordings.reserve(job)
        process = None
        try:
            if self.job:
                terminate(self.job["process"])
                shutil.rmtree(self.job["folder"], ignore_errors=True)
                self.job = None
                self.scan = {"state": "error", "message": "La búsqueda se detuvo para iniciar una grabación."}
            self.autoplay_pending = False
            if self.capture and self.capture.uhf != channel["uhf"]:
                self.stop_stream()
                self.stream_error = f"Grabación en UHF {channel['uhf']}. Puedes ver otro canal de esa frecuencia."
            capture = self.ensure_transport(channel)
            program = f"0:p:{channel['sid']}"
            video = (["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-realtime", "1", "-b:v", bitrate]
                     if VIDEO_ENCODER[1] == "h264_videotoolbox"
                     else ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "18"])
            if "audio" in job:
                preference = job["audio"]
                tracks = capture.audio.wait(channel["sid"], timeout=7 if preference else 2.5)
                if preference and tracks is None:
                    raise RecordingError("No se pudo comprobar la pista de audio. Revisa la señal de antena.")
                selected = match_track(tracks or [], preference) if preference else primary_track(tracks or [])
                if preference and selected is None:
                    raise RecordingError("La pista elegida no se emite en este momento.")
                audio_map = ["-map", f"0:i:{selected['pid']}" if selected else f"{program}:a:0"]
            else:
                # Jobs scheduled by older releases retain their original multitrack behavior.
                description = f"{program}:a:disp:visual_impaired"
                audio_map = ["-map", f"{program}:a?", "-map", f"-{description}?", "-map", f"{description}?"]
            with (self.data / "grabacion.log").open("wb") as log:
                process = subprocess.Popen(
                    ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-y",
                     "-analyzeduration", "3000000", "-probesize", "5000000", "-f", "mpegts", "-i", "pipe:0",
                     "-map", f"{program}:v:0", *audio_map,
                     "-disposition:a", "-default", "-disposition:a:0", "+default",
                     "-vf", f"bwdif=mode=send_frame:deint=interlaced,scale={width}:{height}:"
                            "force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1",
                     *video, "-pix_fmt", "yuv420p", "-fps_mode", "cfr", "-g", "50",
                     "-af", "aresample=48000:async=100", "-c:a", "aac", "-ac", "2", "-b:a", "256k",
                     # Write the MP4 header after seeing both tracks so it can retain their initial offset.
                     "-movflags", "+frag_keyframe+delay_moov+default_base_moof", str(path)],
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=log, env=ENV,
                )
            active = self.recordings.update(job, state="recording", file=str(path))
            feed = capture.attach(process.stdin, buffer_bytes=RECORDING_BUFFER_BYTES)
        except (OSError, RecordingError):
            if process:
                terminate(process)
                process.stdin.close()
            path.unlink(missing_ok=True)
            self.release_transport()
            raise
        self.recording = {"job": active, "process": process, "feed": feed, "path": path,
                          "finishing": None, "error": None, "started": time.monotonic()}

    def end_recording(self, error=None):
        recording = self.recording
        recording.update(finishing=time.monotonic(), error=error)
        self.capture.detach(recording["feed"])
        recording["job"] = self.recordings.update(recording["job"], state="finishing")

    def check_recordings(self):
        now = time.time()
        if self.recording:
            recording = self.recording
            result = recording["process"].poll()
            finishing = recording["finishing"]
            if finishing is None and result is None:
                path = recording["path"]
                last_write = path.stat().st_mtime if path.exists() else 0
                stale = time.monotonic() - recording["started"] > 45 and now - last_write > 45
                if recording["feed"].failed:
                    self.end_recording(RECORDING_BUFFER_ERROR)
                elif self.capture.process.poll() is not None or stale:
                    self.end_recording("Se interrumpió la recepción de la señal.")
                elif now >= recording["job"]["end"]:
                    self.end_recording()
            elif result is not None or time.monotonic() - finishing > 12:
                self.finish_recording()
        if not self.recording:
            for job in self.recordings.jobs:
                if job["state"] != "scheduled" or job["start"] > now:
                    continue
                if job["end"] <= now:
                    self.recordings.update(job, state="error", message="Pasó la hora de la grabación.")
                    continue
                try:
                    self.start_recording(job)
                except (RecordingError, TunerError, OSError) as error:
                    current = next(item for item in self.recordings.jobs if item["id"] == job["id"])
                    message = str(error) if isinstance(error, (RecordingError, TunerError)) else "No se pudo iniciar la grabación."
                    self.recordings.update(current, state="error", message=message)
                break

    def finish_recording(self):
        recording = self.recording
        self.capture.detach(recording["feed"])
        process, path = recording["process"], recording["path"]
        if process.poll() is None:
            terminate(process)
        recording["feed"].worker.join(timeout=2)
        has_video = path.exists() and path.stat().st_size > 1024
        error = recording["error"]
        if not error and recording["feed"].failed:
            error = RECORDING_BUFFER_ERROR
        if not error and (process.returncode != 0 or not has_video or recording["finishing"] is None):
            error = "La grabación se interrumpió. Revisa la señal y el espacio de la carpeta."
        if not has_video:
            path.unlink(missing_ok=True)
        self.recording = None
        self.release_transport()
        self.recordings.update(recording["job"], state="error" if error else "done",
                               message=error, file=str(path) if has_video else None)

    def flush_recording(self):
        try:
            self.recording["process"].wait(timeout=4)
        except subprocess.TimeoutExpired:
            pass
        self.finish_recording()

    def stop_stream(self, *, cancel_autoplay=True, keep_capture=False):
        with self.lock:
            if cancel_autoplay:
                self.autoplay_pending = False
            if self.stream:
                stream = self.stream
                self.stream = None
                self.capture.detach(stream["feed"])
                terminate(stream["encoder"])
                stream["feed"].worker.join(timeout=2)
                stream["levels_worker"].join(timeout=2)
                if not keep_capture:
                    self.release_transport()
                shutil.rmtree(stream["folder"], ignore_errors=True)

    def check_stream(self):
        stream = self.stream
        if not stream:
            return
        try:
            stale = time.time() - stream["playlist"].stat().st_mtime > 24
        except FileNotFoundError:
            stale = time.monotonic() - stream["started"] > 36
        if stale or stream["feed"].failed or stream["encoder"].poll() is not None or self.capture.process.poll() is not None:
            tuner_log = RF_CNR.sub("", RF_LINE.sub("", tail(self.capture.log))).replace("RF CNR UNAVAILABLE", "").strip()
            diagnostics = tuner_log + "\n" + tail(stream["folder"] / "ffmpeg.log")
            if diagnostics.strip():
                print(diagnostics.strip()[-1600:], flush=True)
            self.stop_stream(cancel_autoplay=False)
            if stream.get("hdmi"):
                self.stream_error = ("Se interrumpió la captura HDMI. Revisa la entrada USB, el receptor y el audio en Ubuntu."
                                     if hdmi.linux_enabled() else
                                     "Se interrumpió la captura HDMI. Revisa la entrada USB, el receptor y los permisos de macOS.")
            else:
                self.stream_error = (tuner_log.splitlines()[-1] if tuner_log else
                                     "La emisión se interrumpió. Revisa la antena y la conexión USB.")
            if self.stream_error == USB_BUSY:
                self.autoplay_pending = False
        elif stream["playlist"].is_file():
            if stream["levels"].origin is None:
                stream["levels"].playlist(stream["playlist"].read_bytes())
            if stream.get("hdmi"):
                return
            self.remember_stream_size(stream)
            if self.last_channel == stream["channel"]:
                return
            self.last_channel = stream["channel"]
            try:
                pending = self.last_channel_path.with_suffix(".tmp")
                pending.write_text(self.last_channel)
                pending.replace(self.last_channel_path)
            except OSError as error:
                print(error, flush=True)

    def remember_stream_size(self, stream):
        channel = self.channels[stream["channel"]]
        if stream.get("size_checked"):
            return
        stream["size_checked"] = True
        try:
            probe = subprocess.check_output(
                ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                 "-of", "json", str(stream["folder"] / "init.mp4")], timeout=2, stderr=subprocess.DEVNULL,
            )
            size = next(iter(json.loads(probe).get("streams", [])), {})
            if not (size.get("width", 0) > 0 and size.get("height", 0) > 0):
                return
            if (channel.get("width"), channel.get("height")) == (size["width"], size["height"]):
                return
            channels = {**self.channels, channel["id"]: {**channel, "width": size["width"], "height": size["height"]}}
            write_json(self.channels_path, list(channels.values()))
            self.channels = channels
        except (OSError, subprocess.SubprocessError, ValueError):
            # The live stream can play even when its size could not be saved.
            pass

    def maintenance(self, stop):
        while not stop.wait(0.5):
            with self.lock:
                self.finish_scan()
                self.check_stream()
                try:
                    self.check_recordings()
                except OSError as error:
                    print(error, flush=True)
                self.advance_autoplay()
            try:
                self.guide.save()
            except OSError as error:
                print(error, flush=True)

    def close(self):
        self.mobile.stop()
        with self.lock:
            self.stop_stream()
            if self.recording:
                if self.recording["finishing"] is None:
                    self.end_recording("La aplicación se cerró antes de que terminara la grabación.")
                self.flush_recording()
            if self.job:
                terminate(self.job["process"])
                shutil.rmtree(self.job["folder"], ignore_errors=True)
                self.job = None
        self.guide.save(force=True)


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".m3u8": "application/vnd.apple.mpegurl", ".mp4": "video/mp4", ".m4s": "video/mp4",
}
STATIC_PATHS = {"/": WEB / "index.html", "/style.css": WEB / "style.css", "/tv.js": WEB / "tv.js",
                "/language.js": WEB / "language.js",
                "/changelog.css": WEB / "changelog.css",
                "/program.js": WEB / "program.js", "/program.css": WEB / "program.css",
                "/playback.js": WEB / "playback.js", "/recordings.js": WEB / "recordings.js",
                "/studio.js": WEB / "studio.js", "/studio.css": WEB / "studio.css",
                "/picture.js": WEB / "picture.js", "/picture.css": WEB / "picture.css",
                "/appearance.js": WEB / "appearance.js", "/hls.min.js": WEB / "hls.min.js",
                "/qrcode.js": WEB / "qrcode.js", "/mobile-share.js": WEB / "mobile-share.js",
                "/mobile-share.css": WEB / "mobile-share.css",
                "/assets/canales/catalogo.js": CHANNEL_LOGOS / "catalogo.js",
                "/assets/fonts/InterVariable.woff2": ROOT / "assets" / "fonts" / "InterVariable.woff2",
                "/assets/fonts/GeistMono-Variable.ttf": ROOT / "assets" / "fonts" / "GeistMono-Variable.ttf",
                "/assets/changelog-innsmouth.webp": ROOT / "assets" / "changelog-innsmouth.webp",
                "/assets/live-picture-innsmouth.webp": ROOT / "assets" / "live-picture-innsmouth.webp",
                "/assets/arkhamtv-mark.svg": ROOT / "assets" / "arkhamtv-mark.svg",
                "/assets/logo_arkhamtv.png": ROOT / "assets" / "logo_arkhamtv.png",
                "/assets/logo_arkhamtv.svg": ROOT / "assets" / "logo_arkhamtv.svg",
                "/assets/logo_arkhamtv-claro.svg": ROOT / "assets" / "logo_arkhamtv-claro.svg"}

if SIGNAL_ANALYSIS:
    STATIC_PATHS.update({"/" + name: WEB / name for name in (
        "broadcast-channel-picker.js", "signal-analysis.js", "signal-analysis.css", "signal-scene.js", "teletext.css", "teletext.js",
        "vendor/three.module.min.js", "vendor/three.core.min.js", "vendor/d3.min.js",
    )})


def handler(tv):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            if len(args) > 1 and str(args[1]) not in {"200", "204", "206", "404"}:
                super().log_message(fmt, *args)

        def video_range(self, length):
            match = re.fullmatch(r"bytes=(\d{0,18})-(\d{0,18})", self.headers.get("Range", ""))
            if not match or not (match[1] or match[2]):
                return 0, length, None, HTTPStatus.OK
            start = int(match[1]) if match[1] else max(0, length - int(match[2]))
            end = min(length - 1, int(match[2])) if match[1] and match[2] else length - 1
            if start > end:
                return 0, 0, f"bytes */{length}", HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE
            return start, end + 1, f"bytes {start}-{end}/{length}", HTTPStatus.PARTIAL_CONTENT

        def send_file_headers(self, length, content_type, status, content_range=None):
            self.send_response(status)
            if content_type == "video/mp4":
                self.send_header("Accept-Ranges", "bytes")
            if content_range:
                self.send_header("Content-Range", content_range)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; media-src 'self' blob:; frame-ancestors 'none'")
            self.end_headers()

        def send_bytes(self, body, content_type, status=HTTPStatus.OK):
            content_range = None
            if content_type == "video/mp4":
                start, stop, content_range, status = self.video_range(len(body))
                body = body[start:stop]
            self.send_file_headers(len(body), content_type, status, content_range)
            if self.command != "HEAD":
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def send_recording(self, identifier):
            try:
                with tv.lock:
                    handle, length = tv.recordings.open_video(identifier)
            except (OSError, RecordingError):
                self.send_json({"error": "No se encuentra el archivo de esta grabación."}, HTTPStatus.NOT_FOUND)
                return
            with handle:
                start, stop, content_range, status = self.video_range(length)
                self.send_file_headers(stop - start, "video/mp4", status, content_range)
                if self.command == "HEAD":
                    return
                handle.seek(start)
                try:
                    while start < stop and (chunk := handle.read(min(256 * 1024, stop - start))):
                        self.wfile.write(chunk)
                        start += len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def send_json(self, data, status=HTTPStatus.OK):
            self.send_bytes(json.dumps(data, ensure_ascii=False).encode(), "application/json", status)

        def local_host(self):
            port = self.server.server_port
            return self.headers.get("Host") in {f"127.0.0.1:{port}", f"localhost:{port}"}

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            if not self.local_host():
                self.send_json({"error": "Usa localhost para acceder a la aplicación."}, HTTPStatus.FORBIDDEN)
                return
            url = urlsplit(self.path)
            path = url.path
            recording = re.fullmatch(r"/grabacion/([0-9a-f]{16})\.mp4", path)
            if recording:
                self.send_recording(recording[1])
                return
            if path == "/api/status":
                self.send_json(tv.status())
                return
            if path == "/api/hdmi-devices" and hdmi.available():
                try:
                    if hdmi.linux_enabled():
                        from native.hdmi_linux import authorization_socket, missing_interfaces

                        missing = missing_interfaces()
                        if missing:
                            self.send_json({"video": [], "audio": [], "authorized": False,
                                            "missingInterfaces": missing, "hdmiHelper": authorization_socket().is_socket()})
                            return
                    inputs = hdmi.devices()
                    if hdmi.linux_enabled():
                        with tv.lock:
                            permissions = {kind: bool(os.environ.get("SNAP")) or kind in tv.hdmi_permissions
                                           for kind in ("video", "audio")}
                        inputs = {kind: [{key: item[key] for key in ("id", "name", "group")} for item in choices]
                                  for kind, choices in inputs.items()}
                        inputs.update(permissions=permissions, authorized=all(permissions.values()))
                    self.send_json(inputs)
                except (OSError, ValueError, subprocess.SubprocessError):
                    self.send_json({"error": "No se pudieron consultar las entradas de captura HDMI." if hdmi.linux_enabled()
                                    else "No se pudieron consultar las capturadoras de macOS."}, HTTPStatus.CONFLICT)
                return
            if SIGNAL_ANALYSIS and path == "/api/signal-analysis":
                self.send_json(tv.signal_analysis())
                return
            if SIGNAL_ANALYSIS and path == "/api/teletext":
                query = parse_qs(url.query)
                try:
                    number = int(query.get("page", ["100"])[0])
                    subpage = int(query.get("subpage", ["-1"])[0])
                    revision = int(query.get("revision", ["-1"])[0])
                    if not 100 <= number <= 899 or not -1 <= subpage <= 0x3F7F or revision < -1:
                        raise ValueError
                except ValueError:
                    self.send_json({"error": "Elige una página entre 100 y 899."}, HTTPStatus.BAD_REQUEST)
                    return
                self.send_json(tv.teletext(number, subpage, revision))
                return
            if path == "/api/levels":
                query = parse_qs(url.query)
                try:
                    position = float(query.get("at", ["nan"])[0])
                except ValueError:
                    position = float("nan")
                self.send_json(tv.levels(query.get("stream", [""])[0], position))
                return
            if path == "/api/guide":
                query = parse_qs(url.query)
                now = int(time.time())
                try:
                    start = int(query.get("from", [now])[0])
                    end = int(query.get("to", [start + 14400])[0])
                    if not 0 < end - start <= 86400:
                        raise ValueError
                except ValueError:
                    self.send_json({"error": "Elige un intervalo de hasta 24 horas."}, HTTPStatus.BAD_REQUEST)
                    return
                with tv.lock:
                    channels = tuple(tv.channels)
                self.send_json(tv.guide.schedule(channels, start, end))
                return
            file = STATIC_PATHS.get(path)
            logo = re.fullmatch(r"/assets/canales/([a-z0-9-]+\.png)", path)
            if logo:
                file = CHANNEL_LOGOS / logo[1]
            match = MEDIA_PATH.fullmatch(path)
            stream = None
            if match:
                with tv.lock:
                    if tv.stream and match[1] == tv.stream["id"]:
                        stream = tv.stream
                        file = stream["folder"] / match[2]
            if file:
                try:
                    body = file.read_bytes()
                except FileNotFoundError:
                    pass
                else:
                    if stream and file == stream["playlist"]:
                        body = stream["levels"].playlist(body)
                    if path == "/":
                        body = body.replace(b"{{APP_VERSION}}", APP_VERSION.encode("ascii"))
                        body = body.replace(b"{{CHANGELOG_ENTRIES}}", CHANGELOG)
                        if SIGNAL_ANALYSIS:
                            body = body.replace(b"<!-- SIGNAL_ASSETS -->",
                                                b'<link rel="stylesheet" href="/signal-analysis.css">\n'
                                                b'<link rel="stylesheet" href="/teletext.css">\n'
                                                b'<script src="/broadcast-channel-picker.js" defer></script>\n'
                                                b'<script src="/signal-analysis.js" defer></script>\n'
                                                b'<script src="/teletext.js" defer></script>')
                    self.send_bytes(body, CONTENT_TYPES[file.suffix])
                    return
            self.send_json({"error": "No disponible."}, HTTPStatus.NOT_FOUND)

        def do_POST(self):
            origin = self.headers.get("Origin")
            if not self.local_host() or (origin and origin != f'http://{self.headers["Host"]}'):
                self.send_json({"error": "Origen no permitido."}, HTTPStatus.FORBIDDEN)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096 or self.headers.get_content_type() != "application/json":
                    raise ValueError
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError
                path = urlsplit(self.path).path
                if path == "/api/mobile-start":
                    address = data.get("address")
                    if address is not None and not isinstance(address, str):
                        raise ValueError
                    try:
                        self.send_json(tv.mobile.start(address, "en" if data.get("language") == "en" else "es"))
                    except (ValueError, OSError, subprocess.SubprocessError):
                        self.send_json({"error": "No se pudo abrir la conexión local. Comprueba la red del ordenador."},
                                       HTTPStatus.CONFLICT)
                    return
                elif path == "/api/mobile-stop":
                    tv.mobile.stop()
                elif path == "/api/scan":
                    first, last = data.get("first"), data.get("last")
                    fresh = data.get("fresh", False)
                    if (type(fresh) is not bool or type(first) is not int or type(last) is not int
                            or not MIN_CHANNEL <= first <= last <= MAX_CHANNEL):
                        raise ValueError
                    tv.start_scan(first, last, fresh=fresh)
                elif path == "/api/tuning-save":
                    name = data.get("name")
                    if not isinstance(name, str):
                        raise TunerError("Escribe un nombre para la sintonización.")
                    tv.save_profile(name)
                elif path in {"/api/tuning-load", "/api/tuning-delete"}:
                    identifier = data.get("id")
                    if not isinstance(identifier, str):
                        raise TunerError("Selecciona una sintonización guardada.")
                    if path == "/api/tuning-load":
                        tv.load_profile(identifier)
                    else:
                        tv.delete_profile(identifier)
                elif path == "/api/recording-folder":
                    folder = data.get("folder")
                    if not isinstance(folder, str) or not folder.strip() or "\x00" in folder:
                        raise RecordingError("Escribe una carpeta local válida.")
                    tv.set_recording_folder(folder.strip())
                elif path == "/api/recording-open-folder":
                    identifier = data.get("id")
                    if identifier is not None and not isinstance(identifier, str):
                        raise RecordingError("Selecciona una grabación.")
                    tv.open_recording_folder(identifier)
                elif path in {"/api/recording-now", "/api/recording-schedule"}:
                    identifier, start = data.get("id"), data.get("start")
                    pid, quality = data.get("audioPid"), data.get("quality", 1080)
                    if not isinstance(identifier, str) or (path.endswith("-schedule") and type(start) is not int):
                        raise RecordingError("Selecciona un canal o un programa de la guía.")
                    if type(quality) is not int or quality not in RECORDING_QUALITIES:
                        raise RecordingError("Elige una calidad de grabación válida.")
                    if pid is not None and (type(pid) is not int or not 1 <= pid < 8191):
                        raise RecordingError("Esa pista de audio ya no está disponible.")
                    tv.schedule_recording(identifier, start if path.endswith("-schedule") else None,
                                          audio_pid=pid, quality=quality)
                elif path == "/api/live-audio":
                    identifier, pid = data.get("id"), data.get("audioPid")
                    if not isinstance(identifier, str) or type(pid) is not int or not 1 <= pid < 8191:
                        raise TunerError("Esa pista de audio ya no está disponible.")
                    tv.select_audio(identifier, pid)
                elif path in {"/api/recording-stop", "/api/recording-delete"}:
                    identifier = data.get("id")
                    if not isinstance(identifier, str):
                        raise RecordingError("Selecciona una grabación.")
                    if path == "/api/recording-stop":
                        tv.cancel_recording(identifier)
                    else:
                        with tv.lock:
                            tv.recordings.delete(identifier)
                elif path == "/api/tune":
                    channel = data.get("id")
                    if not isinstance(channel, str):
                        raise ValueError
                    tv.start_stream(channel)
                elif path == "/api/hdmi-start" and hdmi.available():
                    video, audio = data.get("video"), data.get("audio")
                    deinterlace, gain = data.get("deinterlace", "auto"), data.get("gain", 0)
                    if not all(isinstance(value, str) and 0 < len(value) <= 512 for value in (video, audio)):
                        raise TunerError("Selecciona la entrada de vídeo y el audio de la capturadora HDMI.")
                    if deinterlace not in ("auto", "on", "off") or type(gain) is not int or gain not in (0, 6, 12, 18):
                        raise TunerError("Elige un ajuste válido de vídeo y audio HDMI.")
                    tv.start_hdmi(video, audio, deinterlace, gain)
                elif path == "/api/hdmi-permission" and hdmi.linux_enabled() and not os.environ.get("SNAP"):
                    kind = data.get("kind")
                    if kind not in ("video", "audio"):
                        raise TunerError("Elige un permiso de captura HDMI válido.")
                    with tv.lock:
                        tv.hdmi_permissions.add(kind)
                elif SIGNAL_ANALYSIS and path == "/api/signal-tune":
                    channel = data.get("id")
                    if not isinstance(channel, str):
                        raise ValueError
                    tv.tune_for_analysis(channel)
                elif SIGNAL_ANALYSIS and path == "/api/teletext-tune":
                    channel = data.get("id")
                    if not isinstance(channel, str):
                        raise ValueError
                    tv.tune_for_teletext(channel)
                elif path == "/api/autoplay":
                    tv.autoplay()
                elif path == "/api/guide-refresh":
                    tv.start_scan(guide=True)
                elif path == "/api/movie-key":
                    key = data.get("key")
                    if not isinstance(key, str):
                        raise movies.MovieLookupError("Introduce una clave de OMDb válida.")
                    key = key.strip()
                    if key:
                        movies.verify_key(key)
                    with tv.lock:
                        movies.save_key(tv.movie_key_path, key)
                        tv.movie_key = key
                elif path == "/api/movie-search":
                    title, year = data.get("title"), data.get("year", "")
                    if not isinstance(title, str) or not 0 < len(title.strip()) <= 200:
                        raise movies.MovieLookupError("Introduce el título de la película.")
                    if not isinstance(year, str) or (year and not re.fullmatch(r"[0-9]{4}", year)):
                        raise movies.MovieLookupError("Introduce un año de cuatro cifras o deja el campo vacío.")
                    self.send_json({"matches": movies.search(tv.movie_key, title.strip(), year)})
                    return
                elif path == "/api/movie-details":
                    identifier = data.get("id")
                    if not isinstance(identifier, str) or not movies.IMDB_ID.fullmatch(identifier):
                        raise movies.MovieLookupError("Selecciona una película de la lista.")
                    self.send_json({"movie": movies.details(tv.movie_key, identifier)})
                    return
                elif path == "/api/equalizer":
                    gains = data.get("gains")
                    if not valid_gains(gains):
                        self.send_json({"error": "Usa diez valores enteros entre −12 y +12 dB."}, HTTPStatus.BAD_REQUEST)
                        return
                    tv.set_equalizer(gains)
                elif path == "/api/audio-delay":
                    channel, delay = data.get("id"), data.get("ms")
                    if not isinstance(channel, str) or type(delay) is not int or abs(delay) > MAX_AUDIO_DELAY_MS:
                        self.send_json({"error": "El ajuste debe estar entre −2000 y +2000 ms."}, HTTPStatus.BAD_REQUEST)
                        return
                    tv.set_audio_delay(channel, delay)
                elif path == "/api/stop":
                    tv.stop_stream()
                else:
                    self.send_json({"error": "Acción desconocida."}, HTTPStatus.NOT_FOUND)
                    return
                self.send_json({"ok": True})
            except ValueError:
                self.send_json({"error": "Datos no válidos. El rango UHF es del 21 al 48."}, HTTPStatus.BAD_REQUEST)
            except TunerError as error:
                self.send_json({"error": str(error)}, HTTPStatus.CONFLICT)
            except RecordingError as error:
                self.send_json({"error": str(error)}, HTTPStatus.CONFLICT)
            except movies.MovieLookupError as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            except OSError as error:
                print(error, flush=True)
                self.send_json({"error": "No se pudo iniciar la operación. Revisa el registro del servidor."},
                               HTTPStatus.INTERNAL_SERVER_ERROR)

    return Handler


class LocalServer(ThreadingHTTPServer):
    def __init__(self, port, request_handler, *, activated=False, idle_timeout=0):
        self.idle_timeout = 120 if activated else idle_timeout
        self.idle_deadline = time.monotonic() + self.idle_timeout if self.idle_timeout else None
        self.keep_alive = lambda: False
        super().__init__(("127.0.0.1", port), request_handler, bind_and_activate=not activated)
        if activated:
            self.socket.close()
            self.socket = launchd_listener()
            self.server_address = self.socket.getsockname()
            if self.server_address != ("127.0.0.1", port):
                self.server_close()
                raise RuntimeError("El socket de Arkham TV debe escuchar solo en localhost.")
            self.server_name, self.server_port = self.server_address

    def get_request(self):
        request = super().get_request()
        if self.idle_deadline is not None:
            self.idle_deadline = time.monotonic() + self.idle_timeout
        return request

    def service_actions(self):
        if self.idle_deadline is not None and time.monotonic() >= self.idle_deadline and not self.keep_alive():
            raise KeyboardInterrupt


def launchd_listener():
    library = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
    descriptors = ctypes.POINTER(ctypes.c_int)()
    count = ctypes.c_size_t()
    activate = library.launch_activate_socket
    activate.argtypes = [ctypes.c_char_p, ctypes.POINTER(type(descriptors)), ctypes.POINTER(ctypes.c_size_t)]
    activate.restype = ctypes.c_int
    error = activate(b"ArkhamTV", ctypes.byref(descriptors), ctypes.byref(count))
    if error:
        raise OSError(error, os.strerror(error))
    try:
        if count.value != 1:
            for descriptor in descriptors[:count.value]:
                os.close(descriptor)
            raise RuntimeError("Se esperaba un único socket para Arkham TV.")
        return socket.socket(fileno=descriptors[0])
    finally:
        library.free.argtypes = [ctypes.c_void_p]
        library.free.restype = None
        library.free(descriptors)


def main():
    parser = argparse.ArgumentParser(description="Visor local de TDT para AVerMedia A835.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Abre el visor en el navegador predeterminado.")
    parser.add_argument("--launchd", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--ready-file", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--data-dir", type=Path, default=ROOT / ".datos")
    parser.add_argument("--idle-timeout", type=int, default=0, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if platform.system() == "Darwin":
        build()
    tv = TV(args.data_dir.resolve())
    try:
        local_server = LocalServer(args.port, handler(tv), activated=args.launchd, idle_timeout=args.idle_timeout)
    except OSError as error:
        if not args.ready_file or error.errno != errno.EADDRINUSE:
            raise
        local_server = LocalServer(0, handler(tv), idle_timeout=args.idle_timeout)
    with local_server as server:
        server.keep_alive = lambda: bool(tv.mobile.status()["url"]) or any(
            job["state"] in {"scheduled", "recording", "finishing"} for job in tv.recordings.jobs)
        stop = threading.Event()
        worker = threading.Thread(target=tv.maintenance, args=(stop,), daemon=True)
        worker.start()
        signal.signal(signal.SIGTERM, server_interrupt)
        url = f"http://127.0.0.1:{server.server_port}"
        print(f"Arkham TV · {url}", flush=True)
        if args.ready_file:
            args.ready_file.write_text(str(server.server_port), encoding="ascii")
        if args.open:
            opener = "/usr/bin/open" if platform.system() == "Darwin" else shutil.which("xdg-open")
            if opener:
                subprocess.Popen([opener, url], stdin=subprocess.DEVNULL)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            stop.set()
            worker.join()
            tv.close()


def server_interrupt(*_):
    raise KeyboardInterrupt


if __name__ == "__main__":
    main()
