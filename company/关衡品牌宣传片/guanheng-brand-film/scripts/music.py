"""Original score for the Guanheng brand film, synthesised to the picture.

120 BPM, 2 s bars, D minor resolving to F major at the dawn finale.
Writes assets/audio/music.wav (score) and assets/audio/sfx.wav (transition FX),
both 48 kHz stereo float, unnormalised relative to each other but peak-safe.

Scene cuts (s): 0 earth | 6 complexity | 14 balance | 20 platform | 28 values
                | 36 heritage | 44 scale | 52 finale | 60 end
"""
import pathlib
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 61.0
N = int(SR * DUR)
BEAT = 0.5
BAR = 2.0
rng = np.random.default_rng(1997)
root = pathlib.Path(__file__).resolve().parent.parent


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {n: i for i, n in enumerate("C C# D D# E F F# G G# A A# B".split())}


def nm(name):
    """'D3' -> midi number, supports sharps ('C#4') and flats ('Bb2')."""
    if name[1] == "b":
        base, octv = NOTE[name[0]] - 1, int(name[2:])
    elif name[1] == "#":
        base, octv = NOTE[name[0]] + 1, int(name[2:])
    else:
        base, octv = NOTE[name[0]], int(name[1:])
    return 12 * (octv + 1) + base


def stereo():
    return np.zeros((N, 2), dtype=np.float64)


def add(bus, x, t0, gain=1.0, pan=0.0):
    """Mix mono or stereo x into bus at time t0 with equal-power pan."""
    i0 = int(round(t0 * SR))
    if i0 >= N:
        return
    if x.ndim == 1:
        l = np.cos((pan + 1) * np.pi / 4)
        r = np.sin((pan + 1) * np.pi / 4)
        x = np.stack([x * l * 1.414, x * r * 1.414], axis=1)
    if i0 < 0:
        x = x[-i0:]
        i0 = 0
    n = min(len(x), N - i0)
    bus[i0:i0 + n] += x[:n] * gain


def env_adsr(n, a, d, s, r, sr=SR):
    a_n, d_n, r_n = int(a * sr), int(d * sr), int(r * sr)
    s_n = max(0, n - a_n - d_n - r_n)
    e = np.concatenate([
        np.linspace(0, 1, max(a_n, 1)) ** 1.5,
        np.linspace(1, s, max(d_n, 1)),
        np.full(s_n, s),
        s * np.linspace(1, 0, max(r_n, 1)) ** 1.3,
    ])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))


# ---------------------------------------------------------------- oscillators
def saw_blep(freq, n, phase0=0.0):
    inc = np.full(n, freq / SR) if np.isscalar(freq) else freq / SR
    ph = (phase0 + np.cumsum(inc)) % 1.0
    y = 2 * ph - 1
    dt = inc
    m = ph < dt
    t = ph[m] / dt[m]
    y[m] -= t + t - t * t - 1
    m = ph > 1 - dt
    t = (ph[m] - 1) / dt[m]
    y[m] -= t * t + t + t + 1
    return y


