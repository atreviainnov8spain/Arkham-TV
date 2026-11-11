"""Read DVB event information from PID 0x12 of an MPEG transport stream."""

import json
import threading
import time
import unicodedata

PACKET = 188
ACCENTS = dict(zip(range(0xC1, 0xD0), "\u0300\u0301\u0302\u0303\u0304\u0306\u0307\u0308\u0308\u030a\u0327\u030b\u0328\u030c\u030c"))
LATIN = {
    0xA4: "€", 0xA9: "‘", 0xAA: "“", 0xB9: "’", 0xBA: "”",
    0xD0: "—", 0xD1: "¹", 0xD2: "®", 0xD3: "©", 0xD4: "™",
    0xE1: "Æ", 0xE9: "Ø", 0xEA: "Œ", 0xF1: "æ", 0xF9: "ø", 0xFA: "œ",
}


def dvb_text(value):
    if not value:
        return ""
    first = value[0]
    if 1 <= first <= 11:
        encoding, value = f"iso8859_{first + 4}", value[1:]
    elif first == 0x10 and len(value) >= 3 and value[1] == 0:
        encoding, value = f"iso8859_{value[2]}", value[3:]
    elif first in (0x11, 0x12, 0x13, 0x14, 0x15):
        encoding = {0x11: "utf-16-be", 0x12: "euc-kr", 0x13: "gb2312", 0x14: "big5", 0x15: "utf-8"}[first]
        value = value[1:]
    elif first < 32:
        return ""
    else:
        chars = []
        accent = ""
        for byte in value:
            if byte in ACCENTS:
                accent = ACCENTS[byte]
            elif byte == 0x8A:
                chars.append(" ")
                accent = ""
            elif 32 <= byte < 127 or byte >= 160:
                chars.append(LATIN.get(byte, chr(byte)) + accent)
                accent = ""
        return " ".join(unicodedata.normalize("NFC", "".join(chars)).split())
    try:
        decoded = value.decode(encoding, errors="replace")
    except LookupError:
        return ""
    return " ".join("".join(" " if c == "\x8a" else c for c in decoded if c.isprintable() or c in "\x8a\n").split())


def bcd_time(data):
    if any(byte >> 4 > 9 or byte & 15 > 9 for byte in data):
        raise ValueError
    hours, minutes, seconds = ((byte >> 4) * 10 + (byte & 15) for byte in data)
    if minutes >= 60 or seconds >= 60:
        raise ValueError
    return hours * 3600 + minutes * 60 + seconds


def crc_table():
    table = []
    for byte in range(256):
        value = byte << 24
        for _ in range(8):
            value = ((value << 1) ^ (0x104C11DB7 if value & 0x80000000 else 0))
        table.append(value)
    return table


CRC_TABLE = crc_table()


def valid_crc(section):
    crc = 0xFFFFFFFF
    for byte in section:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ CRC_TABLE[(crc >> 24) ^ byte]
    return crc == 0


def event_text(descriptors):
    short, extended = {}, {}
    content, age = None, None
    offset = 0
    while offset + 2 <= len(descriptors):
        tag, size = descriptors[offset:offset + 2]
        data = descriptors[offset + 2:offset + 2 + size]
        offset += size + 2
        if len(data) != size:
            break
        if tag == 0x4D and size >= 5:
            end = 4 + data[3]
            if end < size and end + 1 + data[end] <= size:
                short[data[:3]] = (dvb_text(data[4:end]), dvb_text(data[end + 1:end + 1 + data[end]]))
        elif tag == 0x4E and size >= 6:
            end = 5 + data[4]
            if end < size and end + 1 + data[end] <= size:
                extended.setdefault(data[1:4], {})[data[0] >> 4] = dvb_text(data[end + 1:end + 1 + data[end]])
        elif tag == 0x54 and size >= 2:
            content = next((code >> 4 for code in data[::2] if 1 <= code >> 4 <= 0xB), content)
        elif tag == 0x55:
            age = next((data[index + 3] + 3 for index in range(0, size - 3, 4)
                        if data[index:index + 3] == b"ESP" and 1 <= data[index + 3] <= 15), age)
    language = next((lang for lang in (b"spa", b"cat", b"glg", b"eus") if lang in short and short[lang][0]),
                    next((lang for lang, (title, _) in short.items() if title), None))
    if language is None:
        return "", "", {}
    title, summary = short[language]
    parts = extended.get(language, {})
    detail = " ".join(parts[key] for key in sorted(parts) if parts[key])
    description = detail if summary and detail.startswith(summary) else " ".join(filter(None, (summary, detail)))
    return title[:200], description[:1600], {"content": content, "age": age}


