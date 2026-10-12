#!/bin/bash
# ダブルクリックで、選んだ録音を Whisper で文字にする(Apple シリコンの Mac 用)
# 初回だけ、必要な部品と Whisper のモデル(約1.6GB)をダウンロードする(数分〜十数分)
cd "$(dirname "$0")" || exit 1

finish() {
  echo
  read -n 1 -s -r -p "何かキーを押すと、この画面を閉じます"
  exit "${1:-0}"
}

if [ "$(uname -m)" != "arm64" ]; then
  echo "この Mac では使えません(M1 以降の Apple シリコンの Mac が必要です)。"
  finish 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python が入っていません。https://www.python.org/downloads/ から入れてください。"
  finish 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "初回の準備をしています(数分かかります)…"
  python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -r requirements.txt
  if [ $? -ne 0 ]; then
    rm -rf .venv
    echo "準備に失敗しました。インターネットにつながっているか確かめて、もう一度ダブルクリックしてください。"
    finish 1
  fi
fi

# 録音を選ぶ画面(Dropbox があればそこから開く)
START="$HOME"
for d in "$HOME/Library/CloudStorage/Dropbox" "$HOME/Dropbox"; do
  [ -d "$d" ] && START="$d" && break
done
FILES=$(START="$START" osascript <<'EOF'
set startDir to POSIX file (system attribute "START")
try
  set picked to choose file with prompt "文字にする録音を選んでください(複数選べます)" of type {"public.audio", "public.movie"} default location startDir with multiple selections allowed
on error
  return ""
end try
set out to ""
repeat with f in picked
  set out to out & POSIX path of f & linefeed
end repeat
return out
EOF
)
if [ -z "$FILES" ]; then
  echo "録音が選ばれなかったので、やめました。"
  finish 0
fi

IFS=$'\n' read -r -d '' -a LIST <<< "$FILES"
LOG=$(mktemp)
.venv/bin/python transcribe.py "${LIST[@]}" | tee "$LOG"
STATUS=${PIPESTATUS[0]}

# できた文字起こしを開く
grep '^OUTPUT' "$LOG" | cut -f2 | while read -r out; do open "$out"; done
rm -f "$LOG"
osascript -e 'display notification "文字起こしが終わりました" with title "文字起こし"' >/dev/null 2>&1
echo
echo "文字起こしは、録音と同じフォルダに「録音名_文字起こし.txt」として保存しました。"
echo "スマホのアプリの ☰ →「取り込む」→「テキストファイルを選ぶ」で取り込めます。"
finish "$STATUS"