def lp(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def hp(x, fc, order=2):
    sos = signal.butter(order, fc, "high", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def shelf(x, fc, gain_db, kind="low", slope=0.8):
    """RBJ shelving biquad."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * fc / SR
    alpha = np.sin(w0) / 2 * np.sqrt((A + 1 / A) * (1 / slope - 1) + 2)
    cw, sa = np.cos(w0), 2 * np.sqrt(A) * alpha
    if kind == "low":
        b = [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sa)]
        a = [(A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sa]
    else:
        b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sa)]
        a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
    b, a = np.array(b) / a[0], np.array(a) / a[0]
    return signal.lfilter(b, a, x, axis=0)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, min(hi, SR * 0.45)], "band", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def sweep_filter(x, fc_curve, kind="low", q=0.9, block=256):
    """Time-varying RBJ biquad, coefficients updated per block (state carried)."""
    y = np.zeros_like(x)
    z = np.zeros(2)
    for i in range(0, len(x), block):
        fc = float(np.clip(fc_curve[min(i, len(fc_curve) - 1)], 30, SR * 0.45))
        w0 = 2 * np.pi * fc / SR
        alpha = np.sin(w0) / (2 * q)
        cw = np.cos(w0)
        if kind == "low":
            b = np.array([(1 - cw) / 2, 1 - cw, (1 - cw) / 2])
        elif kind == "band":
            b = np.array([alpha, 0, -alpha])
        else:
            b = np.array([(1 + cw) / 2, -(1 + cw), (1 + cw) / 2])
        a = np.array([1 + alpha, -2 * cw, 1 - alpha])
        y[i:i + block], z = signal.lfilter(b / a[0], a / a[0], x[i:i + block], zi=z)
    return y


# --------------------------------------------------------------- instruments
def supersaw_pad(notes, dur, bright=2400, voices=7, detune=0.16, a=1.2, r=1.6):
    n = int((dur + r) * SR)
    out = np.zeros((n, 2))
    for m in notes:
        f = midi(m)
        for v in range(voices):
            d = (v - (voices - 1) / 2) / ((voices - 1) / 2)
            fv = f * 2 ** (d * detune / 12)
            x = saw_blep(fv, n, phase0=rng.random())
            pan = d * 0.8
            out[:, 0] += x * np.cos((pan + 1) * np.pi / 4)
            out[:, 1] += x * np.sin((pan + 1) * np.pi / 4)
    out = lp(out, bright, order=4)
    out = hp(out, 90)
    e = env_adsr(n, a, 0.5, 0.85, r)
    return out * e[:, None] / (len(notes) * voices) * 2.2


def pluck(f, dur=0.45, bright=0.55, harm=24):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, harm + 1):
        if f * k > 14000:
            break
        y += np.sin(2 * np.pi * f * k * t + rng.random() * 0.3) / k * np.exp(-t * (6 + k * k * (1.6 - bright) * 3.5))
    y *= np.minimum(1, t / 0.003)
    return y * 0.6


def bass_note(f, dur, cutoff=700):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, 30):
        fk = f * k
        if fk > 6000:
            break
        y += np.sin(2 * np.pi * fk * t) / k / (1 + (fk / cutoff) ** 4)
    y += 0.8 * np.sin(2 * np.pi * f * t)  # sub
    e = np.minimum(1, t / 0.004) * np.exp(-t / (dur * 0.9))
    e[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return np.tanh(y * e * 1.4) * 0.7


def bell(f, dur=2.5, idx=2.2, ratio=3.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    mod = idx * np.exp(-t * 4) * np.sin(2 * np.pi * f * ratio * t)
    y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 1.6)
    y += 0.35 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 3.0)
    return y * np.minimum(1, t / 0.002) * 0.5


def keys(f, dur=2.2):
    """Soft electric-piano-ish FM keys."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    mod = 1.3 * np.exp(-t * 5) * np.sin(2 * np.pi * f * t)
    y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 1.1)
    y += 0.25 * np.sin(2 * np.pi * f * 2 * t + 0.4) * np.exp(-t * 2.4)
    return y * np.minimum(1, t / 0.004) * 0.5


def kick(big=False):
    dur = 0.9 if big else 0.45
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = (40 if big else 46) + (90 if big else 110) * np.exp(-t / (0.06 if big else 0.032))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / (0.42 if big else 0.22))
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.003) * 0.25
    return np.tanh((y + click) * 1.6) * 0.9


def boom(dur=3.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 44 + 60 * np.exp(-t / 0.12)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    thump = lp(rng.standard_normal(n), 400) * np.exp(-t / 0.08) * 0.6
    return np.tanh((y + thump) * 1.3)


def clap():
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 900, 4200)
    e = np.zeros(n)
    for off in (0, 0.009, 0.019):
        i = int(off * SR)
        e[i:] += np.exp(-(t[: n - i]) / 0.012)
    e += np.exp(-t / 0.11) * 0.5
    return noise * e * 0.35


