"""Equalizer settings and audio measurements from the live encoder."""

from collections import deque
from datetime import datetime, timedelta
import math
import re
from threading import Lock

BANDS = (31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)
FLAT = [0] * len(BANDS)
LEVEL = re.compile(rb"lavfi\.astats\.(\d+)\.(RMS_level|Peak_level)=(\S+)")
FRAME_TIME = re.compile(rb"^frame:\d+\s+pts:(-?\d+)\b")
PROGRAM_DATE = re.compile(rb"(?m)^#EXT-X-PROGRAM-DATE-TIME:(\S+)$")


def valid_gains(value):
    return isinstance(value, list) and len(value) == len(BANDS) and all(
        type(gain) is int and -12 <= gain <= 12 for gain in value
    )


def audio_chain(gains, delay):
    filters = ["aformat=channel_layouts=stereo"]
    if delay > 0:
        filters.append(f"adelay={delay}:all=1")
    if any(gains):
        filters.append(f"volume={-max(0, *gains)}dB")
        filters.extend(f"equalizer=f={hz}:t=o:w=1:g={gain}" for hz, gain in zip(BANDS, gains) if gain)
        filters.append("alimiter=limit=0.95:level=false:latency=true")
    bands = "".join(f"[band{index}]" for index in range(len(BANDS)))
    crossover = " ".join(str(round(math.sqrt(low * high))) for low, high in zip(BANDS, BANDS[1:]))
    stats = "astats=metadata=1:reset=1:measure_overall=none:measure_perchannel="
    report = "ametadata=mode=print:file='pipe\\:1':direct=1"
    # Measure a copy so that the crossover does not alter the audio sent to the player.
    return (
        ",".join(filters) + ",aresample=48000,asetnsamples=n=1920:p=0,asplit[playback][analysis];"
        f"[analysis]acrossover=split={crossover}:order=4th{bands};"
        f"{bands}amerge=inputs={len(BANDS)},{stats}RMS_level,{report},anullsink;"
        f"[playback]{stats}RMS_level+Peak_level,{report}"
    )


class AudioLevels:
    def __init__(self):
        self.samples = deque(maxlen=1200)
        self.lock = Lock()
        self.origin = None
        self.video_start = None

    def playlist(self, body):
        with self.lock:
            if self.origin is None and b"#EXT-X-MEDIA-SEQUENCE:0\n" in body:
                first = PROGRAM_DATE.search(body)
                if first:
                    start = datetime.fromisoformat(first[1].decode("ascii"))
                    self.origin = start.replace(microsecond=0)
                    self.date_shift = self.origin - start
            shift = self.date_shift if self.origin else timedelta(0)
        # WebKit exposes the start date at whole-second precision.
        return PROGRAM_DATE.sub(lambda match: b"#EXT-X-PROGRAM-DATE-TIME:" + (
            datetime.fromisoformat(match[1].decode("ascii")) + shift
        ).isoformat(timespec="milliseconds").encode("ascii"), body)

    def near(self, position):
        with self.lock:
            if self.origin is None or self.video_start is None:
                return []
            offset = self.origin.timestamp() - self.video_start
            return [[round(pts + offset, 3), rms, peak, spectrum]
                    for pts, rms, peak, spectrum in self.samples
                    if position - 0.16 <= pts + offset <= position + 2]

    def read(self, output):
        pending = {}
        pts, rms, peaks = None, {}, {}
        with output:
            for line in output:
                if line.startswith(b"video:0:"):
                    with self.lock:
                        self.video_start = float(line.split(b":")[2])
                elif line.startswith(b"frame:"):
                    match = FRAME_TIME.match(line)
                    pts = int(match[1]) / 48000 if match else None
                    rms, peaks = {}, {}
                elif pts is not None and (match := LEVEL.fullmatch(line.strip())):
                    channel, kind, value = match.groups()
                    level = float(value)
                    level = round(max(-72, min(0, level)), 1) if math.isfinite(level) else -72
                    values = rms if kind == b"RMS_level" else peaks
                    values[int(channel)] = level
                    parts = pending.setdefault(pts, {})
                    if len(rms) == 2 * len(BANDS):
                        # The merged channels are consecutive stereo pairs, from low to high.
                        parts["spectrum"] = [max(rms[index], rms[index + 1]) for index in range(1, 2 * len(BANDS), 2)]
                    elif len(rms) == 2 and len(peaks) == 2:
                        parts["rms"] = [rms[1], rms[2]]
                        parts["peak"] = [peaks[1], peaks[2]]
                    if len(parts) == 3:
                        with self.lock:
                            self.samples.append((pts, parts["rms"], parts["peak"], parts["spectrum"]))
                        del pending[pts]
                    if len(pending) > 50:
                        del pending[next(iter(pending))]
