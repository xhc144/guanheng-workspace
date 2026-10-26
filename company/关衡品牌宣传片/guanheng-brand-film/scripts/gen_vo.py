"""Generate narration lines with DashScope CosyVoice (voice: longtian_v3)."""
import sys, time, pathlib, dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer, AudioFormat

root = pathlib.Path(__file__).resolve().parent.parent
for line in (root / ".env").read_text(encoding="utf-8").splitlines():
    if line.startswith("DASHSCOPE_API_KEY="):
        dashscope.api_key = line.split("=", 1)[1].strip()

MODEL, VOICE = "cosyvoice-v3-flash", "longtian_v3"
only = set(sys.argv[1:])
for row in (root / "scripts/vo_lines.txt").read_text(encoding="utf-8").splitlines():
    if not row.strip():
        continue
    key, text = row.split("|", 1)
    if only and key not in only:
        continue
    for attempt in range(3):
        try:
            synth = SpeechSynthesizer(model=MODEL, voice=VOICE, format=AudioFormat.WAV_48000HZ_MONO_16BIT)
            audio = synth.call(text)
            if audio:
                (root / f"assets/audio/vo/{key}.wav").write_bytes(audio)
                print(key, "ok", len(audio))
                break
        except Exception as e:
            print(key, "retry", attempt, str(e)[:120])
            time.sleep(2)