def snare():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 1500, 7000) * np.exp(-t / 0.09)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)
    return (noise * 0.55 + tone * 0.4) * 0.6


def hat(open_=False):
    dur = 0.35 if open_ else 0.06
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 7500, order=4)
    return x * np.exp(-t / (0.12 if open_ else 0.018)) * 0.28


def tom(f0=95):
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    f = f0 * 0.65 + f0 * 0.5 * np.exp(-t / 0.05)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3)
    return np.tanh(y * 1.5) * 0.7


def cymbal(dur=3.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 4500, order=3)
    for fr in (3150, 4720, 5980, 7400, 8810):
        x += 0.08 * np.sin(2 * np.pi * fr * t + rng.random() * 6)
    return x * np.exp(-t / (dur * 0.35)) * 0.22


def riser(dur, lo=250, hi=9000):
    n = int(dur * SR)
    u = np.linspace(0, 1, n)
    x = rng.standard_normal(n)
    fc = lo * (hi / lo) ** (u ** 1.6)
    y = sweep_filter(x, fc, kind="band", q=2.2)
    pitch = midi(nm("D3")) * 2 ** (u ** 2 * 2)
    tone = saw_blep(pitch, n)
    tone = lp(tone, 3000) * 0.18
    trem = 0.75 + 0.25 * np.sin(2 * np.pi * np.cumsum(2 + 14 * u ** 2) / SR)
    return (y * 0.9 + tone) * (u ** 2.4) * trem


def whoosh(dur=0.9, lo=350, hi=4200):
    n = int(dur * SR)
    u = np.linspace(0, 1, n)
    x = rng.standard_normal(n)
    fc = lo + (hi - lo) * np.sin(np.pi * u) ** 1.5
    y = sweep_filter(x, fc, kind="band", q=1.3)
    e = np.sin(np.pi * u ** 0.75) ** 2
    yl = y * e * np.cos(u * np.pi / 2)
    yr = y * e * np.sin(u * np.pi / 2)
    return np.stack([yl, yr], axis=1) * 0.9


def reverse_swell(dur=1.6):
    c = cymbal(dur * 1.3)[::-1][-int(dur * SR):]
    u = np.linspace(0, 1, len(c))
    return c * u ** 1.5 * 2.2


def shimmer_cloud(dur, density=5, notes=("D6", "F6", "A6", "C7", "E7", "A5")):
    n = int(dur * SR)
    out = np.zeros((n, 2))
    count = int(dur * density)
    for _ in range(count):
        t0 = rng.random() * dur
        f = midi(nm(notes[rng.integers(len(notes))]))
        b = bell(f, 1.6, idx=0.8, ratio=2.0) * (0.25 + 0.3 * rng.random())
        i = int(t0 * SR)
        m = min(len(b), n - i)
        pan = rng.uniform(-0.9, 0.9)
        out[i:i + m, 0] += b[:m] * np.cos((pan + 1) * np.pi / 4)
        out[i:i + m, 1] += b[:m] * np.sin((pan + 1) * np.pi / 4)
    return out


def reverb(x, rt=2.8, pre=0.025, damp=5500, seed=7):
    r = np.random.default_rng(seed)
    n = int(rt * SR)
    t = np.arange(n) / SR
    env = 10 ** (-3 * t / rt)
    ir = np.stack([r.standard_normal(n) * env, r.standard_normal(n) * env], axis=1)
    ir = lp(ir, damp)
    ir = np.concatenate([np.zeros((int(pre * SR), 2)), ir])
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    y = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)
    return y


def ping_pong(x, delay=0.375, fb=0.38, taps=5):
    y = x.copy()
    d = int(delay * SR)
    for k in range(1, taps + 1):
        g = fb ** k
        sh = np.zeros_like(x)
        sh[d * k:] = x[: len(x) - d * k] * g
        if k % 2:
            sh = sh[:, ::-1]
        y += lp(sh, 4200)
    return y


