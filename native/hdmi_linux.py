"""Discover USB HDMI inputs with V4L2 and capture through GStreamer."""

import errno
import fcntl
from fractions import Fraction
from itertools import count
import json
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys

VIDEO_ROOT = Path("/sys/class/video4linux")
SOUND_ROOT = Path("/sys/class/sound")
CAPTURE_FORMATS = {
    b"MJPG": ("image/jpeg", ("jpegdec", "!")),
    b"H264": ("video/x-h264", ("h264parse", "!", "avdec_h264", "!")),
    b"YUYV": ("video/x-raw,format=YUY2", ()),
    b"NV12": ("video/x-raw,format=NV12", ()),
    b"UYVY": ("video/x-raw,format=UYVY", ()),
    b"YU12": ("video/x-raw,format=I420", ()),
}
SNAP_INTERFACES = ("camera", "audio-record")


class CaptureError(Exception):
    pass


def usb_parent(path):
    for parent in path.resolve().parents:
        if (parent / "idVendor").is_file() and (parent / "idProduct").is_file():
            return parent
    return None


def missing_interfaces():
    if not os.environ.get("SNAP"):
        return []
    return [plug for plug in SNAP_INTERFACES if subprocess.run(
        ["snapctl", "is-connected", plug], stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, timeout=3,
    ).returncode]


def authorization_socket():
    return Path("/run") / ("snap." + os.environ["SNAP_INSTANCE_NAME"]) / "hdmi-authorization"


def audio_usb_group(source, video):
    properties = source.get("properties", {})
    card = str(properties.get("alsa.card", properties.get("api.alsa.card", "")))
    if card.isdecimal() and (usb := usb_parent(SOUND_ROOT / f"card{card}")):
        return usb.name
    # PipeWire provides the USB path even when the Snap cannot inspect the ALSA card.
    path = properties.get("device.bus_path", "")
    device = path.rpartition("-usb-")[2].split(":")
    if len(device) >= 3:
        port = device[1]
        matching = {entry["group"] for entry in video if entry["group"].partition("-")[2] == port}
        if len(matching) == 1:
            return matching.pop()
    return None


