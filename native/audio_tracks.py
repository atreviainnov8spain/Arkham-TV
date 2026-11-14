"""Discover the audio components announced by a DVB multiplex."""

from threading import Condition

from .guide import EIT, Sections, valid_crc

AUDIO_TYPES = {0x03, 0x04, 0x0F, 0x11, 0x81, 0x87}
AUDIO_DESCRIPTORS = {0x6A, 0x7A, 0x7B, 0x7C}
AUDIO_ROLES = {1: "effects", 2: "clean", 3: "description"}


def describe_audio(data):
    private_audio, lang, role, component = False, None, None, None
    offset = 0
    while offset + 2 <= len(data):
        tag, length = data[offset:offset + 2]
        value = data[offset + 2:offset + 2 + length]
        offset += 2 + length
        if len(value) != length:
            break
        if tag in AUDIO_DESCRIPTORS:
            private_audio = True
        elif tag == 0x05 and value[:4] in (b"AC-3", b"EAC3", b"AC-4", b"DTS1", b"DTS2", b"DTS3", b"Opus"):
            private_audio = True
        elif tag == 0x0A and len(value) >= 4:
            lang = value[:3]
            role = AUDIO_ROLES.get(value[3])
        elif tag == 0x52 and value:
            component = value[0]
        elif tag == 0x7F and value:
            if value[0] == 0x15:  # AC-4
                private_audio = True
            elif value[0] == 0x06 and len(value) >= 2:
                flags = value[1]
                role = {1: "description", 2: "clean", 3: "spoken"}.get((flags >> 2) & 31, role)
                if flags & 2 and len(value) >= 5:
                    lang = value[2:5]
    language = lang.decode("ascii", "ignore").lower() if lang else ""
    return private_audio, language if len(language) == 3 and language.isalpha() else "", role, component


class Table(Sections):
    def __init__(self, catalog, pid):
        super().__init__()
        self.catalog, self.pid = catalog, pid
        self.last = None

    def read_section(self, data, _changes):
        if len(data) < 12 or not data[5] & 1 or data[-4:] == self.last or not valid_crc(data):
            return
        self.last = data[-4:]
        if self.catalog.on_table is not None:
            self.catalog.on_table(data)
        if self.pid == 0 and data[0] == 0:
            for offset in range(8, len(data) - 7, 4):
                sid = int.from_bytes(data[offset:offset + 2], "big")
                pid = int.from_bytes(data[offset + 2:offset + 4], "big") & 8191
                if sid and pid not in self.catalog.tables:
                    self.catalog.tables[pid] = Table(self.catalog, pid)
        elif data[0] == 2 and self.pid and len(data) >= 16:
            offset, end = 12 + (int.from_bytes(data[10:12], "big") & 4095), len(data) - 4
            tracks = []
            while offset + 5 <= end:
                stream_type = data[offset]
                pid = int.from_bytes(data[offset + 1:offset + 3], "big") & 8191
                size = int.from_bytes(data[offset + 3:offset + 5], "big") & 4095
                offset += 5
                if offset + size > end:
                    return
                if stream_type in AUDIO_TYPES or stream_type == 0x06:
                    private, language, role, component = describe_audio(data[offset:offset + size])
                    if stream_type in AUDIO_TYPES or private:
                        tracks.append({"pid": pid, "language": language, "role": role, "component": component})
                offset += size
            self.catalog.update(int.from_bytes(data[3:5], "big"), tracks)


class AudioTracks:
    def __init__(self, on_table=None):
        self.on_table = on_table
        self.tables = {0: Table(self, 0)}
        self.tracks = {}
        self.condition = Condition()
        self.closed = False

    def accepts(self, pid):
        return pid in self.tables

    def packet(self, pid, packet):
        self.tables[pid].packet(packet, None)

    def update(self, sid, tracks):
        with self.condition:
            self.tracks[sid] = tracks
            self.condition.notify_all()

    def snapshot(self):
        with self.condition:
            return dict(self.tracks)

    def wait(self, sid, timeout=2.5):
        with self.condition:
            self.condition.wait_for(lambda: sid in self.tracks or self.closed, timeout)
            return self.tracks.get(sid)

    def close(self):
        with self.condition:
            self.closed = True
            self.condition.notify_all()


def multiplex_metadata(data, frequency):
    audio = AudioTracks()
    events = EIT(frequency, audio).feed(data)
    return events, {f"{frequency}-{sid}": tracks for sid, tracks in audio.snapshot().items()}


def primary_track(tracks):
    return next((track for track in tracks if not track["role"]), tracks[0] if tracks else None)


def match_track(tracks, preferred):
    def same_content(track):
        return track["language"] == preferred["language"] and track["role"] == preferred["role"]

    matches = [track for track in tracks if same_content(track)]
    component = preferred.get("component")
    if component is not None:
        found = next((track for track in matches if track["component"] == component), None)
        if found:
            return found
    found = next((track for track in matches if track["pid"] == preferred["pid"]), None)
    if found:
        return found
    return matches[0] if len(matches) == 1 and preferred["language"] not in {"", "und"} else None