# ------------------------------------------------------------------- harmony
CH = {
    "Dm": ["D3", "A3", "E4", "F4"],
    "Bb": ["Bb2", "F3", "A3", "D4"],
    "Gm": ["G2", "D3", "Bb3", "F4"],
    "A": ["A2", "E3", "C#4", "E4"],
    "F": ["F2", "C3", "A3", "E4"],
    "C": ["C3", "G3", "D4", "E4"],
    "Fadd9": ["F2", "C3", "G3", "A3", "C4", "F4"],
    "Bbmaj": ["Bb2", "F3", "D4", "A4"],
}
ARP = {  # arpeggio tones (upper)
    "Dm": ["D4", "F4", "A4", "E5", "A4", "F4"],
    "Bb": ["Bb3", "D4", "F4", "A4", "F4", "D4"],
    "F": ["F4", "A4", "C5", "E5", "C5", "A4"],
    "C": ["C4", "E4", "G4", "D5", "G4", "E4"],
    "Gm": ["G4", "Bb4", "D5", "F5", "D5", "Bb4"],
    "A": ["A3", "C#4", "E4", "A4", "E4", "C#4"],
}
ROOT = {"Dm": "D2", "Bb": "Bb1", "F": "F2", "C": "C2", "Gm": "G1", "A": "A1"}


def chord_midi(name):
    return [nm(x) for x in CH[name]]


pad = stereo()
bass = stereo()
arp = stereo()
drums = stereo()
mel = stereo()
fx = stereo()       # musical FX inside the score (risers, booms)
sfx = stereo()      # picture-sync transition SFX (separate stem)
kick_times = []

# ---------------------------------------------------------- 0–6  intro earth
for i, m in enumerate(["D1", "D2"]):
    n = int(7.2 * SR)
    t = np.arange(n) / SR
    drone = np.sin(2 * np.pi * midi(nm(m)) * t) * (0.18 if i == 0 else 0.3)
    drone *= np.minimum(1, t / 2.5) * np.where(t > 6.0, np.clip(1 - (t - 6.0) / 1.2, 0, 1), 1)
    add(pad, drone, 0.0, 0.5)
add(pad, supersaw_pad(chord_midi("Dm"), 5.9, bright=1100, a=3.0, r=1.2), 0.0, 0.9)
add(mel, shimmer_cloud(6.0, density=3), 0.3, 0.6)
for t0, n_ in [(1.45, "A4"), (1.95, "D5"), (2.7, "E5"), (3.45, "F5")]:
    add(mel, bell(midi(nm(n_)), 3.0), t0, 0.35, pan=rng.uniform(-0.4, 0.4))
add(fx, boom(3.5), 1.42, 0.55)
add(fx, reverse_swell(1.8), 4.2, 0.9)

# ------------------------------------------------- 6–14  complexity / tension
t_pad, t_bass, t_drums, t_fx = stereo(), stereo(), stereo(), stereo()
prog = ["Dm", "Bb", "Gm", "A"]
for b, ch in enumerate(prog):
    t0 = 6 + b * BAR
    add(t_pad, supersaw_pad(chord_midi(ch), BAR, bright=900 + 500 * b, a=0.25, r=0.6), t0, 0.75)
    # 16th bass ostinato on root, cutoff opens through the section
    for s in range(16):
        tt = t0 + s * BEAT / 2
        cut = 260 + 900 * ((b * 16 + s) / 64) ** 1.4
        acc = 1.0 if s % 4 == 0 else 0.62
        add(t_bass, bass_note(midi(nm(ROOT[ch])), 0.2, cutoff=cut), tt, 0.55 * acc)
        add(t_drums, hat(), tt + 0.002, 0.35 if s % 2 else 0.55, pan=0.25)
    kick_beats = [0] if b < 2 else [0, 2]
    for kb in kick_beats:
        add(t_drums, kick(), t0 + kb * BEAT, 0.8)
        kick_times.append(t0 + kb * BEAT)
    if b == 3:
        for s, f0 in enumerate([110, 100, 92, 85, 110, 100, 92, 85]):
            add(t_drums, tom(f0), t0 + s * BEAT / 2, 0.45 + 0.05 * s)