class Sections:
    def __init__(self):
        self.section = bytearray()
        self.continuity = None

    def packet(self, packet, changes):
        flags = packet[3]
        if not flags & 0x10 or flags & 0xC0:
            return
        offset = 4
        if flags & 0x20:
            offset += 1 + packet[4]
        if offset >= PACKET:
            return
        counter = flags & 15
        discontinuity = flags & 0x20 and packet[4] and packet[5] & 0x80
        if not discontinuity and counter == self.continuity:
            return
        if discontinuity or (self.continuity is not None and counter != (self.continuity + 1) % 16):
            self.section.clear()
        self.continuity = counter
        payload = packet[offset:]
        if packet[1] & 0x40:
            boundary = 1 + payload[0]
            if boundary > len(payload):
                self.section.clear()
                return
            if self.section:
                self.consume(payload[1:boundary], changes)
            self.section.clear()
            self.consume(payload[boundary:], changes)
        elif self.section:
            self.consume(payload, changes)

    def consume(self, payload, changes):
        self.section.extend(payload)
        while len(self.section) >= 3:
            if self.section[0] == 0xFF:
                self.section.clear()
                return
            length = 3 + ((self.section[1] & 15) << 8 | self.section[2])
            if len(self.section) < length:
                return
            self.read_section(bytes(self.section[:length]), changes)
            del self.section[:length]


class EIT(Sections):
    def __init__(self, frequency, audio=None):
        super().__init__()
        self.audio = audio
        self.frequency = frequency
        self.remainder = b""
        self.seen = {}

    def feed(self, data):
        data = self.remainder + data
        changes = {}
        offset = 0
        while offset + PACKET <= len(data):
            if data[offset] != 0x47:
                self.section.clear()
                offset = data.find(b"\x47", offset + 1)
                if offset < 0:
                    offset = len(data)
                    break
                if offset + PACKET < len(data) and data[offset + PACKET] != 0x47:
                    offset += 1
                    continue
            if not data[offset + 1] & 0x80:
                pid = (data[offset + 1] & 31) << 8 | data[offset + 2]
                if pid == 0x12:
                    self.packet(data[offset:offset + PACKET], changes)
                elif self.audio is not None and self.audio.accepts(pid):
                    self.audio.packet(pid, data[offset:offset + PACKET])
            offset += PACKET
        self.remainder = data[offset:]
        return {channel: list(events.values()) for channel, events in changes.items()}

    def read_section(self, data, changes):
        if len(data) < 18 or (data[0] != 0x4E and not 0x50 <= data[0] <= 0x5F) or not data[5] & 1:
            return
        key = (data[0], data[3:5], data[6], data[8:12])
        if self.seen.get(key) == data[-4:] or not valid_crc(data):
            return
        self.seen[key] = data[-4:]
        service = int.from_bytes(data[3:5], "big")
        offset, end = 14, len(data) - 4
        while offset + 12 <= end:
            header = data[offset:offset + 12]
            size = (header[10] & 15) << 8 | header[11]
            offset += 12
            if offset + size > end:
                break
            descriptors = data[offset:offset + size]
            offset += size
            try:
                day = int.from_bytes(header[2:4], "big") - 40587
                clock, duration = bcd_time(header[4:7]), bcd_time(header[7:10])
                if clock >= 86400 or not duration or not 0 <= day <= 50000:
                    continue
            except ValueError:
                continue
            title, description, metadata = event_text(descriptors)
            if title:
                start = day * 86400 + clock
                event = int.from_bytes(header[:2], "big")
                changes.setdefault(f"{self.frequency}-{service}", {})[event] = {
                    "id": event, "start": start, "end": start + duration, "title": title, "description": description,
                    **metadata,
                }


class Guide:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.events = {}
        self.dirty = False
        self.saved_at = 0
        try:
            self.update(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, AttributeError, TypeError, KeyError):
            self.events.clear()

    def update(self, channels):
        now = time.time()
        with self.lock:
            for channel, events in channels.items():
                if not events:
                    continue
                previous = self.events.get(channel, [])
                merged = {event["id"]: event for event in (*previous, *events)
                          if event["end"] > now - 3600 and event["start"] < now + 7 * 86400}
                current = sorted(merged.values(), key=lambda event: event["start"])[:400]
                if current != previous:
                    self.events[channel] = current
                    self.dirty = True

    def schedule(self, channels, start, end):
        with self.lock:
            return {channel: [event for event in self.events.get(channel, ()) if event["end"] > start and event["start"] < end]
                    for channel in channels}

    def clear(self):
        with self.lock:
            if self.events:
                self.events.clear()
                self.dirty = True

    def save(self, *, force=False):
        if not force and time.monotonic() - self.saved_at < 8:
            return
        with self.lock:
            if not self.dirty:
                return
            pending = self.path.with_suffix(".tmp")
            pending.write_text(json.dumps(self.events, ensure_ascii=False), encoding="utf-8")
            pending.replace(self.path)
            self.saved_at = time.monotonic()
            self.dirty = False
