// 要点リスト: 文字起こしから、言い回しを手がかりに大事そうな発言を拾う
// AI は使わない(端末の中だけで動き、料金も通信もかからない)。拾い方はここの言葉のリストで調整する

export const SECTIONS = [
  ['marked', '印を付けたところ'],
  ['decisions', '決まったこと・指示'],
  ['todos', 'やること'],
  ['questions', '保留・質問'],
  ['facts', '日時・数字'],
];

// 上から順に当てはめ、最初に当たった分け方に入れる
const RULES = [
  ['questions', /(？|\?|ですか|ますか|でしょうか|ませんか|かな$|かね$|未定|保留|検討し|要確認|あとで確認|後で確認|どうしよう|どうする|どうします|わからない|分からない)/],
  ['todos', /(までに|宿題|お願いします|お願いしました|してください|して下さい|しておいて|しといて|やっておい|やっといて|練習して|練習しておく|さらって|さらっておく|覚えて|確認して|確認しておく|送って|連絡して|準備して|用意して|持ってきて|持参|提出|予約|手配|次回まで|来週まで)/],
  ['decisions', /(しましょう|しよう|にします|ことにし|ことにな|に決定|決まり|決めました|で行きます|でいきます|で行こう|でいこう|に統一|はなしで|はなし$|なしにし|やめましょう|やめます|でお願いします|ように(して|弾|歌|吹)|テンポは|(弾|歌|吹|叩)いて(ください|下さい|みて|ね)|(弾|歌|吹|叩)きましょう|(弾|歌|吹|叩)きます)/],
  ['facts', /(\d+ ?(日|時|分|月|曜|小節|ページ|番|回|人|円|拍|%|％)|\d+[:：]\d+|[月火水木金土日]曜|明日|明後日|あさって|来週|再来週|来月|今週|午前|午後|テンポ ?\d+)/],
];

const MARK = '★ 印';

function sentences(text) {
  // 句点などで区切る(音声認識が句点を付けないときは1行のまま)
  return text.split(/(?<=[。！？!?])\s*/).map((s) => s.trim()).filter(Boolean);
}

export function extractPoints(lines, fmt) {
  const out = Object.fromEntries(SECTIONS.map(([k]) => [k, []]));
  const seen = new Set();
  const add = (key, text, t) => {
    if (seen.has(key + text)) return;
    seen.add(key + text);
    out[key].push({ text, at: fmt(t) });
  };
  lines.forEach((line, i) => {
    if (line.mark) {
      // 印は、その直前の発言を拾う。印の行に書き足したメモがあれば添える
      const memo = line.text.startsWith(MARK) ? line.text.slice(MARK.length).trim() : line.text.trim();
      const prev = lines.slice(0, i).reverse().find((l) => !l.mark);
      const text = [prev?.text, memo && `(${memo})`].filter(Boolean).join(' ');
      if (text) add('marked', text, prev?.t ?? line.t);
      return;
    }
    // あとから行頭に ★ を付けた行(取り込んだ文字起こしなど)も印として拾う
    if (line.text.startsWith('★')) {
      const text = line.text.replace(/^★\s*/, '');
      if (text) add('marked', text, line.t);
      return;
    }
    for (const s of sentences(line.text)) {
      const rule = RULES.find(([, re]) => re.test(s));
      if (rule) add(rule[0], s, line.t);
    }
  });
  return out;
}

// Claude アプリに渡して詳しくまとめてもらうための文章(Claude のプランの範囲で使え、追加料金はかからない)
export function claudePrompt(session, fmt) {
  const date = new Date(session.createdAt).toLocaleString('ja-JP');
  const body = session.lines.map((l) => (l.t != null ? `[${fmt(l.t)}] ` : '') + l.text).join('\n');
  return `次は打ち合わせ・レッスンなどの音声認識による文字起こしです。誤認識を含むので、文脈から意味を汲み取ってください。
「★ 印」の行は、記録した人が大事だと印を付けたところです(直前の発言が対象)。★ で始まる行も、印を付けた発言です。

次の分け方で、日本語の箇条書きにまとめてください。経過時間 [分:秒] があれば、各項目に添えてください。
- 要点
- 決まったこと・指示
- やること(誰が・いつまでに、が分かれば添える)
- 保留・あとで確認すること

記録: ${session.title || '名前のない記録'}(${date})

${body}
`;
}
