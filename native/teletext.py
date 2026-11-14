"""Collect teletext pages and Latin character enhancements from DVB transport.

ETSI EN 300 472 describes the PES framing; EN 300 706 describes the line
addresses, page headers and odd-parity display bytes.
"""

from collections import OrderedDict
from threading import Lock

from .guide import PACKET
from .signal_analysis import descriptors

HAMMING_WORDS = (0x15, 0x02, 0x49, 0x5E, 0x64, 0x73, 0x38, 0x2F,
                 0xD0, 0xC7, 0x8C, 0x9B, 0xA1, 0xB6, 0xFD, 0xEA)
HAMMING = tuple(next((n for n, word in enumerate(HAMMING_WORDS)
                      if (word ^ value).bit_count() <= 1), -1) for value in range(256))
REVERSE = bytes(int(f"{value:08b}"[::-1], 2) for value in range(256))
DISPLAY = bytes(value & 0x7F if value.bit_count() & 1 else 32 for value in range(256))
PAGE_LIMIT = 256
BLANK = " " * 40
TRIPLET_PARITY = tuple(sum(1 << (bit - 1) for bit in range(1, 24) if bit & mask)
                       for mask in (1, 2, 4, 8, 16))


def decode_triplet(data):
    word = int.from_bytes(data, "little")
    error = sum(1 << index for index, mask in enumerate(TRIPLET_PARITY)
                if not (word & mask).bit_count() & 1)
    if error:
        if word.bit_count() & 1 or error > 23:
            return None
        word ^= 1 << (error - 1)
    return ((word >> 2) & 1) | ((word >> 3) & 14) | ((word >> 4) & 0x7F0) | ((word >> 5) & 0x3F800)


def character_enhancements(data):
    row = 0
    for start in range(1, 40, 3):
        triplet = decode_triplet(data[start:start + 3])
        if triplet is None:
            continue
        address, mode, value = triplet & 63, (triplet >> 6) & 31, triplet >> 11
        if address >= 40:
            if mode == 31:
                break
            if mode in (1, 4):
                row = address - 40 or 24
            elif mode == 7 and address == 63:
                row = 0
        elif 32 <= value <= 127 and mode >= 15:
            yield (row, address, mode, value)


