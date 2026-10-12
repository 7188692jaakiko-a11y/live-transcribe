// 取り込み: ほかのアプリ(Google の「音声文字変換」など)で文字にしたものを、行に分けて記録にする
// 時刻が書かれていれば経過時間に直し、無ければ時間なしの行にする
// 文字起こしソフト(Aiko など)が書き出す字幕ファイル(SRT・VTT)も、各字幕の始まりの時刻付きで取り込む

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

// 字幕の時刻: 00:00:05,000 / 00:05.000(VTT は時が省ける)
const CUE = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->/;

function parseSubtitles(text) {
  const lines = [];
  for (const block of text.split(/\n\s*\n/)) {
    const rows = block.split('\n').map((r) => r.trim());
    const i = rows.findIndex((r) => CUE.test(r));
    if (i < 0) continue;   // WEBVTT の見出し・NOTE など
    const m = rows[i].match(CUE);
    const t = (((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000) + Number(m[4].padEnd(3, '0'));
    // <v 話者> などの飾りは外す
    const body = rows.slice(i + 1).join(' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    for (const p of pieces(body)) {
      // 字幕は細かく切れているので、同じ字幕の続きは前の行と同じ時刻
      lines.push({ t, text: p });
    }
  }
  return lines;
}

export function parseTranscript(raw) {
  let text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.split('\n').some((r) => CUE.test(r.trim()))) return parseSubtitles(text);
  // このアプリの書き出しを取り込み直すときは、要点の部分を飛ばして文字起こしだけ使う
  const body = text.indexOf('■ 文字起こし\n');
  if (body >= 0) text = text.slice(body + '■ 文字起こし\n'.length);

  const lines = [];
  let base = null;   // 時計の時刻(午前/午後)のときだけ、最初の時刻を 00:00 にする
  let t = null;
  for (let row of text.split('\n')) {
    row = row.trim();
    if (!row) continue;
    const m = row.match(STAMP);
    if (m && (m[0].length === row.length || /\s|\]/.test(m[0]))) {
      const ms = stampMs(m);
      if (m[1]) base ??= ms;   // [分:秒] などの経過時間(録音の頭から)は、そのまま使う
      t = Math.max(0, ms - (base ?? 0));
      row = row.slice(m[0].length).trim();
      if (!row) continue;   // 時刻だけの行
    }
    for (const p of pieces(row)) lines.push({ t, text: p });
  }
  return lines;
}
