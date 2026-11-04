/** Pure local text processing. No network or generated facts. */
export function createNote(now = new Date()) {
  return { id: crypto.randomUUID(), title: '新しいノート', createdAt: now.toISOString(), updatedAt: now.toISOString(), elapsed: 0, segments: [], summary: '', decisions: [], tasks: [], summarizedText: null };
}
export function noteText(note) { return note.segments.map(s => s.text).join('\n'); }
export function timeLabel(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export function sentences(text) {
  return [...new Set(text.replace(/\r/g, '').split(/(?<=[。！？!?])\s*|\n+/u).map(s => s.trim()).filter(Boolean))];
}
const uncertain = /未定|未決|検討|提案|どうで|でしょうか|ですか|ますか|ませんか|かもしれ|と思[いう]|[?？]|まだ決|決まってい|決まら|決めてい|決めない|決めません|合意してい|合意でき|承認されてい|承認してい|確定してい|取り消|撤回|中止|しない|しません|できない|できません|不要/;
const decision = /決定|確定|合意|承認|決まりました|決まった|に決め|にします|とします|で進め|採用します|採用する|可決/;
const task = /(?:確認|作成|準備|送付|送信|連絡|共有|調整|提出|対応|手配|予約|更新|修正|調査|実施|確認|見直し|まとめ|整理|持参|用意|配布|相談|報告|アップロード|チェック|送[りる])[^。！？]{0,40}(?:します|する|して|お願い|必要|担当|予定|までに)|(?:お願い|担当|までに|やること|宿題|必要です|必要があ)/;
const completed = /完了|済み|終わりました|しました|してあります|しておきました|不要|必要[はが]ない|しない|しません|取り消|撤回/;
const filler = /^(?:はい|ええ|うん|そうですね|なるほど|あの|えーと|ありがとう(?:ございます|ございました)?|お疲れさまでした)[。、！!\s]*$/;
function words(text) {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)].filter(s => s.isWordLike && s.segment.length > 1).map(s => s.segment);
  return text.match(/[一-龠ァ-ヺ]{2,}|[a-zA-Z0-9]{2,}/g) || [];
}
export function extractInsights(text) {
  const lines = sentences(text).filter(s => s.length >= 5 && !filler.test(s));
  const freq = new Map();
  lines.forEach(s => new Set(words(s)).forEach(w => freq.set(w, (freq.get(w) || 0) + 1)));
  const scored = lines.map((s, i) => ({ text: s, i, score: words(s).reduce((n, w) => n + Math.log(1 + (freq.get(w) || 0)), 0) / Math.sqrt(Math.max(s.length, 10)) + (decision.test(s) || task.test(s) ? 1 : 0) + (i === 0 ? 0.3 : 0) }));
  const summary = scored.sort((a, b) => b.score - a.score).slice(0, 5).sort((a, b) => a.i - b.i).map(s => `・${s.text}`).join('\n');
  return { summary, decisions: lines.filter(s => decision.test(s) && !uncertain.test(s)).map(text => ({ id: crypto.randomUUID(), text })), tasks: lines.filter(s => task.test(s) && !uncertain.test(s) && !completed.test(s)).map(text => ({ id: crypto.randomUUID(), text, done: false })) };
}
export function removeOverlap(previous, next) {
  const clean = s => s.replace(/[\s。、，,.!?！？]/g, '');
  const left = clean(previous).slice(-100), right = clean(next);
  let overlap = 0;
  for (let n = Math.min(left.length, right.length); n >= 4; n--) {
    if (left.endsWith(right.slice(0, n))) { overlap = n; break; }
  }
  if (!overlap) return next.trim();
  let seen = 0, index = 0;
  while (index < next.length && seen < overlap) { if (clean(next[index])) seen++; index++; }
  return next.slice(index).replace(/^[\s。、，,.!?！？]+/, '').trim();
}
export function markdown(note) {
  return `# ${note.title}\n\n${new Date(note.createdAt).toLocaleString('ja-JP')} · ${timeLabel(note.elapsed)}\n\n## 要約（発言からの抽出）\n\n${note.summary || '未作成'}\n\n## 決定事項\n\n${note.decisions.map(x => `- ${x.text}`).join('\n') || '未登録'}\n\n## やること\n\n${note.tasks.map(x => `- [${x.done ? 'x' : ' '}] ${x.text}`).join('\n') || '未登録'}\n\n## 文字起こし\n\n${note.segments.map(s => `[${timeLabel(s.start)}] ${s.text}`).join('\n\n')}\n`;
}
export function validateNote(n) {
  if (!n || typeof n.id !== 'string' || typeof n.title !== 'string' || !Number.isFinite(Date.parse(n.createdAt)) || !Array.isArray(n.segments) || !Array.isArray(n.decisions) || !Array.isArray(n.tasks)) throw new Error('ノートの形式を確認してください。');
  for (const s of n.segments) if (typeof s.text !== 'string' || !Number.isFinite(s.start) || s.start < 0) throw new Error('文字起こしの形式が正しくありません。');
  for (const item of [...n.decisions, ...n.tasks]) if (typeof item.id !== 'string' || typeof item.text !== 'string') throw new Error('リストの形式が正しくありません。');
  if (typeof n.summary !== 'string' || !Number.isFinite(n.elapsed) || n.elapsed < 0) throw new Error('ノートが破損しています。');
  return n;
}