add(t_fx, boom(2.0), 10.72, 0.5)          # "看不见的风险"
add(t_fx, riser(2.3), 11.6, 0.5)
# hard stop at 13.92 s: the tension cuts to a breath before the balance scene
gate = np.ones(N)
g0, g1 = int(13.92 * SR), int(14.0 * SR)
gate[g0:g1] = np.linspace(1, 0, g1 - g0)
gate[g1:] = 0
gate = gate[:, None]
pad += t_pad * gate
bass += t_bass * gate
drums += t_drums * gate
fx += t_fx * gate

# ----------------------------------------------------- 14–20  balance / hush
add(mel, shimmer_cloud(6.0, density=4, notes=("F6", "A6", "C7", "G6", "C6")), 14.0, 0.55)
n = int(6.2 * SR)
t = np.arange(n) / SR
add(pad, np.sin(2 * np.pi * midi(nm("F1")) * t) * np.minimum(1, t / 1.0) * np.clip((6.2 - t) / 0.4, 0, 1) * 0.35, 14.0, 0.2)
add(pad, supersaw_pad(chord_midi("Bbmaj"), 2.0, bright=900, a=1.2, r=0.6), 14.3, 0.45)
add(pad, supersaw_pad(chord_midi("F"), 1.6, bright=1500, a=0.5, r=0.6), 16.1, 0.7)
add(pad, supersaw_pad(chord_midi("Fadd9"), 2.3, bright=2600, a=0.15, r=1.0), 17.6, 0.85)
for k, n_ in enumerate(["F5", "A5", "C6", "E6"]):
    add(mel, bell(midi(nm(n_)), 2.6), 16.12 + k * 0.09, 0.4, pan=-0.5 + k * 0.33)
for k, n_ in enumerate(["C5", "F5", "G5", "A5", "C6"]):
    add(mel, bell(midi(nm(n_)), 3.0), 17.62 + k * 0.07, 0.38, pan=0.5 - k * 0.25)
add(fx, boom(2.5), 17.6, 0.35)
add(fx, reverse_swell(1.9), 18.1, 1.1)
add(fx, riser(1.9, lo=400, hi=11000), 18.1, 0.35)


# ------------------------------------------------------ groove helper
def groove(t_start, bars, prog, level=1.0, arp_oct=0, open_hats=False, clap_on=True, kick_pat=(0, 2, 2.5)):
    for b in range(bars):
        ch = prog[b % len(prog)]
        t0 = t_start + b * BAR
        add(pad, supersaw_pad(chord_midi(ch), BAR, bright=4800, a=0.08, r=0.5), t0, 0.62 * level)
        for e8 in range(8):  # 8th-note bass
            note = ROOT[ch] if e8 % 4 != 3 else ROOT[ch][:-1] + str(int(ROOT[ch][-1]) + 1)
            add(bass, bass_note(midi(nm(note)), 0.23, cutoff=950), t0 + e8 * BEAT / 2, 0.62 * level)
        tones = ARP[ch]
        for s in range(16):
            f = midi(nm(tones[s % len(tones)]) + 12 * arp_oct)
            add(arp, pluck(f, 0.5, bright=0.85), t0 + s * (BAR / 16), 0.5 * level, pan=(-0.35 if s % 2 else 0.35))
        for kb in kick_pat:
            add(drums, kick(), t0 + kb * BEAT, 0.9 * level)
            kick_times.append(t0 + kb * BEAT)
        if clap_on:
            for cb in (1, 3):
                add(drums, clap(), t0 + cb * BEAT, 0.55 * level)
        for s in range(16):
            add(drums, hat(), t0 + s * BAR / 16 + 0.003, (0.32 if s % 2 else 0.2) * level, pan=0.3)
        if open_hats:
            for s in (2, 6, 10, 14):
                add(drums, hat(True), t0 + s * BAR / 16, 0.22 * level, pan=-0.2)


