"""Measure the multiplex already being read by the tuner."""

from collections import deque
import threading
import time

from .audio_tracks import AUDIO_TYPES, describe_audio
from .guide import PACKET, Sections, dvb_text, valid_crc

FLOW = ("video", "audio", "subtitles", "teletext", "other")
VIDEO_CODECS = {1: "MPEG-1", 2: "MPEG-2", 0x10: "MPEG-4", 0x1B: "H.264", 0x24: "HEVC", 0x33: "VVC"}
AUDIO_CODECS = {3: "MPEG audio", 4: "MPEG audio", 0x0F: "AAC", 0x11: "AAC LATM", 0x81: "AC-3", 0x87: "E-AC-3"}
SECONDS = 60


def descriptors(data):
    offset = 0
    while offset + 2 <= len(data):
        tag, length = data[offset:offset + 2]
        offset += 2
        value = data[offset:offset + length]
        if len(value) != length:
            return
        yield tag, value
        offset += length


def components(data):
    end = len(data) - 4
    offset = 12 + (int.from_bytes(data[10:12], "big") & 0xFFF)
    tracks = []
    while offset + 5 <= end:
        type_ = data[offset]
        pid = int.from_bytes(data[offset + 1:offset + 3], "big") & 0x1FFF
        length = int.from_bytes(data[offset + 3:offset + 5], "big") & 0xFFF
        offset += 5
        if offset + length > end:
            return None
        info = data[offset:offset + length]
        tags = dict(descriptors(info))
        offset += length
        private, language, _, _ = describe_audio(info)
        if type_ in VIDEO_CODECS:
            kind, codec = "video", VIDEO_CODECS[type_]
        elif type_ in AUDIO_TYPES or (type_ == 6 and private):
            kind = "audio"
            codec = AUDIO_CODECS.get(type_) or next(
                (name for tag, name in ((0x6A, "AC-3"), (0x7A, "E-AC-3"), (0x7B, "DTS"), (0x7C, "AAC")) if tag in tags), "")
        elif type_ == 6 and 0x59 in tags:
            kind, codec = "subtitles", "DVB"
            language = tags[0x59][:3].decode("ascii", "ignore")
        elif type_ == 6 and 0x56 in tags:
            kind, codec = "teletext", ""
            language = tags[0x56][:3].decode("ascii", "ignore")
        else:
            kind, codec = "other", ""
            language = ""
        tracks.append({"kind": kind, "codec": codec,
                       "language": language if len(language) == 3 and language.isalpha() else "",
                       "pid": pid})
    return tracks


class NetworkTable(Sections):
    def __init__(self, analysis):
        super().__init__()
        self.analysis = analysis
        self.last = None

    def read_section(self, data, _changes):
        if len(data) < 16 or data[0] != 0x40 or not data[5] & 1 or data[-4:] == self.last or not valid_crc(data):
            return
        self.last = data[-4:]
        length = int.from_bytes(data[8:10], "big") & 0xFFF
        if 10 + length + 2 <= len(data) - 4:
            for tag, value in descriptors(data[10:10 + length]):
                if tag == 0x40:
                    self.analysis.network = dvb_text(value)


class SignalAnalysis:
    def __init__(self):
        self.lock = threading.Lock()
        self.network = ""
        self.network_table = NetworkTable(self)
        self.network_pid = 0x10
        self.tsid = None
        self.programs = {}
        self.events = deque(maxlen=30)
        self.selected = None
        self.window = deque()
        self.started = time.monotonic()
        self.published = None
        self.counts = {}
        self.errors = 0
        self.error_started = None

    def packet(self, pid, data, offset):
        self.counts[pid] = self.counts.get(pid, 0) + 1
        if data[offset + 1] & 0x80:
            self.errors += 1
        elif pid == self.network_pid:
            self.network_table.packet(data[offset:offset + PACKET], None)

    def table(self, data):
        if data[0] == 0:
            self.tsid = int.from_bytes(data[3:5], "big")
            for offset in range(8, len(data) - 7, 4):
                if int.from_bytes(data[offset:offset + 2], "big") == 0:
                    pid = int.from_bytes(data[offset + 2:offset + 4], "big") & 0x1FFF
                    if pid != self.network_pid:
                        self.network_pid = pid
                        self.network_table = NetworkTable(self)
                    break
        elif data[0] == 2 and len(data) >= 16:
            sid = int.from_bytes(data[3:5], "big")
            tracks = components(data)
            if tracks is None:
                return
            previous = self.programs.get(sid)
            self.programs[sid] = tracks
            if previous != tracks:
                with self.lock:
                    if sid == self.selected:
                        self.events.append({"time": time.time(), "type": "tracks" if previous is None else "changed",
                                            "sid": sid, "count": len(tracks)})

    def select(self, sid):
        with self.lock:
            self.selected = sid
            self.events.append({"time": time.time(), "type": "selected", "sid": sid})

    def commit(self):
        now = time.monotonic()
        if now - self.started < 1:
            return
        categories = {track["pid"]: track["kind"] for tracks in self.programs.values() for track in tracks}
        self.window.append((self.started, now, self.counts, self.errors, categories))
        self.error_started = self.started if self.error_started is None else self.error_started
        self.started, self.counts, self.errors = now, {}, 0
        while self.window and self.window[0][1] < now - SECONDS:
            self.window.popleft()
        with self.lock:
            self.published = (tuple(self.window), now, self.error_started, self.network, self.tsid,
                              dict(self.programs))

    def snapshot(self, sid):
        with self.lock:
            published = self.published
            events = list(self.events)
        now = time.monotonic()
        recent = [event for event in reversed(events) if event["time"] >= time.time() - SECONDS]
        if not published or now - published[1] > 3:
            return {"events": recent}
        window, _, error_started, network, tsid, programs = published
        tracks = programs.get(sid, [])
        pids = {track["pid"] for track in tracks}
        periods = [(start, end, counts, categories) for start, end, counts, _, categories in window if end >= now - 4]
        flow = dict.fromkeys(FLOW, 0)
        current = {}
        for _, _, counts, categories in periods:
            for pid, count in counts.items():
                flow[categories.get(pid, "other")] += count
                if pid in pids:
                    current[pid] = current.get(pid, 0) + count
        factor = PACKET * 8 / (1_000_000 * sum(end - start for start, end, *_ in periods))
        return {
            "network": network, "tsid": tsid, "rate": sum(flow.values()) * factor,
            "flows": {kind: count * factor for kind, count in flow.items()},
            "serviceRate": sum(current.values()) * factor if tracks else None,
            "tracks": [{**track, "rate": current.get(track["pid"], 0) * factor} for track in tracks],
            "errors": sum(errors for _, end, _, errors, _ in window if end >= now - SECONDS),
            "errorSeconds": min(SECONDS, max(1, round(window[-1][1] - error_started))),
            "events": recent,
        }
