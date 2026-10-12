"""録音を Whisper で文字にする(Apple シリコンの Mac 用)

使い方: python transcribe.py 録音1.m4a [録音2.mp3 ...]
録音と同じフォルダに「録音名_文字起こし.txt」を作る(録音そのものは書き換えない)。
中身は [分:秒] 付きの行で、スマホのアプリの「取り込む」にそのまま入れられる。
音声は Mac 付属の afconvert で 16kHz モノラルにして読み、Mac の中だけで処理する(外へは送らない)。
"""
import argparse
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

MODEL = "mlx-community/whisper-large-v3-turbo"
SAMPLE_RATE = 16000
# 句読点を付けさせるための書き出し(アプリの要点リストは句点で文を分ける)
PROMPT = "以下は、稽古や打ち合わせ、レッスンでの会話です。"


def to_wav(src: Path, dst: Path) -> None:
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", f"LEI16@{SAMPLE_RATE}", "-c", "1", str(src), str(dst)],
        check=True, capture_output=True,
    )


def load_wav(path: Path):
    import numpy as np
    with wave.open(str(path)) as w:
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, np.int16).astype(np.float32) / 32768.0


def stamp(sec: float) -> str:
    s = int(sec)
    h, m, s = s // 3600, s % 3600 // 60, s % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def format_segments(segments) -> str:
    """Whisper の区切りを [分:秒] 付きの行にする。同じ文が続くのは無音での言い間違い(繰り返し)なので1つにする"""
    lines, prev = [], None
    for seg in segments:
        text = seg["text"].strip()
        if not text or text == prev:
            continue
        prev = text
        lines.append(f"[{stamp(seg['start'])}] {text}")
    return "\n".join(lines) + "\n"


def out_path(src: Path) -> Path:
    path = src.with_name(f"{src.stem}_文字起こし.txt")
    n = 2
    while path.exists():
        path = src.with_name(f"{src.stem}_文字起こし({n}).txt")
        n += 1
    return path


def run_whisper(audio, language: str):
    import mlx_whisper
    return mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=MODEL,
        language=language,
        initial_prompt=PROMPT if language == "ja" else None,
        # 前の文に引きずられて同じ言葉を繰り返すのを防ぐ
        condition_on_previous_text=False,
        # 無音や音楽だけのところで、話していない言葉を書くのを防ぐ
        word_timestamps=True,
        hallucination_silence_threshold=2.0,
        verbose=False,
    )


def transcribe_file(src: Path, language: str = "ja", whisper=run_whisper) -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        to_wav(src, wav)
        audio = load_wav(wav)
    result = whisper(audio, language)
    dst = out_path(src)
    dst.write_text(format_segments(result["segments"]), encoding="utf-8")
    return dst


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="録音を Whisper で文字にする")
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--lang", default="ja", help="話している言語(標準は ja)")
    args = ap.parse_args(argv)

    failed = 0
    for i, src in enumerate(args.files, 1):
        print(f"\n[{i}/{len(args.files)}] {src.name}")
        if not src.exists():
            print("  見つかりません。飛ばします。")
            failed += 1
            continue
        start = time.time()
        try:
            dst = transcribe_file(src, args.lang)
        except subprocess.CalledProcessError:
            print("  この録音の形式を読めませんでした(m4a・mp3・wav などにしてください)。")
            failed += 1
            continue
        mins, secs = divmod(int(time.time() - start), 60)
        print(f"  できました({mins}分{secs}秒): {dst.name}")
        print(f"OUTPUT\t{dst}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