# ----------------------------------------------------- 20–36  platform drive
add(fx, boom(3.0), 20.0, 0.8)
add(drums, kick(True), 20.0, 0.9)
kick_times.append(20.0)
add(fx, cymbal(3.2), 20.0, 0.75)
groove(20.0, 4, ["Dm", "Bb", "F", "C"], level=0.9, kick_pat=(0, 2, 2.5))
add(fx, cymbal(2.6), 28.0, 0.55)
groove(28.0, 4, ["Dm", "Bb", "F", "C"], level=1.0, arp_oct=1, open_hats=True)
# soaring bell motif over values section
for t0, n_ in [(28.0, "A5"), (29.0, "F5"), (30.0, "D5"), (31.0, "E5"), (32.0, "F5"), (33.0, "G5"), (34.0, "A5"), (35.0, "C6")]:
    add(mel, bell(midi(nm(n_)), 2.0, idx=1.4), t0, 0.22, pan=0.2)
add(fx, reverse_swell(1.4), 34.6, 0.7)

# --------------------------------------------------- 36–44  heritage breakdown
for b, ch in enumerate(["Bb", "F", "C", "Dm"]):
    t0 = 36 + b * BAR
    add(pad, supersaw_pad(chord_midi(ch), BAR, bright=1700, a=0.4, r=0.8), t0, 0.7)
    add(bass, bass_note(midi(nm(ROOT[ch])), 1.9, cutoff=500), t0, 0.5)
    for k, n_ in enumerate(CH[ch][1:]):
        add(mel, keys(midi(nm(n_) + 12), 2.0), t0 + k * 0.25, 0.3, pan=-0.3 + k * 0.3)
    add(drums, kick(), t0, 0.55)
    kick_times.append(t0)
for t0, n_ in [(36.5, "D5"), (37.5, "F5"), (38.5, "E5"), (39.0, "C5"), (40.5, "A4"), (41.5, "C5"), (42.0, "D5")]:
    add(mel, keys(midi(nm(n_)), 2.4), t0, 0.33, pan=0.15)
for s in range(16):  # snare roll build into 44
    tt = 42.0 + s * BAR / 16
    add(drums, snare(), tt, 0.12 + 0.5 * (s / 15) ** 2, pan=0.1)
add(fx, riser(2.0), 42.0, 0.55)

# ------------------------------------------------------ 44–52  scale peak
add(fx, boom(3.0), 44.0, 0.85)
add(drums, kick(True), 44.0, 0.95)
kick_times.append(44.0)
add(fx, cymbal(3.5), 44.0, 0.8)
groove(44.0, 4, ["Dm", "Bb", "F", "C"], level=1.05, arp_oct=1, open_hats=True)
for b in range(4):
    for s, f0 in enumerate([120, 105]):
        add(drums, tom(f0), 44 + b * BAR + 1.5 + s * 0.25, 0.4)
add(fx, riser(2.2, lo=300, hi=12000), 49.7, 0.6)