def devices():
    video, audio = [], []
    for node in sorted(VIDEO_ROOT.glob("video*")):
        if not (usb := usb_parent(node)):
            continue
        try:
            if (node / "index").read_text().strip() != "0":
                continue
            # Parallels exposes host webcams and a duplicate Cam Link through USB emulation.
            if (usb / "idVendor").read_text().strip() == "203a":
                continue
            product = usb / "product"
            name = (product if not os.environ.get("SNAP") and product.is_file()
                    else node / "name").read_text().strip()
        except OSError:
            continue  # The capture device was unplugged while listing it.
        video.append({"id": f"{node.name}:{usb.name}", "name": name, "group": usb.name,
                      "path": f"/dev/{node.name}"})
    try:
        result = subprocess.run(["pactl", "--format=json", "list", "sources"],
                                capture_output=True, check=True, timeout=3)
        sources = json.loads(result.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        sources = []
    for source in sources:
        name = source["name"]
        if name.endswith(".monitor"):
            continue
        if group := audio_usb_group(source, video):
            audio.append({"id": name, "name": source["description"], "group": group})
    return {"video": video, "audio": audio}


def v4l2_entries(fd, request, size, *fields):
    # VIDIOC_ENUM_FMT, VIDIOC_ENUM_FRAMESIZES and VIDIOC_ENUM_FRAMEINTERVALS.
    # Their fixed-width Linux UAPI structures have the same layout on ARM64 and AMD64.
    ioctl = 0xC0000000 | (size << 16) | (ord("V") << 8) | request
    for index in count():
        entry = bytearray(size)
        struct.pack_into(f"={len(fields) + 1}I", entry, 0, index, *fields)
        try:
            fcntl.ioctl(fd, ioctl, entry)
        except OSError as error:
            if error.errno == errno.EINVAL:
                return
            raise
        yield entry


def capture_mode(video):
    modes = []
    try:
        with open(video["path"], "rb", buffering=0) as device:
            fd = device.fileno()
            for entry in v4l2_entries(fd, 2, 64, 1):
                fourcc = bytes(entry[44:48])
                if fourcc not in CAPTURE_FORMATS:
                    continue
                pixel_format, = struct.unpack("=I", fourcc)
                for frame in v4l2_entries(fd, 74, 44, pixel_format):
                    kind, width, height = struct.unpack_from("=III", frame, 8)
                    if kind != 1 or not (0 < width <= 1920 and 0 < height <= 1080):
                        continue
                    for interval in v4l2_entries(fd, 75, 52, pixel_format, width, height):
                        kind, period, rate = struct.unpack_from("=III", interval, 16)
                        if kind == 1 and period > 0 and period <= rate <= 60 * period:
                            modes.append((width, height, Fraction(rate, period), fourcc))
    except PermissionError as error:
        raise CaptureError("Ubuntu no permite acceder al vídeo. Comprueba que la capturadora esté conectada a esta sesión.") from error
    except OSError as error:
        if error.errno == errno.EBUSY:
            raise CaptureError("La capturadora de vídeo está en uso. Ciérrala en la otra aplicación y vuelve a intentarlo.") from error
        raise CaptureError("No se pudo consultar la capturadora de vídeo.") from error
    if not modes:
        raise CaptureError("La capturadora no ofrece un formato de vídeo compatible hasta 1080p.")
    # Prefer Full HD near the European TV cadence. MJPEG uses less USB bandwidth.
    return max(modes, key=lambda mode: (mode[0] * mode[1], -abs(mode[2] - 50), mode[3] == b"MJPG"))


def double_field_rate(video):
    fps = video["mode"][2]
    deinterlace = video.get("deinterlace", "auto")
    return deinterlace != "off" and fps <= 30 and (deinterlace == "on" or fps >= 24)


def output_rate(video):
    fps = video["mode"][2]
    return fps * 2 if double_field_rate(video) else fps


def capture_command(video, audio, program):
    width, height, fps, pixel_format = video["mode"]
    caps, decode = CAPTURE_FORMATS[pixel_format]
    deinterlace = video.get("deinterlace", "auto")
    rate = output_rate(video)
    picture = ("bwdif=mode=send_field:parity=tff:deint=all" if double_field_rate(video) else
               "bwdif=mode=send_frame:deint=all" if deinterlace == "on" else
               "bwdif=mode=send_frame:deint=interlaced" if deinterlace == "auto" else "null")
    capture = [
        "gst-launch-1.0", "-q", "matroskamux", "name=mux", "streamable=true",
        "!", "fdsink", "fd=1", "sync=false",
        "v4l2src", f"device={video['path']}", "!",
        f"{caps},width={width},height={height},framerate={fps.numerator}/{fps.denominator}",
        "!", "queue", "!", *decode, "videoconvert", "!", "video/x-raw,format=I420", "!", "queue", "!", "mux.",
        "pulsesrc", f"device={audio['id']}", "client-name=Arkham TV",
        "!", "audioconvert", "!", "audioresample", "!", "audio/x-raw,format=S16LE,rate=48000,channels=2",
        "!", "queue", "!", "mux.",
    ]
    encode = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning",
        "-filter_threads", "2", "-f", "matroska", "-i", "pipe:0",
        "-map", "0:v:0", "-map", "0:a:0", "-vf", picture,
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "20",
        "-threads", "4", "-pix_fmt", "yuv420p", "-fps_mode", "cfr", "-r", str(rate),
        "-g", str(round(rate)), "-force_key_frames", "expr:gte(t,n_forced*1)",
        "-af", f"aresample=48000:async=100,volume={audio.get('gain', 0)}dB,alimiter=limit=0.95:level=false:latency=true",
        "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "256k",
        "-mpegts_service_id", str(program), "-flush_packets", "1", "-f", "mpegts", "pipe:1",
    ]
    return [sys.executable, "-B", str(Path(__file__).resolve()), json.dumps([capture, encode])]


def run_capture(capture, encode):
    def stop(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    source = subprocess.Popen(capture, stdout=subprocess.PIPE)
    try:
        with source.stdout:
            encoder = subprocess.Popen(encode, stdin=source.stdout)
        try:
            return encoder.wait()
        finally:
            stop_process(encoder)
    finally:
        stop_process(source)


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


if __name__ == "__main__":
    try:
        sys.exit(run_capture(*json.loads(sys.argv[1])))
    except KeyboardInterrupt:
        sys.exit(0)
