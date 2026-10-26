"""Per-section octave-band energy report for a wav (sanity check of mix balance)."""
import sys
import numpy as np
from scipy.io import wavfile
from scipy import signal

sr, x = wavfile.read(sys.argv[1])
m = x.mean(axis=1) if x.ndim > 1 else x
secs = [(0, 6), (6, 14), (14, 20), (20, 28), (28, 36), (36, 44), (44, 52), (52, 60)]
bands = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
print("sec    " + " ".join(f"{b:>6}" for b in bands))
for a, b in secs:
    seg = m[int(a * sr):int(b * sr)]
    f, p = signal.welch(seg, sr, nperseg=8192)
    row = []
    for c in bands:
        lo, hi = c / 2 ** 0.5, c * 2 ** 0.5
        e = p[(f >= lo) & (f < hi)].sum()
        row.append(10 * np.log10(e + 1e-15))
    ref = max(row)
    print(f"{a:>2}-{b:<3} " + " ".join(f"{r - ref:6.1f}" for r in row))