# ------------------------------------------------------ 52–60  dawn finale
add(fx, boom(4.5), 52.0, 1.0)
add(drums, kick(True), 52.0, 1.0)
kick_times.append(52.0)
add(fx, cymbal(5.0), 52.0, 0.9)
add(pad, supersaw_pad(chord_midi("Bbmaj"), 1.9, bright=3200, a=0.05, r=0.6), 52.0, 0.75)
add(pad, supersaw_pad(chord_midi("C"), 2.45, bright=3200, a=0.2, r=0.6), 54.0, 0.75)
add(pad, supersaw_pad(chord_midi("Fadd9"), 4.0, bright=3800, a=0.12, r=2.0), 56.45, 0.95)
add(bass, bass_note(midi(nm("Bb1")), 1.95, cutoff=420), 52.0, 0.55)
add(bass, bass_note(midi(nm("C2")), 2.45, cutoff=420), 54.0, 0.55)
add(bass, bass_note(midi(nm("F1")), 3.6, cutoff=380), 56.45, 0.6)
for b in range(2):
    for s in range(16):
        add(arp, pluck(midi(nm(["Bb4", "D5", "F5", "A5"][s % 4] if b == 0 else ["C5", "E5", "G5", "D6"][s % 4])), 0.5, 0.65), 52 + b * BAR + s * BAR / 16, 0.18 * (1 - s / 32), pan=(-0.4 if s % 2 else 0.4))
add(drums, tom(80), 54.0, 0.5)
add(fx, boom(4.0), 56.45, 0.6)
add(fx, cymbal(4.0), 56.45, 0.5)
add(fx, reverse_swell(0.9), 55.55, 0.7)
add(mel, shimmer_cloud(3.6, density=7, notes=("F6", "A6", "C7", "G6", "E7", "C6")), 56.45, 0.6)
for k, n_ in enumerate(["F5", "C6", "G6", "A6"]):
    add(mel, bell(midi(nm(n_)), 3.6, idx=1.2), 56.47 + k * 0.11, 0.36, pan=-0.45 + k * 0.3)

# ------------------------------------------------- picture-sync SFX stem
for t0, d in [(5.55, 0.9), (13.4, 0.9), (19.55, 0.9), (27.55, 0.9), (35.55, 0.9), (51.5, 0.85)]:
    add(sfx, whoosh(d), t0, 0.55)
add(sfx, whoosh(0.7, 600, 5200), 16.05, 0.35)     # ribbon sweep
for t0 in (46.9, 48.3, 50.1, 50.6):                 # number locks
    add(sfx, tom(140), t0, 0.22)
add(sfx, shimmer_cloud(1.5, density=6), 57.55, 0.35)  # CTA sparkle

# ---------------------------------------------------------------- mix bus
# sidechain duck for pad / bass / arp from kick hits
t = np.arange(int(0.3 * SR)) / SR
duck = np.ones(N)
for kt in kick_times:
    i = int(kt * SR)
    m = min(len(t), N - i)
    duck[i:i + m] = np.minimum(duck[i:i + m], 1 - 0.55 * np.exp(-t[:m] / 0.12))
duck = duck[:, None]

music = pad * duck * 0.9 + bass * duck * 0.55 + arp * duck * 0.8 + drums * 0.85 + mel * 0.8 + fx * 0.8
wet = reverb(pad * 0.5 + arp * duck * 0.6 + mel * 1.0 + fx * 0.5 + drums * 0.12, rt=3.2)
arp_delay = ping_pong(arp * duck * 0.35) - arp * duck * 0.35
music = music + wet * 0.45 + arp_delay * 0.6

# fade out ending
fo0, fo1 = int(58.4 * SR), int(60.0 * SR)
music[fo0:fo1] *= np.linspace(1, 0, fo1 - fo0)[:, None] ** 1.6
music[fo1:] = 0
music = hp(music, 38)
music = shelf(music, 110, -4.5, "low")
music = shelf(music, 2200, 4.0, "high")
music = np.tanh(music * 0.9) / 0.9
peak = np.abs(music).max()
music = music / peak * 0.89
sfx = hp(sfx, 120)
sfx = sfx / max(np.abs(sfx).max(), 1e-9) * 0.7

out = root / "assets/audio"
wavfile.write(out / "music.wav", SR, music.astype(np.float32))
wavfile.write(out / "sfx.wav", SR, sfx.astype(np.float32))
print("music peak", peak, "written", out / "music.wav")
