"""Transcribe each narration line with Paraformer to verify pronunciation and get word timings."""
import json, pathlib, subprocess, dashscope
from dashscope.audio.asr import Recognition

root = pathlib.Path(__file__).resolve().parent.parent
for line in (root / ".env").read_text(encoding="utf-8").splitlines():
    if line.startswith("DASHSCOPE_API_KEY="):
        dashscope.api_key = line.split("=", 1)[1].strip()

out = {}
tmp = root / ".hyperframes"; tmp.mkdir(exist_ok=True)
for wav in sorted((root / "assets/audio/vo").glob("L*.wav")):
    pcm = tmp / (wav.stem + "_16k.wav")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ar", "16000", "-ac", "1", str(pcm)], check=True)
    rec = Recognition(model="paraformer-realtime-v2", format="wav", sample_rate=16000, callback=None)
    res = rec.call(str(pcm))
    sents = res.get_sentence() or []
    words = [w for s in sents for w in s.get("words", [])]
    text = "".join(s.get("text", "") for s in sents)
    out[wav.stem] = {"text": text, "words": [{"t": w["text"], "b": w["begin_time"], "e": w["end_time"], "p": w.get("punctuation", "")} for w in words]}
    print(wav.stem, text)
(root / ".hyperframes/vo_words.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
