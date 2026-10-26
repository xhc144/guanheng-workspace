"""Mix narration over the score and loudness-normalise both deliverable soundtracks.

Outputs (48 kHz stereo):
  assets/audio/mix_vo.wav     narration + score (ducked) + sfx   -> 旁白版
  assets/audio/mix_music.wav  score + sfx                        -> 纯音乐版
"""
import json
import pathlib
import subprocess
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
root = pathlib.Path(__file__).resolve().parent.parent
audio = root / "assets/audio"

# Narration placement (seconds, file start) — must match index.html subtitles/VO cues.
VO_AT = {"L1": 1.5, "L2": 6.6, "L3": 15.2, "L4": 20.2, "L5": 28.3, "L6": 36.5, "L7": 44.2, "L8": 52.6, "L9": 56.9}


def read(path):
    sr, x = wavfile.read(path)
    assert sr == SR, (path, sr)
    if x.dtype == np.int16:
        x = x.astype(np.float64) / 32768
    x = x.astype(np.float64)
    return x if x.ndim == 2 else np.stack([x, x], axis=1)


music = read(audio / "music.wav")
sfx = read(audio / "sfx.wav")
N = len(music)

# ---- narration bus
vo = np.zeros((N, 2))
speech = np.zeros(N)
hp = signal.butter(2, 85, "high", fs=SR, output="sos")
presence = signal.butter(2, [2500, 6000], "band", fs=SR, output="sos")
for key, t0 in VO_AT.items():
    x = read(audio / f"vo/{key}.wav")[:, 0]
    x = signal.sosfilt(hp, x)
    x = x + 0.18 * signal.sosfilt(presence, x)          # a touch of clarity
    rms = np.sqrt(np.mean(x[np.abs(x) > 0.01] ** 2))
    x = x * (0.12 / rms)                                 # level-match every line
    x = np.tanh(x * 1.6) / 1.6                           # soft peak control
    i = int(t0 * SR)
    vo[i:i + len(x)] += x[:, None]
    # speech activity (for ducking) from the 20 ms envelope
    env = np.convolve(np.abs(x), np.ones(960) / 960, mode="same")
    speech[i:i + len(x)] = np.maximum(speech[i:i + len(x)], (env > 0.01).astype(float))

# smooth activity into a ducking curve: 120 ms attack (look-ahead), 450 ms release
att, rel = int(0.12 * SR), int(0.45 * SR)
duck_env = np.zeros(N)
level = 0.0
# look-ahead: shift activity earlier by the attack time so music dips before the word
act = np.concatenate([speech[att:], np.zeros(att)])
k_att, k_rel = 1 / att, 1 / rel
for i in range(0, N, 48):  # 1 ms control rate
    target = act[i]
    level += (target - level) * (k_att * 48 * 4 if target > level else k_rel * 48 * 2.2)
    level = min(max(level, 0.0), 1.0)
    duck_env[i:i + 48] = level
duck_gain = 1 - 0.72 * duck_env                          # ≈ -11 dB under speech

mix_vo = music * duck_gain[:, None] * 0.52 + sfx * 0.3 + vo * 1.0
mix_music = music * 0.8 + sfx * 0.32

for name, x in (("mix_vo", mix_vo), ("mix_music", mix_music)):
    raw = audio / f"{name}.raw.wav"
    wavfile.write(raw, SR, (x / max(1.0, np.abs(x).max() * 1.02)).astype(np.float32))
    # two-pass EBU R128 normalisation to -14 LUFS / -1 dBTP (web + exhibition friendly)
    probe = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(raw), "-af", "loudnorm=I=-14:TP=-1.0:LRA=9:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stderr
    m = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
    af = (
        "loudnorm=I=-14:TP=-1.0:LRA=9:linear=true:"
        f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
        f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}"
    )
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-af", af, "-ar", str(SR), "-c:a", "pcm_s16le", str(audio / f"{name}.wav")], check=True)
    raw.unlink()
    print(name, "input", m["input_i"], "LUFS ->", audio / f"{name}.wav")
