"""Capture decoded HDMI audio and video through an external USB input."""

import json
import os
import subprocess
import sys


CHANNEL_ID = "hdmi"
PROGRAM = 1  # FFmpeg's single MPEG-TS service.


def available():
    return linux_enabled() or (sys.platform == "darwin" and bool(os.environ.get("ARKHAM_CAPTURE_HOST")))


def linux_enabled():
    return sys.platform == "linux" and os.environ.get("ARKHAM_LINUX_HDMI") == "1"


def devices():
    if linux_enabled():
        from . import hdmi_linux

        return hdmi_linux.devices()
    if not available():
        return {"video": [], "audio": []}
    result = subprocess.run([os.environ["ARKHAM_CAPTURE_HOST"], "--capture-devices"],
                            capture_output=True, check=True, timeout=5)
    return json.loads(result.stdout)


def capture_command(video, audio):
    if "mode" in video:
        from . import hdmi_linux

        return hdmi_linux.capture_command(video, audio, PROGRAM)
    # Prefer Full HD. Go for the closest available cadence to European terrestrial TV.
    mode = max(video["modes"], key=lambda mode: (mode["width"] * mode["height"], -abs(mode["fps"] - 50)))
    deinterlace = video.get("deinterlace", "auto")
    double_rate = deinterlace == "on" or (deinterlace == "auto" and mode["fps"] <= 30)
    rate, fps = mode["rate"], mode["fps"]
    if double_rate:
        numerator, denominator = rate.split("/")
        rate = f"{int(numerator) * 2}/{denominator}"
        fps *= 2
    picture = "bwdif=mode=send_field:parity=tff:deint=all" if double_rate else "bwdif=mode=send_frame:deint=interlaced"
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning",
        "-thread_queue_size", "64",
        "-f", "avfoundation", "-pixel_format", "nv12", "-framerate", mode["rate"],
        "-video_size", f'{mode["width"]}x{mode["height"]}',
        "-i", f'{video["name"]}:{audio["name"]}',
        "-map", "0:v:0", "-map", "0:a:0", "-vf", picture,
        "-c:v", "h264_videotoolbox", "-allow_sw", "1", "-realtime", "1", "-b:v", "11000k",
        "-pix_fmt", "yuv420p", "-r", rate, "-fps_mode", "cfr", "-bf", "0",
        "-g", str(round(fps)), "-force_key_frames", "expr:gte(t,n_forced*1)",
        "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "256k",
        "-af", f"volume={audio.get('gain', 0)}dB,alimiter=limit=0.95:level=false:latency=true",
        "-mpegts_service_id", str(PROGRAM), "-flush_packets", "1", "-f", "mpegts", "pipe:1",
    ]
