// 取り込み: ほかのアプリ(Google の「音声文字変換」など)で文字にしたものを、行に分けて記録にする
// 時刻が書かれていれば経過時間に直し、無ければ時間なしの行にする

// 行頭の時刻: [00:12] / 00:12 / 1:02:03 / 午後3:21 など
const STAMP = /^\[?\s*(午前|午後)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*\]?\s*/;

function stampMs(m) {
  let h = 0, mi, s;
  if (m[4] !== undefined) { h = Number(m[2]); mi = Number(m[3]); s = Number(m[4]); }
  else if (m[1]) { h = Number(m[2]); mi = Number(m[3]); s = 0; }   // 午前/午後 付きは時刻(時:分)
  else { mi = Number(m[2]); s = Number(m[3]); }                    // 2つだけは 分:秒 とみなす
  if (m[1] === '午後' && h < 12) h += 12;
  return ((h * 60 + mi) * 60 + s) * 1000;
}

// 句点などで文に分け、それでも長すぎるものは空白・読点で区切る
function pieces(text) {
  const out = [];
  for (const s of text.split(/(?<=[。！？!?])\s*/)) {
    let rest = s.trim();
    while (rest.length > 120) {
      const cut = Math.max(rest.lastIndexOf(' ', 100), rest.lastIndexOf('　', 100), rest.lastIndexOf('、', 100));
      if (cut < 30) break;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

export function parseTranscript(raw) {
  let text = String(raw || '').replace(/\r\n?/g, '\n');
  // このアプリの書き出しを取り込み直すときは、要点の部分を飛ばして文字起こしだけ使う
  const body = text.indexOf('■ 文字起こし\n');
  if (body >= 0) text = text.slice(body + '■ 文字起こし\n'.length);

  const lines = [];
  let base = null;   // 最初の時刻(ここを 00:00 にする)
  let t = null;
  for (let row of text.split('\n')) {
    row = row.trim();
    if (!row) continue;
    const m = row.match(STAMP);
    if (m && (m[0].length === row.length || /\s|\]/.test(m[0]))) {
      const ms = stampMs(m);
      base ??= ms;
      t = Math.max(0, ms - base);
      row = row.slice(m[0].length).trim();
      if (!row) continue;   // 時刻だけの行
    }
    for (const p of pieces(row)) lines.push({ t, text: p });
  }
  return lines;
}