class TeletextPages:
    def __init__(self):
        self.pending = bytearray()
        self.counter = None
        self.cycling = {}
        self.pages = OrderedDict()
        self.serial = False
        self.lock = Lock()
        self.revision = 0

    def packet(self, packet):
        flags = packet[3]
        if flags & 0xC0:
            self.pending.clear()
            self.counter = None
            return
        adaptation = packet[4] if flags & 0x20 else 0
        if adaptation and packet[5] & 0x80:
            self.pending.clear()
            self.counter = None
        if not flags & 0x10:
            return
        offset = 5 + adaptation if flags & 0x20 else 4
        if offset >= len(packet):
            self.pending.clear()
            return
        counter = flags & 15
        if counter == self.counter:
            return
        if self.counter is not None and counter != ((self.counter + 1) & 15):
            self.pending.clear()
        self.counter = counter
        if packet[1] & 0x40:
            self.pending.clear()
            if packet[offset:offset + 4] != b"\x00\x00\x01\xbd":
                return
        elif not self.pending:
            return
        self.pending.extend(packet[offset:])
        if len(self.pending) < 6:
            return
        length = int.from_bytes(self.pending[4:6], "big")
        if length < 4:
            self.pending.clear()
        elif len(self.pending) >= length + 6:
            self.pes(self.pending[:length + 6])
            self.pending.clear()

    def pes(self, packet):
        offset = 9 + packet[8]
        if offset >= len(packet) or not 0x10 <= packet[offset] <= 0x1F:
            return
        offset += 1
        while offset + 2 <= len(packet):
            kind, length = packet[offset:offset + 2]
            offset += 2
            end = offset + length
            if end > len(packet):
                return
            # Some broadcasts (including RTVE) mark ordinary page rows as 0x03.
            # The page header, not this transport flag, rules out subtitle pages.
            if kind in (0x02, 0x03) and length == 44 and packet[offset + 1] == 0xE4:
                self.line(packet[offset + 2:end].translate(REVERSE))
            offset = end

    def line(self, packet):
        low, high = HAMMING[packet[0]], HAMMING[packet[1]]
        if min(low, high) < 0:
            return
        magazine, row = (low & 7) or 8, (low >> 3) | (high << 1)
        data = packet[2:]
        if row == 0:
            self.header(magazine, data)
        elif page := self.cycling.get(magazine):
            if row <= 24:
                page[3][row] = data.translate(DISPLAY).decode("ascii")
            elif row == 26 and (designation := HAMMING[data[0]]) >= 0:
                page[4][designation] = tuple(character_enhancements(data))

    def header(self, magazine, data):
        fields = [HAMMING[value] for value in data[:8]]
        if min(fields) < 0:
            return
        units, tens, s1, s2, s3, s4, flags, language = fields
        next_key = (100 * magazine + 10 * tens + units, s1 | ((s2 & 7) << 4) | (s3 << 8) | ((s4 & 3) << 12))
        serial = bool(language & 1)
        if serial or self.serial:
            for previous in tuple(self.cycling):
                self.finish(previous)
        else:
            self.finish(magazine)
        self.serial = serial
        if units > 9 or tens > 9 or s4 & 12 or flags & 8:
            return
        national = language >> 1
        national = ((national & 1) << 2) | (national & 2) | (national >> 2)
        heading = BLANK if flags & 1 else str(next_key[0]) + " " * 5 + data[8:].translate(DISPLAY).decode("ascii")
        self.cycling[magazine] = (next_key, national, bool(s2 & 8), {0: heading}, {})

    def finish(self, magazine):
        pending = self.cycling.pop(magazine, None)
        if pending is None:
            return
        key, national, erase, received, enhancements = pending
        with self.lock:
            previous, previous_packets = self.pages.get(key, (None, {}))
            previous_content = previous if not erase else None
            rows = list(previous_content["rows"]) if previous_content else [BLANK] * 25
            for index, row in received.items():
                rows[index] = row
            if all(row == BLANK for row in rows[1:]):
                return
            packets = dict(previous_packets) if previous_content else {}
            # A retransmitted base row replaces its old accents unless they arrive again.
            updated_rows = {index for index in received if not previous_content
                            or received[index] != previous_content["rows"][index]}
            for designation in packets.keys() - enhancements.keys():
                packets[designation] = tuple(cell for cell in packets[designation] if cell[0] not in updated_rows)
            packets.update(enhancements)
            cells = [cell for designation in sorted(packets) for cell in packets[designation]]
            # The clock in row zero changes even when the article itself does not.
            item = {"rows": rows, "national": national, "enhancements": cells}
            if (previous and previous["rows"][1:] == rows[1:] and previous["national"] == national
                    and previous["enhancements"] == cells):
                self.pages[key] = (previous, packets)
                self.pages.move_to_end(key)
                return
            self.revision += 1
            item["revision"] = self.revision
            self.pages[key] = (item, packets)
            self.pages.move_to_end(key)
            if len(self.pages) > PAGE_LIMIT:
                oldest = next((key for key in self.pages if key[0] != 100), next(iter(self.pages)))
                del self.pages[oldest]

    def snapshot(self, number, subpage, revision):
        with self.lock:
            available = sorted({page for page, _ in self.pages})
            subpages = sorted(code for page, code in self.pages if page == number)
            if subpage not in subpages:
                subpage = subpages[0] if subpages else None
            item, _ = self.pages.get((number, subpage), (None, None))
            index = self.pages.get((100, 0)) or next(
                (page for (number, _), page in self.pages.items() if number == 100), None)
            return {"pages": available, "subpages": subpages, "subpage": subpage,
                    "revision": item["revision"] if item else None,
                    "page": item if item and item["revision"] != revision else None,
                    "index": index[0] if index else None}


class Teletext:
    def __init__(self):
        self.services = {}
        self.streams = {}
        self.lock = Lock()

    def table(self, section):
        if section[0] != 2 or len(section) < 16:
            return
        offset = 12 + (int.from_bytes(section[10:12], "big") & 0xFFF)
        end = len(section) - 4
        tracks = []
        while offset + 5 <= end:
            stream_type = section[offset]
            pid = int.from_bytes(section[offset + 1:offset + 3], "big") & 0x1FFF
            length = int.from_bytes(section[offset + 3:offset + 5], "big") & 0xFFF
            offset += 5
            if offset + length > end:
                return
            if stream_type == 6:
                for tag, value in descriptors(section[offset:offset + length]):
                    if tag != 0x56:
                        continue
                    for start in range(0, len(value) - 4, 5):
                        kind = value[start + 3] >> 3
                        if kind in (1, 3, 4):  # Browsable pages, newsflashes and programme information.
                            tracks.append((kind, pid))
            offset += length
        sid = int.from_bytes(section[3:5], "big")
        with self.lock:
            self.services[sid] = list(dict.fromkeys(pid for _, pid in sorted(tracks)))
            wanted = {pid for pids in self.services.values() for pid in pids}
            self.streams = {pid: self.streams.get(pid) or TeletextPages() for pid in wanted}

    def packet_at(self, pid, data, offset):
        stream = self.streams.get(pid)
        if stream is not None:
            stream.packet(data[offset:offset + PACKET])

    def snapshot(self, sid, number, subpage, revision):
        with self.lock:
            pids = self.services.get(sid)
            stream = self.streams[pids[0]] if pids else None
        if stream is None:
            return {"state": "detecting" if pids is None else "unavailable"}
        return {"state": "ready", "pid": pids[0], **stream.snapshot(number, subpage, revision)}
