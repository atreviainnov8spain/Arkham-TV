"""Anonymous speaker turns for local recording transcription."""

from collections import Counter
import math
import re


def recording_turns(output, duration):
    events = {0.0: [], duration: []}
    names = {}
    detected = []
    for match in re.finditer(r"(?m)^\s*(\d+(?:\.\d+)?)\s+--\s+(\d+(?:\.\d+)?)\s+speaker_(\d+)\s*$", output):
        start, end = max(0, float(match[1])), min(duration, float(match[2]))
        if not all(map(math.isfinite, (start, end))) or end <= start:
            continue
        key = int(match[3])
        detected.append((start, end, key))
    for start, end, key in sorted(detected):
        if key not in names:
            names[key] = len(names) + 1
        speaker = names[key]
        events.setdefault(start, []).append((speaker, 1))
        events.setdefault(end, []).append((speaker, -1))
    active = Counter()
    turns = []
    previous = 0.0
    for point in sorted(events):
        if point > previous:
            speakers = [key for key, value in active.items() if value > 0]
            speaker = speakers[0] if len(speakers) == 1 else "overlap" if speakers else None
            if turns and turns[-1]["speaker"] == speaker:
                turns[-1]["end"] = point
            else:
                turns.append({"start": previous, "end": point, "speaker": speaker})
        for speaker, change in events[point]:
            active[speaker] += change
        previous = point
    return turns, len(names)


def voice_name(job, speaker, language="es"):
    if isinstance(speaker, int):
        return job.get("speaker_names", {}).get(str(speaker)) or ("Voice " if language == "en" else "Voz ") + str(speaker)
    if speaker == "overlap":
        return "Overlapping voices" if language == "en" else "Voces superpuestas"
    return "Unassigned voice" if language == "en" else "Voz sin identificar"
