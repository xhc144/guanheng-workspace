from __future__ import annotations

from pathlib import Path
import wave

import numpy as np


SR = 48_000
DURATION = 60.0
OUT = Path(__file__).resolve().parents[1] / "public" / "audio" / "music.wav"


def midi(note: int) -> float:
    return 440.0 * 2 ** ((note - 69) / 12)


def envelope(length: int, attack: float, release: float) -> np.ndarray:
    env = np.ones(length, dtype=np.float32)
    a = min(length, int(attack * SR))
    r = min(length, int(release * SR))
    if a:
        env[:a] = np.linspace(0, 1, a, dtype=np.float32)
    if r:
        env[-r:] *= np.linspace(1, 0, r, dtype=np.float32)
    return env


def add_tone(track: np.ndarray, start: float, duration: float, note: int, gain: float, pan: float = 0.0) -> None:
    i0 = int(start * SR)
    n = min(int(duration * SR), len(track) - i0)
    if n <= 0:
        return
    t = np.arange(n, dtype=np.float32) / SR
    f = midi(note)
    tone = (
        np.sin(2 * np.pi * f * t)
        + 0.28 * np.sin(2 * np.pi * 2 * f * t + 0.3)
        + 0.10 * np.sin(2 * np.pi * 3 * f * t + 0.8)
    )
    tone *= envelope(n, 0.28, 1.2) * gain
    left = np.sqrt((1 - pan) / 2)
    right = np.sqrt((1 + pan) / 2)
    track[i0 : i0 + n, 0] += tone * left
    track[i0 : i0 + n, 1] += tone * right


def add_pluck(track: np.ndarray, start: float, note: int, gain: float, pan: float) -> None:
    i0 = int(start * SR)
    n = min(int(0.44 * SR), len(track) - i0)
    if n <= 0:
        return
    t = np.arange(n, dtype=np.float32) / SR
    f = midi(note)
    env = np.exp(-7.5 * t)
    tone = (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(2 * np.pi * 2 * f * t)) * env * gain
    left = np.sqrt((1 - pan) / 2)
    right = np.sqrt((1 + pan) / 2)
    track[i0 : i0 + n, 0] += tone * left
    track[i0 : i0 + n, 1] += tone * right


def main() -> None:
    track = np.zeros((int(SR * DURATION), 2), dtype=np.float32)
    bpm = 96
    beat = 60 / bpm
    bar = beat * 4
    chords = [
        (50, 57, 62),  # Dm
        (46, 53, 58),  # Bb
        (53, 57, 60),  # F
        (48, 55, 60),  # C
    ]

    for bar_index, start in enumerate(np.arange(0, DURATION, bar)):
        chord = chords[bar_index % len(chords)]
        for idx, note in enumerate(chord):
            add_tone(track, float(start), bar * 1.35, note, 0.075, (idx - 1) * 0.22)
        root = chord[0] - 12
        add_tone(track, float(start), bar * 0.95, root, 0.12, -0.08)
        pattern = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12]
        for step in range(8):
            add_pluck(track, float(start + step * beat / 2), pattern[step % 4], 0.045, -0.3 + 0.6 * (step % 2))

    # A restrained low pulse adds motion without competing with narration.
    for start in np.arange(0, DURATION, beat):
        add_pluck(track, float(start), 38, 0.055, 0.0)

    fade = np.ones(len(track), dtype=np.float32)
    fade[: 2 * SR] = np.linspace(0, 1, 2 * SR, dtype=np.float32)
    fade[-3 * SR :] = np.linspace(1, 0, 3 * SR, dtype=np.float32)
    track *= fade[:, None]

    peak = float(np.max(np.abs(track))) or 1.0
    track *= 0.24 / peak
    pcm = np.clip(track * 32767, -32768, 32767).astype("<i2")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(pcm.tobytes())
    print(OUT)


if __name__ == "__main__":
    main()
