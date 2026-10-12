"""mac/transcribe.py の確かめ(Whisper と afconvert は偽物に差し替える。Mac でなくても動く)
使い方: python3 -m unittest discover -s mac/tests
"""
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import transcribe  # noqa: E402


def fake_to_wav(src, dst):
    with wave.open(str(dst), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 1600)


class TranscribeTest(unittest.TestCase):
    def test_stamp(self):
        self.assertEqual(transcribe.stamp(5.9), "00:05")
        self.assertEqual(transcribe.stamp(70), "01:10")
        self.assertEqual(transcribe.stamp(3723), "1:02:03")

    def test_format_skips_empty_and_repeats(self):
        segs = [
            {"start": 0.0, "text": " 始めます。"},
            {"start": 3.2, "text": " "},
            {"start": 5.0, "text": "テンポは96で。"},
            {"start": 9.0, "text": "テンポは96で。"},
            {"start": 75.4, "text": "2幕から。"},
        ]
        self.assertEqual(transcribe.format_segments(segs),
                         "[00:00] 始めます。\n[00:05] テンポは96で。\n[01:15] 2幕から。\n")

    def test_file_written_next_to_recording_without_touching_it(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "10月12日 稽古.m4a"
            src.write_bytes(b"original")
            calls = []

            def whisper(audio, language):
                calls.append((len(audio), language))
                return {"segments": [{"start": 1.0, "text": "おはようございます。"}]}

            with mock.patch.object(transcribe, "to_wav", fake_to_wav):
                out1 = transcribe.transcribe_file(src, whisper=whisper)
                out2 = transcribe.transcribe_file(src, whisper=whisper)
            self.assertEqual(out1.name, "10月12日 稽古_文字起こし.txt")
            self.assertEqual(out2.name, "10月12日 稽古_文字起こし(2).txt", "前の結果を上書きしない")
            self.assertEqual(out1.read_text(encoding="utf-8"), "[00:01] おはようございます。\n")
            self.assertEqual(src.read_bytes(), b"original", "録音は書き換えない")
            self.assertEqual(calls[0], (1600, "ja"))

    def test_main_reports_missing_and_unreadable(self):
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "x.amr"
            bad.write_bytes(b"?")
            err = transcribe.subprocess.CalledProcessError(1, "afconvert")
            with mock.patch.object(transcribe, "to_wav", side_effect=err):
                self.assertEqual(transcribe.main([str(bad), str(Path(d) / "none.m4a")]), 1)


if __name__ == "__main__":
    unittest.main()
