#!/usr/bin/env python3
"""Self-written bed: felt piano, soft bass, brushed shaker. G major, 86 BPM.
No samples, no third-party melody. Deterministic given the seed."""

import math
import struct
import wave
from pathlib import Path

import numpy as np

SR = 44100
BPM = 86
BEAT = 60.0 / BPM
BARS = 64  # ~178s at 86 BPM, 4/4
SEED = 20261031

# MIDI note to Hz
def hz(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def piano(freq: float, dur: float, vel: float, rng: np.random.Generator) -> np.ndarray:
    n = int(dur * SR)
    if n <= 0:
        return np.zeros(0, dtype=np.float64)
    t = np.arange(n) / SR
    y = np.zeros(n, dtype=np.float64)
    partials = (1.0, 0.42, 0.2, 0.09, 0.045, 0.02)
    for k, amp in enumerate(partials, start=1):
        inharm = 1.0 + 0.00035 * k * k
        y += amp * np.sin(2 * math.pi * freq * k * inharm * t)
    decay = 0.55 + min(1.4, 180.0 / max(freq, 40))
    hammer = rng.standard_normal(n) * np.exp(-t / 0.02) * 0.15
    attack = np.minimum(1.0, t / 0.008)
    return vel * (y * np.exp(-t / decay) + hammer) * attack


def place(buf: np.ndarray, note: np.ndarray, at: float) -> None:
    start = int(at * SR)
    end = min(len(buf), start + len(note))
    if start >= len(buf) or end <= start:
        return
    buf[start:end] += note[: end - start]


def shaker(buf: np.ndarray, at: float, vel: float, rng: np.random.Generator) -> None:
    dur = 0.045
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # High-passed-ish by a short difference, then a gentle decay. Little energy under 150 Hz.
    noise = np.convolve(noise, [1, -0.95], mode="same")
    env = np.exp(-t / 0.012) * (t / 0.004).clip(0, 1)
    place(buf, vel * noise * env, at)


def whoosh(path: Path) -> None:
    rng = np.random.default_rng(7)
    dur = 0.22
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = np.convolve(noise, [0.2, 0.6, 0.2], mode="same")
    # Rise then fall, band-limited by a moving average (kills sub rumble and hiss).
    env = np.sin(np.pi * t / dur) ** 1.4
    kernel = np.hanning(180)
    kernel /= kernel.sum()
    band = np.convolve(noise, kernel, mode="same")
    y = (0.35 * band * env).astype(np.float32)
    y = np.clip(y, -1, 1)
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes((y * 32767).astype(np.int16).tobytes())


def tick(path: Path) -> None:
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * math.pi * 1400 * t) * np.exp(-t / 0.008)
    y = (0.25 * y).astype(np.float32)
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes((y * 32767).astype(np.int16).tobytes())


def main() -> None:
    out = Path("/tmp/marge-film/audio")
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    total = BARS * 4 * BEAT + 2.0
    buf = np.zeros(int(total * SR), dtype=np.float64)

    # I V vi IV in G: G, D, Em, C. Two-bar harmonic rhythm would drag; one bar each.
    chords = [
        (67, 71, 74, 55),  # G4 B4 D5 G3
        (69, 73, 62, 50),  # A4 D5 D4 D3  (D major, voiced open)
        (64, 67, 71, 52),  # E4 G4 B4 E3
        (65, 69, 72, 53),  # F4 A4 C5 F3
    ]
    # Fix D chord to D F# A : 62, 66, 69 and bass 50
    chords[1] = (62, 66, 69, 50)
    # C chord C E G: 60, 64, 67 bass 48
    chords[3] = (60, 64, 67, 48)

    for bar in range(BARS):
        chord = chords[bar % 4]
        bar_at = bar * 4 * BEAT
        # Bass on 1, soft echo on 3
        for step, vel in ((0, 0.16), (2, 0.07)):
            place(buf, piano(hz(chord[3]), BEAT * 1.8, vel, rng), bar_at + step * BEAT)
        # Chord on beat 1, lighter on beat 3
        for step, vel in ((0, 0.11), (2, 0.05)):
            for tone in chord[:3]:
                place(buf, piano(hz(tone), BEAT * 1.6, vel, rng), bar_at + step * BEAT + 0.012)
        # Arpeggio 8ths, very quiet, so the bed has a pulse without competing with speech
        for eighth in range(8):
            tone = chord[eighth % 3]
            vel = 0.045 if eighth % 2 == 0 else 0.028
            place(
                buf,
                piano(hz(tone + 12), BEAT * 0.7, vel, rng),
                bar_at + eighth * (BEAT / 2),
            )
            shaker(buf, bar_at + eighth * (BEAT / 2), 0.012 if eighth % 2 == 0 else 0.006, rng)

    # Soft lowpass-ish moving average to take the digital edge off.
    kernel = np.hanning(24)
    kernel /= kernel.sum()
    buf = np.convolve(buf, kernel, mode="same")

    peak = np.max(np.abs(buf)) or 1.0
    buf = 0.9 * buf / peak
    pcm = (buf * 32767).astype(np.int16)
    music = out / "bed.wav"
    with wave.open(str(music), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())
    whoosh(out / "whoosh.wav")
    tick(out / "tick.wav")
    print(f"wrote {music} seconds={total:.1f}")


if __name__ == "__main__":
    main()
