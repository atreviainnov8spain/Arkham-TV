#!/usr/bin/python3
"""Authorize only Arkham TV's two HDMI interfaces from an authenticated desktop session."""

import http.client
import json
import re
import socket
import struct
import subprocess
import sys
import time

INTERFACES = ("camera", "audio-record")
ACTION = "com.arkhamtv.hdmi.connect"


class SnapdConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/run/snapd.socket")


def snapd(path, payload=None):
    connection = SnapdConnection("localhost", timeout=5)
    try:
        if payload is None:
            connection.request("GET", path)
        else:
            connection.request("POST", path, json.dumps(payload), {"Content-Type": "application/json"})
        response = connection.getresponse()
        data = json.load(response)
        if response.status >= 400:
            raise RuntimeError(data.get("result", {}).get("message", "snapd rejected the request"))
        return data
    finally:
        connection.close()


def connect_inputs(instance):
    connected = snapd("/v2/connections?snap=" + instance)["result"]["established"]
    existing = {link["plug"]["plug"] for link in connected if link["plug"]["snap"] == instance}
    for plug in INTERFACES:
        if plug in existing:
            continue
        change = snapd("/v2/interfaces", {
            "action": "connect", "plugs": [{"snap": instance, "plug": plug}],
            "slots": [{"snap": "", "slot": plug}],
        })["change"]
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            state = snapd("/v2/changes/" + change)["result"]
            if state["ready"]:
                if state["status"] != "Done":
                    raise RuntimeError(state.get("err", "Could not connect " + plug))
                break
            time.sleep(.2)
        else:
            raise TimeoutError("Timed out connecting " + plug)


def authorize(peer):
    peer.settimeout(3)
    if peer.recv(1) != b"A":
        return None
    pid, uid, _ = struct.unpack("3i", peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    # The instance comes from the kernel label, never from client-supplied data.
    label = peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERSEC, 256).decode().rstrip(chr(0))
    match = re.fullmatch(r"snap\.(arkham-tv(?:_[a-z0-9]{1,10})?)\.arkham-tv \(enforce\)", label)
    if uid == 0 or not match:
        return b"error\n"
    with open(f"/proc/{pid}/stat", encoding="utf-8") as stat:
        start = stat.read().rsplit(") ", 1)[1].split()[19]
    auth = subprocess.run(["/usr/bin/pkcheck", "--action-id", ACTION, "--process",
                           f"{pid},{start},{uid}", "--allow-user-interaction"], timeout=90)
    if auth.returncode in (1, 2, 3):
        return b"denied\n"
    if auth.returncode:
        raise RuntimeError("pkcheck exited with status " + str(auth.returncode))
    connect_inputs(match[1])
    return b"ok\n"


def main():
    with socket.socket(fileno=0) as peer:
        try:
            result = authorize(peer)
        except (OSError, ValueError, KeyError, IndexError, RuntimeError, subprocess.SubprocessError) as error:
            print(f"HDMI authorization failed: {error}", file=sys.stderr)
            result = b"error\n"
        if result:
            try:
                peer.sendall(result)
            except BrokenPipeError:
                pass


if __name__ == "__main__":
    main()
