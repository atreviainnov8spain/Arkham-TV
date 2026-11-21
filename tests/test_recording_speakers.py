import tempfile
from pathlib import Path
from types import SimpleNamespace
import threading
import unittest
import wave

from native.local_ai import LocalAI, AIError
from native.speaker_diarization import recording_turns, voice_name


class SpeakerTurns(unittest.TestCase):
    def test_covers_entire_audio_and_marks_overlap_without_inventing_voice(self):
        turns, count = recording_turns("3 -- 6 speaker_09\n1 -- 4 speaker_02\n", 10)
        self.assertEqual(count, 2)
        self.assertEqual(turns[0], {"start": 0, "end": 1, "speaker": None})
        self.assertEqual(turns[1]["speaker"], 1)
        self.assertEqual(turns[2]["speaker"], "overlap")
        self.assertEqual(turns[3]["speaker"], 2)
        self.assertEqual(turns[-1]["end"], 10)
        self.assertEqual(sum(t["end"] - t["start"] for t in turns), 10)
        for before, after in zip(turns, turns[1:]):
            self.assertEqual(before["end"], after["start"])

    def test_no_detected_voice_does_not_discard_audio(self):
        turns, count = recording_turns("Started\nDuration: 8\n", 8)
        self.assertEqual(count, 0)
        self.assertEqual(turns, [{"start": 0, "end": 8, "speaker": None}])

    def test_names_are_only_manual_labels(self):
        job = {"speaker_names": {"1": "Tony"}}
        self.assertEqual(voice_name(job, 1), "Tony")
        self.assertEqual(voice_name(job, 2), "Voz 2")
        self.assertEqual(voice_name(job, "overlap"), "Voces superpuestas")

    def test_recording_is_transcribed_per_voice_and_original_is_kept(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            original = data / "source.mp4"
            original.write_bytes(b"original recording")
            ai = LocalAI(SimpleNamespace(data=data, recording=None, job=None), data / "helpers")
            ai._setup()
            ai._priority = lambda: False
            cache = data / "cache"
            cache.mkdir()
            with wave.open(str(cache / "recording.wav"), "wb") as out:
                out.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                out.writeframes(b"\x00\x01" * 16000 * 2)
            ident = "a" * 16
            job = {"id": ident, "title": "Test", "channel": "TV", "created": "2026-11-21", "language": "es",
                   "status": "processing", "voices": True, "speaker_names": {}, "elapsed": 0,
                   "recording": {"id": "b" * 16, "title": "Test", "date": 1}, "segments": [], "gaps": [], "messages": []}
            ai.jobs = {ident: job}
            task = {"id": ident, "model": "speech", "recording": "b" * 16, "language": "es",
                    "position": 0, "cancel": threading.Event(), "voices": True, "phase": "text",
                    "voice_folder": str(cache), "turn_index": 0,
                    "turns": [{"start": 0, "end": 1, "speaker": 1}, {"start": 1, "end": 2, "speaker": 2}]}
            ai.recording_task = task
            ai._recognize = lambda *args, **kwargs: ("es", [{"text": "Sí.", "offsets": {"from": 0, "to": 1000}}])
            for _ in range(3):
                ai._recording_pass(task)
            self.assertEqual([row["speaker"] for row in job["segments"]], [1, 2])
            self.assertEqual([row["text"] for row in job["segments"]], ["Sí.", "Sí."])
            self.assertEqual(job["status"], "saved")
            self.assertEqual(original.read_bytes(), b"original recording")
            self.assertFalse(cache.exists())
            ai.rename_speaker(ident, 1, "Tony")
            exported = ai.export(ident, "txt", False, "es", timestamps=False)
            self.assertIn("Tony: Sí.", exported)
            self.assertIn("Voz 2: Sí.", exported)
            with self.assertRaises(AIError):
                ai.rename_speaker(ident, 99, "Someone")
            ai.close()


if __name__ == "__main__":
    unittest.main()
