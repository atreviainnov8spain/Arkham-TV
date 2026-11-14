"""Serve a single revocable mobile session on a selected local network."""

import ipaddress
import json
import re
import secrets
import socket
import struct
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


LOCAL_NETWORKS = tuple(map(ipaddress.IPv4Network, (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16",
)))
MEDIA = re.compile(r"tv/([0-9a-f]{16})/(live\.m3u8|init\.mp4|segment-\d+\.m4s)")
ASSETS = {
    "": "mobile.html",
    "mobile.css": "mobile.css",
    "mobile.js": "mobile.js",
    "hls.min.js": "hls.min.js",
    "arkhamtv-mark.svg": "../assets/arkhamtv-mark.svg",
    "InterVariable.woff2": "../assets/fonts/InterVariable.woff2",
}


def local_networks():
    if sys.platform == "darwin":
        output = subprocess.check_output(["/sbin/ifconfig", "-a"], text=True, timeout=2)
        interfaces = []
        for entry in re.split(r"(?m)(?=^\S+: flags=)", output):
            if not re.search(r"(?m)^\S+: flags=\d+<[^>]*\bUP\b", entry):
                continue
            if "status: inactive" in entry:
                continue
            interfaces.extend((address, ipaddress.IPv4Address(int(mask, 16)))
                              for address, mask in re.findall(r"\binet ([\d.]+) netmask (0x[\da-f]+)", entry))
    else:
        import fcntl

        interfaces = []
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            for _, name in socket.if_nameindex():
                request = struct.pack("256s", name.encode())
                try:
                    flags = struct.unpack_from("H", fcntl.ioctl(sock, 0x8913, request), 16)[0]
                    if flags & 1 and not flags & 16:  # UP, excluding point-to-point links.
                        address, mask = (socket.inet_ntoa(fcntl.ioctl(sock, op, request)[20:24])
                                         for op in (0x8915, 0x891B))
                        interfaces.append((address, mask))
                except OSError:
                    continue
    networks = {}
    for address, mask in interfaces:
        ip = ipaddress.IPv4Address(address)
        if any(ip in network for network in LOCAL_NETWORKS):
            try:
                network = ipaddress.IPv4Network(f"{ip}/{mask}", strict=False)
            except ValueError:
                continue
            if network.prefixlen >= 8 and any(network.subnet_of(local) for local in LOCAL_NETWORKS):
                networks[address] = network
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            # A UDP connect consults the routing table without sending packets.
            sock.connect(("1.1.1.1", 443))
            preferred = sock.getsockname()[0]
    except OSError:
        preferred = None
    return dict(sorted(networks.items(), key=lambda item: item[0] != preferred))


