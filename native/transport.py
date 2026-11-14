"""Share one DVB transport stream between playback and recording."""

from pathlib import Path
from queue import Empty, Full, Queue
import subprocess
import threading

from .guide import EIT
from .audio_tracks import AudioTracks
from .teletext import Teletext


class TransportFeed:
    def __init__(self, destination, *, buffer_bytes=None):
        self.destination = destination
        self.queue = Queue(maxsize=128 if buffer_bytes is None else 0)
        self.buffer_bytes = buffer_bytes
        self.pending_bytes = 0
        self.buffer_lock = threading.Lock()
        self.finished = threading.Event()
        self.failed = False
        self.worker = threading.Thread(target=self.write, daemon=True)
        self.worker.start()

    def offer(self, chunk):
        if self.finished.is_set():
            return
        try:
            if self.buffer_bytes is None:
                self.queue.put_nowait(chunk)
            else:
                with self.buffer_lock:
                    if self.pending_bytes + len(chunk) > self.buffer_bytes:
                        raise Full
                    self.queue.put_nowait(chunk)
                    self.pending_bytes += len(chunk)
        except Full:
            self.failed = True
            self.finished.set()

    def write(self):
        try:
            with self.destination:
                while not self.finished.is_set() or not self.queue.empty():
                    try:
                        chunk = self.queue.get(timeout=0.2)
                    except Empty:
                        continue
                    if self.buffer_bytes is not None:
                        with self.buffer_lock:
                            self.pending_bytes -= len(chunk)
                    self.destination.write(chunk)
                    self.destination.flush()
        except OSError:
            self.finished.set()


class Transport:
    def __init__(self, command, channel, guide, data, cwd, *, analysis=None, teletext=False):
        self.analysis = analysis
        self.uhf = channel["uhf"]
        self.frequency = channel["frequency"]
        self.teletext = Teletext() if teletext else None
        self.audio = AudioTracks(self.on_table if analysis or self.teletext else None)
        self.reader = EIT(channel["frequency"], self.audio, analysis, self.teletext)
        self.guide = guide
        self.log = Path(data) / "sintonizador.log"
        self.lock = threading.Lock()
        self.feeds = set()
        with self.log.open("wb") as log:
            self.process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=log)
        self.worker = threading.Thread(target=self.read, daemon=True)

    def on_table(self, section):
        if self.analysis:
            self.analysis.table(section)
        if self.teletext:
            self.teletext.table(section)

    def attach(self, destination, *, buffer_bytes=None):
        feed = TransportFeed(destination, buffer_bytes=buffer_bytes)
        with self.lock:
            self.feeds.add(feed)
        return feed

    def detach(self, feed):
        with self.lock:
            self.feeds.discard(feed)
            feed.finished.set()

    def read(self):
        with self.process.stdout as source:
            try:
                while chunk := source.read1(65536):
                    with self.lock:
                        for feed in self.feeds:
                            feed.offer(chunk)
                    if changes := self.reader.feed(chunk):
                        self.guide.update(changes)
                    if self.analysis:
                        self.analysis.commit()
            except OSError:
                pass
            finally:
                self.audio.close()
                with self.lock:
                    for feed in self.feeds:
                        feed.finished.set()
