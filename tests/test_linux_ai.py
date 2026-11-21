"""Regressions for Linux playback protection and lossless audio buffering."""

import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import tarfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

from native.local_ai import AIError, LocalAI, MODELS


class LinuxAI(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        self.tv = SimpleNamespace(data=self.data, recording=None, job=None, lock=threading.RLock())
        with patch("native.local_ai.sys.platform", "linux"):
            self.ai = LocalAI(self.tv, self.data / "helpers")
        self.ai._setup()
        self.addCleanup(self.ai.close)

    def test_disk_load_does_not_block_cpu(self):
        self.ai.cpu_sample = (1, 100, 50)
        with patch("native.local_ai.time.monotonic", return_value=3), \
                patch.object(Path, "open", return_value=io.StringIO("cpu 10 0 0 50 130 0 0 0\n")), \
                patch("native.local_ai.os.getloadavg", return_value=(1000, 1000, 1000)):
            self.assertFalse(self.ai._priority())

    def test_sustained_cpu_pressure_recovers(self):
        for now, busy in ((1, 100), (2, 200), (3, 300), (4, 400), (5, 500)):
            with patch("native.local_ai.time.monotonic", return_value=now), \
                    patch.object(Path, "open", return_value=io.StringIO(f"cpu {busy} 0 0 100 0 0 0 0\n")):
                guarded = self.ai._priority()
        self.assertTrue(guarded)
        with patch("native.local_ai.time.monotonic", return_value=6), \
                patch.object(Path, "open", return_value=io.StringIO("cpu 505 0 0 195 0 0 0 0\n")):
            self.assertFalse(self.ai._priority())

    def test_playback_guard_expires_without_more_telemetry(self):
        with patch("native.local_ai.time.monotonic", return_value=100):
            self.ai.health(False)
            self.assertTrue(self.ai._priority())
        with patch("native.local_ai.time.monotonic", return_value=106):
            self.assertFalse(self.ai._priority())

    def test_simd_requires_all_processors_and_has_fallback(self):
        cpu = SimpleNamespace(machine="x86_64")
        with patch("native.local_ai.os.uname", return_value=cpu), \
                patch.object(Path, "read_text", return_value="flags : avx avx2 f16c fma\nflags : avx avx2 f16c fma\n"):
            self.assertTrue(LocalAI._linux_simd())
        with patch("native.local_ai.os.uname", return_value=cpu), \
                patch.object(Path, "read_text", return_value="flags : avx avx2 f16c fma\nflags : avx\n"):
            self.assertFalse(LocalAI._linux_simd())
        self.ai.simd = True
        self.assertEqual(self.ai._helper("whisper-cli"), self.ai.helpers / "whisper-cli")
        self.ai.helpers.mkdir()
        (self.ai.helpers / "whisper-cli-avx2").touch()
        self.assertEqual(self.ai._helper("whisper-cli").name, "whisper-cli-avx2")
        self.assertEqual(self.ai._helper("arkham-ai-audio").name, "arkham-ai-audio")

    def test_audio_survives_rolling_playlist_priority_and_restart(self):
        stream = self.data / "stream"
        stream.mkdir()
        playlist = stream / "live.m3u8"
        (stream / "init.mp4").write_bytes(b"header")
        self.ai._installed = lambda key: True
        self.ai.speaker_enabled = True
        self.ai._stream = lambda with_title=False: ("s", playlist, "Prueba", "Programa", "es") if with_title else ("s", playlist)
        self.ai._priority = lambda: self.tv.recording is not None
        self.tv.recording = object()

        def extract(_file, audio, *_args, **_kwargs):
            with wave.open(str(audio), "wb") as pcm:
                pcm.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                seconds = Path(_file).read_bytes().count(b"audio") * 2
                pcm.writeframes(b"\x00\x01" * 16000 * seconds)
        self.ai._extract_audio = extract

        def publish(last):
            for i in range(last + 1):
                if i >= last - 5:
                    (stream / f"segment-{i:06}.m4s").write_bytes(b"audio")
                else:
                    (stream / f"segment-{i:06}.m4s").unlink(missing_ok=True)
            pending = playlist.with_suffix(".tmp")
            pending.write_text("#EXTM3U\n" + "".join(f"#EXTINF:2,\nsegment-{i:06}.m4s\n" for i in range(max(0, last - 5), last + 1)))
            pending.replace(playlist)

        def wait(fn):
            deadline = time.monotonic() + 5
            while not fn() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(fn())

        publish(1)
        ident = self.ai.start()["id"]
        self.assertFalse(self.ai.jobs[ident].get("voices", False))
        for last in range(3, 20, 2):
            publish(last)
            wait(lambda: self.ai.jobs[ident].get("captured", 0) >= (last - 1) * 2)
        self.assertEqual(self.ai.jobs[ident]["elapsed"], 0)
        self.assertEqual(len(self.ai.session["queue"]), 9)
        self.ai.session_action("finish")
        self.ai.close()
        with patch("native.local_ai.sys.platform", "linux"):
            recovered = LocalAI(self.tv, self.ai.helpers)
        self.addCleanup(recovered.close)
        recovered._installed = lambda key: True
        recovered._priority = lambda: self.tv.recording is not None
        def recognize(_audio, _model, _lang, duration, *_args, **_kwargs):
            overlap = round(duration) % 4
            return "es", [{"text": f"texto conservado del tramo {index}",
                           "offsets": {"from": (overlap + index * 4) * 1000, "to": (overlap + index * 4 + 4) * 1000}}
                          for index in range(int((duration - overlap) / 4))]
        recovered._recognize = recognize
        self.assertEqual(recovered.state()["active"], ident)
        recovered.session_action("pause")
        recovered.session_action("resume")
        self.tv.recording = None
        wait(lambda: recovered.state()["active"] is None)
        doc = recovered.state(ident)["selected"]
        self.assertEqual(doc["elapsed"], 36)
        self.assertEqual(doc["gaps"], [])
        self.assertEqual(len(doc["segments"]), 9)
        self.assertEqual(doc["status"], "saved")

    def test_live_join_removes_only_the_encoded_audio_overlap(self):
        paths = []
        for index in range(3):
            begin, end, overlap = index * 4000, (index + 1) * 4000, 0 if index == 0 else 2000
            path = self.data / f"{begin:012d}-{end:012d}-{overlap:05d}.wav"
            paths.append(path)
            with wave.open(str(path), "wb") as pcm:
                pcm.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                pcm.writeframes(b"\x00\x01" * 16000 * (overlap // 1000))
                pcm.writeframes(bytes([index + 1, 0]) * 16000 * 4)
        target = self.data / "combined.wav"
        self.ai._join_live_audio(paths, target)
        with wave.open(str(target), "rb") as pcm:
            self.assertEqual(pcm.getnframes(), 16000 * 12)
            for index in range(3):
                self.assertEqual(pcm.readframes(16000 * 4), bytes([index + 1, 0]) * 16000 * 4)

    def test_recording_available_without_starting_live(self):
        class Recordings:
            jobs = [{"id": "1" * 16, "title": "Programa guardado", "start": 12345,
                     "channel": {"name": "TV"}, "audio": {"language": "spa"}}]

            def open_video(_self, identifier):
                if identifier != "1" * 16:
                    raise FileNotFoundError
                return io.BytesIO(b"video"), 5

        self.tv.recordings = Recordings()
        self.ai._installed = lambda key: True
        self.ai._start_worker = lambda: None
        ident = self.ai.start_recording("1" * 16)["id"]
        self.assertIsNone(self.ai.session)
        self.assertEqual(self.ai.start_recording("1" * 16)["id"], ident)
        doc = self.ai.state(ident)["selected"]
        self.assertEqual(doc["recording"]["title"], "Programa guardado")
        self.assertEqual(doc["recording"]["date"], 12345)
        self.assertTrue(self.ai.state()["recordingSupported"])
        self.assertTrue(self.ai.state()["bufferedLive"])
        self.ai.recording_task = None
        self.ai.jobs[ident].update(status="saved", reason="finished")
        self.assertEqual(self.ai.start_recording("1" * 16)["id"], ident)
        self.ai.active_models["speech"] = "speech-base"
        second = self.ai.start_recording("1" * 16)["id"]
        self.assertNotEqual(second, ident)
        self.assertEqual(self.ai.jobs[second]["model"], "speech-base")
        self.assertIn(ident, self.ai.jobs)

    def test_compact_export_preserves_text_and_optional_times(self):
        ident = "a" * 16
        self.ai.jobs = {ident: {"id": ident, "title": "Ejemplo", "channel": "TV", "created": "2026-11-21",
                               "language": "es", "elapsed": 8, "gaps": [], "messages": [],
                               "segments": [{"id": 1, "start": 0, "end": 4, "text": "Una frase que"},
                                            {"id": 2, "start": 4, "end": 8, "text": "continúa sin cortes."}]}}
        compact = self.ai.export(ident, "txt", False, "es", timestamps=False)
        self.assertIn("Una frase que continúa sin cortes.", compact)
        self.assertNotIn("[00:00]", compact)
        self.assertIn("[00:00] Una frase que", self.ai.export(ident, "txt", False, "es"))

    def test_speech_bundle_rejects_traversal_and_incomplete_download(self):
        kind = "speech-parakeet-v3"
        model = MODELS[kind]
        prefix = model["filename"].removesuffix(".tar.bz2")
        for label, entries in (("traversal", [("../outside", b"bad")]),
                               ("incomplete", [(prefix + "/tokens.txt", b"words")])):
            file = self.data / (label + ".tar.bz2")
            with tarfile.open(file, "w:bz2") as archive:
                for name, payload in entries:
                    member = tarfile.TarInfo(name)
                    member.size = len(payload)
                    archive.addfile(member, io.BytesIO(payload))
            with self.assertRaises(ValueError):
                self.ai._install_speech_pack(kind, file, threading.Event())
            self.assertFalse(self.ai._model_pack(kind).exists())
        self.assertFalse((self.data.parent / "outside").exists())

    def test_speech_bundle_download_is_verified_before_activation(self):
        kind = "speech-parakeet-v3"
        model = MODELS[kind].copy()
        file = self.data / "complete.tar.bz2"
        prefix = model["filename"].removesuffix(".tar.bz2")
        with tarfile.open(file, "w:bz2") as archive:
            for name in model["files"]:
                payload = b"model data"
                member = tarfile.TarInfo(prefix + "/" + name)
                member.size = len(payload)
                archive.addfile(member, io.BytesIO(payload))
        payload = file.read_bytes()
        runtime = self.ai.helpers / "sherpa/bin/sherpa-onnx-offline"
        runtime.parent.mkdir(parents=True)
        runtime.touch()
        model.update(size=len(payload), sha256=__import__("hashlib").sha256(payload).hexdigest())
        self.ai.downloads[kind] = {"bytes": 0, "status": "downloading", "cancel": threading.Event()}
        with patch.dict(MODELS, {kind: model}), patch("native.local_ai.urlopen", return_value=io.BytesIO(payload)):
            self.ai._download(kind, self.ai.downloads[kind]["cancel"])
            self.assertTrue(self.ai._installed(kind))
            self.assertEqual(self.ai.active_models["speech"], "speech")
            self.ai.model_action("activate", kind)
            self.assertEqual(self.ai.active_models["speech"], kind)
            self.ai.model_action("remove", kind)
            self.assertFalse(self.ai._installed(kind))

    def test_experimental_speech_models_are_available_on_mac(self):
        self.ai.mac, self.ai.linux = True, False
        available = self.ai.state()["models"]
        self.assertIn("speech-parakeet-v3", available)
        self.assertIn("speech-qwen-asr", available)
        self.assertIn("speech-medium", available)

    def test_mac_whisper_keeps_its_existing_accelerated_parameters(self):
        self.ai.mac, self.ai.linux, self.ai.metal = True, False, True
        seen = []

        def run(name, args, timeout, cancelled):
            seen.append((name, args, timeout))
            prefix = Path(args[args.index("-of") + 1])
            prefix.with_suffix(".json").write_text(json.dumps({"result": {"language": "es"}, "transcription": []}))
            return ""

        self.ai._run = run
        self.ai._recognize(self.data / "audio.wav", "speech-medium", "es", 6, True, lambda: False)
        name, args, timeout = seen[0]
        self.assertEqual(name, "whisper-cli")
        self.assertNotIn("-ng", args)
        self.assertIn("-ac", args)
        self.assertIn("-nf", args)
        self.assertEqual(args[args.index("-bs") + 1], 2)
        self.assertEqual(timeout, 32)


if __name__ == "__main__":
    unittest.main()