class MobileSession:
    def __init__(self, tv, web, content_types, tuner_error):
        self.tv, self.web, self.content_types = tv, web, content_types
        self.tuner_error = tuner_error
        self.lock = threading.Lock()
        self.server = None

    def status(self):
        with self.lock:
            return {"url": self.server.url, "address": self.server.address} if self.server else {"url": None}

    def start(self, address, language):
        networks = local_networks()
        with self.lock:
            if address is None:
                current = self.server.address if self.server else None
                address = current if current in networks else next(iter(networks), None)
            if address not in networks:
                raise ValueError("Conecta el ordenador a una red local para usar el móvil.")
            if not self.server or self.server.address != address:
                server = ThreadingHTTPServer((address, 0), self.handler())
                server.address = address
                server.network = networks[address]
                server.authority = f"{address}:{server.server_port}"
                server.prefix = f"/m/{secrets.token_urlsafe(24)}/"
                server.url = f"http://{server.authority}{server.prefix}"
                self._stop()
                self.server = server
                threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1},
                                 daemon=True).start()
            self.server.language = language
            return {"url": self.server.url, "address": address, "addresses": list(networks)}

    def _stop(self):
        if self.server:
            server, self.server = self.server, None
            server.shutdown()
            server.server_close()

    def stop(self):
        with self.lock:
            self._stop()

    def channels(self):
        with self.tv.lock:
            channels = tuple(self.tv.channels.values())
            stream = self.tv.stream
            current = stream["channel"] if stream else None
            url = f'tv/{stream["id"]}/live.m3u8' if stream and stream["playlist"].is_file() else None
            hdmi = stream.get("hdmi") if stream else None
            can_tune = not hdmi and not self.tv.job and not self.tv.recording
            if hdmi:
                channels = ({"id": current, "name": hdmi[0]["name"]},)
        now = int(time.time())
        programmes = self.tv.guide.schedule((channel["id"] for channel in channels), now, now + 1)
        return {
            "channel": current, "url": url, "canTune": can_tune, "hdmi": bool(hdmi),
            "channels": [
                {"id": channel["id"], "name": channel["name"],
                 "program": max(programmes[channel["id"]], key=lambda event: event["start"],
                                default={}).get("title")}
                for channel in channels
            ],
        }

    def handler(self):
        session = self

        class Handler(BaseHTTPRequestHandler):
            def setup(self):
                self.request.settimeout(8)
                super().setup()

            def log_message(self, *_):
                # The request URL contains the pairing secret.
                pass

            def authorized_path(self):
                path = urlsplit(self.path).path
                if (session.server is self.server
                        and self.headers.get("Host") == self.server.authority
                        and ipaddress.IPv4Address(self.client_address[0]) in self.server.network
                        and path.startswith(self.server.prefix)):
                    return path[len(self.server.prefix):]
                return None

            def respond(self, body, content_type, status=HTTPStatus.OK, content_range=None):
                self.send_response(status)
                if content_range:
                    self.send_header("Content-Range", content_range)
                if content_type == "video/mp4":
                    self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy",
                                 "default-src 'self'; media-src 'self' blob:; frame-ancestors 'none'")
                self.end_headers()
                if self.command != "HEAD":
                    try:
                        self.wfile.write(body)
                    except (BrokenPipeError, ConnectionResetError, TimeoutError):
                        pass

            def json(self, data, status=HTTPStatus.OK):
                self.respond(json.dumps(data, ensure_ascii=False).encode(), "application/json", status)

            def do_HEAD(self):
                self.do_GET()

            def do_GET(self):
                path = self.authorized_path()
                if path is None:
                    self.json({}, HTTPStatus.FORBIDDEN)
                    return
                if path == "status":
                    self.json(session.channels())
                    return
                asset = ASSETS.get(path)
                file = session.web / asset if asset else None
                if match := MEDIA.fullmatch(path):
                    with session.tv.lock:
                        stream = session.tv.stream
                        if stream and stream["id"] == match[1]:
                            file = stream["folder"] / match[2]
                if file:
                    try:
                        body = file.read_bytes()
                    except OSError:
                        pass
                    else:
                        if path == "" and getattr(self.server, "language", "es") == "en":
                            body = body.replace(b'<html lang="es">', b'<html lang="en">', 1)
                        content_type = session.content_types[file.suffix]
                        byte_range = re.fullmatch(r"bytes=(\d{0,18})-(\d{0,18})", self.headers.get("Range", ""))
                        if content_type == "video/mp4" and byte_range and (byte_range[1] or byte_range[2]):
                            length = len(body)
                            start = int(byte_range[1]) if byte_range[1] else max(0, length - int(byte_range[2]))
                            end = min(int(byte_range[2]), length - 1) if byte_range[1] and byte_range[2] else length - 1
                            if start > end:
                                self.respond(b"", content_type, HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
                                             f"bytes */{length}")
                            else:
                                self.respond(body[start:end + 1], content_type, HTTPStatus.PARTIAL_CONTENT,
                                             f"bytes {start}-{end}/{length}")
                        else:
                            self.respond(body, content_type)
                        return
                self.json({}, HTTPStatus.NOT_FOUND)

            def do_POST(self):
                if (self.authorized_path() != "tune"
                        or self.headers.get("Origin") != f"http://{self.server.authority}"):
                    self.json({}, HTTPStatus.FORBIDDEN)
                    return
                try:
                    length = int(self.headers.get("Content-Length", 0))
                    if not 0 < length <= 512 or self.headers.get_content_type() != "application/json":
                        raise ValueError
                    channel = json.loads(self.rfile.read(length))
                    if not isinstance(channel, str):
                        raise ValueError
                except (ValueError, TimeoutError):
                    self.json({}, HTTPStatus.BAD_REQUEST)
                    return
                with session.tv.lock:
                    if session.server is not self.server:
                        status, error = HTTPStatus.FORBIDDEN, "session"
                    elif channel not in session.tv.channels:
                        status, error = HTTPStatus.NOT_FOUND, "channel"
                    elif session.tv.stream and session.tv.stream["channel"] == channel:
                        status, error = HTTPStatus.OK, None
                    elif session.tv.recording or session.tv.job or (session.tv.stream and session.tv.stream.get("hdmi")):
                        status, error = HTTPStatus.CONFLICT, "busy"
                    else:
                        try:
                            session.tv.start_stream(channel)
                        except (OSError, session.tuner_error):
                            status, error = HTTPStatus.CONFLICT, "tune"
                        else:
                            status, error = HTTPStatus.OK, None
                self.json({"error": error}, status)

        return Handler
