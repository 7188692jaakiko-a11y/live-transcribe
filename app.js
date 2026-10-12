// ライブ文字起こし: 端末(ブラウザ)の音声認識で話した言葉をその場で文字にする
import { extractPoints, claudePrompt, SECTIONS } from './points.js';
import { parseTranscript } from './import.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'lt.sessions.v1';
const CURRENT_KEY = 'lt.current';
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// ---- 保存(この端末の中だけ) ----

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveSessions() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(sessions));
    localStorage.setItem(CURRENT_KEY, current.id);
  } catch {
    showNotice('この端末に保存できませんでした(空き容量・プライベートブラウズ)。消える前に「書き出し」で保存してください。');
  }
}
function newSession() {
  const s = { id: String(Date.now()), title: '', lang: $('lang').value || 'ja-JP',
              createdAt: Date.now(), durationMs: 0, lines: [] };
  sessions.unshift(s);
  return s;
}

let sessions = loadSessions();
let current = sessions.find((s) => s.id === safeGet(CURRENT_KEY)) || sessions[0] || newSession();

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }

// ---- 時間 ----

let runStart = 0;          // 今回の録音を始めた時刻(録音中だけ)
let utterStart = null;     // いま認識中の発言が始まった経過時間

function elapsed() {
  return current.durationMs + (runStart ? Date.now() - runStart : 0);
}
function fmt(ms) {
  if (ms == null) return '';   // 時刻の無い行(取り込んだもの)
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---- 表示 ----

function render() {
  $('title').value = current.title;
  $('lang').value = current.lang;
  const box = $('transcript');
  box.querySelectorAll('.line').forEach((el) => el.remove());
  current.lines.forEach((line, i) => box.appendChild(lineEl(line, i)));
  $('empty').hidden = current.lines.length > 0;
  $('clock').textContent = fmt(elapsed());
  renderSummary();
}

function lineEl(line, i) {
  const p = document.createElement('p');
  p.className = 'line' + (line.mark ? ' mark' : '');
  const t = document.createElement('button');
  t.className = 't';
  t.textContent = fmt(line.t) || '・';
  // 時間の所を押すと、その行に ★ を付け外しする(「印を付けたところ」に入る)
  t.title = '押すと ★ を付ける/外す';
  if (!line.mark) t.onclick = () => toggleStar(line);
  const x = document.createElement('span');
  x.className = 'x';
  x.contentEditable = 'true';
  x.spellcheck = false;
  x.textContent = line.text;
  x.dataset.i = i;
  x.addEventListener('blur', () => editLine(line, x));
  x.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); x.blur(); } });
  p.append(t, x);
  return p;
}

function toggleStar(line) {
  line.text = line.text.startsWith('★') ? line.text.replace(/^★\s*/, '') : `★ ${line.text}`;
  saveSessions();
  const top = $('transcript').scrollTop;
  render();
  $('transcript').scrollTop = top;
}

function editLine(line, el) {
  const text = el.textContent.trim();
  if (text === line.text) return;
  if (text) line.text = text;
  else current.lines.splice(current.lines.indexOf(line), 1);
  saveSessions();
  render();
}

function scrollToEnd() {
  const box = $('transcript');
  // 直している最中や、上を読み返しているときは動かさない
  if (box.contains(document.activeElement)) return;
  if (box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
}

function addLine(text, opts = {}) {
  text = text.trim();
  if (!text) return;
  const line = { t: opts.t ?? elapsed(), text };
  if (opts.mark) line.mark = true;
  current.lines.push(line);
  $('empty').hidden = true;
  $('transcript').appendChild(lineEl(line, current.lines.length - 1));
  saveSessions();
  scrollToEnd();
  renderSummary(true);
  return line;
}

function showNotice(msg) {
  const n = $('notice');
  n.textContent = msg;
  n.hidden = !msg;
}

// ---- 音声認識 ----

let rec = null;
let wantRec = false;       // 利用者が「開始」を押している間 true
let committed = 0;         // 今回の認識で確定済みにした結果の数
let interimText = '';
let lastRunLine = null;    // 今回の認識で最後に確定した行(重複の取り除きに使う)
let failures = 0;          // 結果が出ないまま続いたエラーの回数
let restartTimer = null;
let wakeLock = null;

function createRecognition() {
  const r = new SR();
  r.lang = current.lang;
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;

  r.onstart = () => { committed = 0; lastRunLine = null; };

  r.onresult = (e) => {
    failures = 0;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const text = res[0].transcript;
      if (res.isFinal) {
        if (i >= committed) {
          commitFinal(text);
          committed = i + 1;
        }
      } else {
        interim += text;
      }
    }
    if (interim && utterStart === null) utterStart = elapsed();
    interimText = interim;
    $('interim').textContent = interim;
    scrollToEnd();
  };

  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      stopRecording();
      showNotice('マイクか音声認識が許可されていません。ブラウザの設定でマイクを許可してください。'
        + 'iPad では「設定 > Apple Intelligence と Siri(または Siri)」と「キーボード > 音声入力」がオンになっている必要があります。');
      return;
    }
    failures++;
    if (e.error === 'network') showNotice('音声認識の通信が切れました。つなぎ直しています…');
    else if (e.error === 'audio-capture') showNotice('マイクが使えません。ほかのアプリがマイクを使っていないか確認してください。');
    else showNotice(`音声認識のエラー(${e.error})。つなぎ直しています…`);
    if (failures >= 6) {
      stopRecording();
      showNotice('音声認識が続けて失敗したので止めました。通信状態を確かめてから、もう一度「開始」を押してください。');
    }
  };

  r.onend = () => {
    // iPad の Safari は確定せずに終わることがあるので、途中の文字を確定させて残す
    if (interimText) commitFinal(interimText);
    interimText = '';
    $('interim').textContent = '';
    if (wantRec) {
      // 無音などで認識が止まっても、押している間は自動でつなぎ直す
      clearTimeout(restartTimer);
      restartTimer = setTimeout(startEngine, failures ? Math.min(500 * 2 ** failures, 8000) : 150);
    }
  };
  return r;
}

function commitFinal(text) {
  text = text.trim();
  const t = utterStart ?? elapsed();
  utterStart = null;
  interimText = '';
  if (!text) return;
  // Android の Chrome は、前の確定結果を含んだ長い結果をもう一度確定させることがあるので、置き換える
  if (lastRunLine && current.lines.at(-1) === lastRunLine && text.startsWith(lastRunLine.text)) {
    lastRunLine.text = text;
    saveSessions();
    render();
    scrollToEnd();
    return;
  }
  lastRunLine = addLine(text, { t });
}

function startEngine() {
  if (!wantRec) return;
  try {
    rec = createRecognition();
    rec.start();
  } catch (err) {
    // すでに動いているなど。少し待ってやり直す
    restartTimer = setTimeout(startEngine, 1000);
  }
}

async function startRecording() {
  if (!SR) return;
  showNotice('');
  wantRec = true;
  failures = 0;
  runStart = Date.now();
  current.lang = $('lang').value;
  startEngine();
  setRecUI(true);
  requestWakeLock();
}

function stopRecording() {
  wantRec = false;
  clearTimeout(restartTimer);
  if (rec) { try { rec.stop(); } catch {} }
  if (runStart) {
    current.durationMs += Date.now() - runStart;
    runStart = 0;
  }
  saveSessions();
  setRecUI(false);
  releaseWakeLock();
}

function setRecUI(on) {
  $('btn-rec').textContent = on ? '■ 停止' : '● 開始';
  $('btn-rec').classList.toggle('on', on);
  $('clock').classList.toggle('on', on);
  $('btn-mark').disabled = !on;
  $('lang').disabled = on;
  $('btn-sessions').disabled = on;
}

// 録音中は画面が消えないようにする(画面が消えるとマイクも止まる)
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantRec) {
    requestWakeLock();
    // 裏に回ったあいだに止まっていたらつなぎ直す
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { if (wantRec) { try { rec?.abort(); } catch {} startEngine(); } }, 300);
  }
});

// ---- 書き出し ----

function exportText(withTime) {
  const s = current;
  const date = new Date(s.createdAt).toLocaleString('ja-JP');
  const head = `${s.title || '名前のない記録'}\n${date}(${fmt(s.durationMs + (runStart ? Date.now() - runStart : 0))})\n\n`;
  const body = s.lines.map((l) => (withTime && l.t != null ? `[${fmt(l.t)}] ` : '') + l.text).join('\n');
  let summary = '';
  if ($('opt-summary').checked) {
    const points = extractPoints(s.lines, fmt);
    for (const [key, label] of SECTIONS) {
      const items = points[key];
      if (!items.length) continue;
      summary += `■ ${label}\n` + items.map((it) => `・${it.text}` + (withTime && it.at ? ` [${it.at}]` : '')).join('\n') + '\n\n';
    }
    if (summary) summary += '■ 文字起こし\n';
  }
  return head + summary + body + '\n';
}
function exportName() {
  const d = new Date(current.createdAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    + `_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const title = (current.title || '文字起こし').replace(/[\\/:*?"<>|]/g, '_');
  return `${stamp}_${title}.txt`;
}

$('btn-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(exportText($('opt-time').checked));
    $('btn-copy').textContent = 'コピーしました';
    setTimeout(() => { $('btn-copy').textContent = '文字をコピー'; }, 1500);
  } catch {
    showNotice('コピーできませんでした。テキストファイルの保存をお使いください。');
  }
};
$('btn-share').onclick = async () => {
  const text = exportText($('opt-time').checked);
  const file = new File([text], exportName(), { type: 'text/plain' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: current.title || '文字起こし' });
    else if (navigator.share) await navigator.share({ title: current.title || '文字起こし', text });
    else showNotice('このブラウザは共有に対応していません。コピーかファイル保存をお使いください。');
  } catch (err) {
    if (err.name !== 'AbortError') showNotice('共有できませんでした。');
  }
};
$('btn-download').onclick = () => {
  const url = URL.createObjectURL(new Blob([exportText($('opt-time').checked)], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = exportName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

// ---- 記録の一覧 ----

function renderSessionList() {
  const ul = $('session-list');
  ul.replaceChildren();
  for (const s of sessions) {
    const li = document.createElement('li');
    if (s === current) li.className = 'current';
    const open = document.createElement('button');
    open.className = 'open';
    open.textContent = s.title || '名前のない記録';
    const small = document.createElement('small');
    small.textContent = `${new Date(s.createdAt).toLocaleString('ja-JP')}・${fmt(s.durationMs)}・${s.lines.length} 行`;
    open.appendChild(small);
    open.onclick = () => { current = s; saveSessions(); render(); $('dlg-sessions').close(); };
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '削除';
    del.onclick = () => {
      if (!confirm(`「${s.title || '名前のない記録'}」を削除します。元に戻せません。`)) return;
      sessions.splice(sessions.indexOf(s), 1);
      if (s === current) current = sessions[0] || newSession();
      saveSessions();
      render();
      renderSessionList();
    };
    li.append(open, del);
    ul.appendChild(li);
  }
}

// ---- 操作 ----

$('btn-rec').onclick = () => (wantRec ? stopRecording() : startRecording());
$('btn-mark').onclick = () => addLine('★ 印', { mark: true });
$('btn-caption').onclick = () => {
  const on = document.body.classList.toggle('caption');
  $('btn-caption').classList.toggle('active', on);
  try { localStorage.setItem('lt.caption', on ? '1' : ''); } catch {}
  $('transcript').scrollTop = $('transcript').scrollHeight;
};
$('btn-export').onclick = () => $('dlg-export').showModal();
$('btn-sessions').onclick = () => { renderSessionList(); $('dlg-sessions').showModal(); };
$('btn-new').onclick = () => {
  if (!current.lines.length && !current.title) { $('dlg-sessions').close(); return; }
  current = newSession();
  saveSessions();
  render();
  $('dlg-sessions').close();
  $('title').focus();
};
document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });
$('title').addEventListener('change', () => { current.title = $('title').value.trim(); saveSessions(); });
$('lang').addEventListener('change', () => { current.lang = $('lang').value; saveSessions(); });

setInterval(() => { if (runStart) $('clock').textContent = fmt(elapsed()); }, 500);
window.addEventListener('pagehide', () => { if (wantRec) stopRecording(); });

// ---- 要点リスト ----

let shownPoints = new Set();   // いま画面に出ている項目(新しく増えたものを目立たせる)

// live: 話している最中の更新。新しく増えた項目を光らせ、スマホ幅なら要点タブに印を出す
function renderSummary(live = false) {
  const box = $('summary');
  box.replaceChildren();
  const points = extractPoints(current.lines, fmt);
  const now = new Set();
  let added = 0;
  for (const [key, label] of SECTIONS) {
    const items = points[key];
    if (!items.length) continue;
    const h = document.createElement('h3');
    h.textContent = label;
    const ul = document.createElement('ul');
    for (const it of items) {
      const id = key + it.text;
      now.add(id);
      const li = document.createElement('li');
      li.textContent = it.text;
      if (live && !shownPoints.has(id)) { li.className = 'new'; added++; }
      if (it.at) {
        const b = document.createElement('button');
        b.className = 'at';
        b.textContent = it.at;
        b.title = 'この発言へ移動';
        b.onclick = () => jumpTo(it.at);
        li.appendChild(b);
      }
      ul.appendChild(li);
    }
    box.append(h, ul);
  }
  if (!now.size) {
    box.appendChild(hint(current.lines.length
      ? 'まだ拾える発言はありません。「〜しましょう」「〜までに」「〜ですか」などの言い回しや、★ 印を付けたところがここに並びます。'
      : '話し始めると、決まったこと・やること・質問などをここに拾っていきます。大事なところでは「★ 印」を押してください。'
        + '「音声文字変換」などで文字にしたものは、左上の ☰ →「取り込む」から入れられます。'));
  }
  shownPoints = now;
  $('btn-claude').disabled = !current.lines.length;
  if (added && !document.body.classList.contains('show-summary') && window.matchMedia('(max-width: 899px)').matches) {
    $('summary-badge').hidden = false;
    $('summary-badge').textContent = '新';
  }
}

function hint(text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  return p;
}

// 要点の経過時間から、その発言の行へ移動する
function jumpTo(at) {
  const [a, b, c] = at.split(':').map(Number);
  const ms = (c === undefined ? a * 60 + b : a * 3600 + b * 60 + c) * 1000;
  if (Number.isNaN(ms)) return;
  let idx = current.lines.findIndex((l) => l.t >= ms);
  if (idx < 0) idx = current.lines.length - 1;
  const el = $('transcript').querySelectorAll('.line')[idx];
  if (!el) return;
  showTab('text');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function showTab(which) {
  const summary = which === 'summary';
  document.body.classList.toggle('show-summary', summary);
  $('tab-summary').classList.toggle('active', summary);
  $('tab-text').classList.toggle('active', !summary);
  if (summary) $('summary-badge').hidden = true;
}
$('tab-text').onclick = () => showTab('text');
$('tab-summary').onclick = () => showTab('summary');

// Claude アプリに渡して詳しくまとめてもらう(Claude のプランの範囲で、追加料金なし)
$('btn-claude').onclick = () => $('dlg-claude').showModal();
$('btn-claude-share').onclick = async () => {
  const text = claudePrompt(current, fmt);
  try {
    if (!navigator.share) throw new Error('共有に対応していません');
    await navigator.share({ text });
    $('dlg-claude').close();
  } catch (err) {
    if (err.name === 'AbortError') return;
    showNotice('共有できなかったので「コピーして claude.ai を開く」をお使いください。');
  }
};
$('btn-claude-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(claudePrompt(current, fmt));
  } catch {
    showNotice('コピーできませんでした。');
    return;
  }
  $('dlg-claude').close();
  showNotice('コピーしました。開いた Claude の入力欄に貼り付けて送ってください。');
  window.open('https://claude.ai/new', '_blank', 'noopener');
};

// ---- 取り込み(「音声文字変換」などで文字にしたもの) ----

function importText(text, title = '') {
  const lines = parseTranscript(text);
  if (!lines.length) {
    showNotice('取り込める文字がありませんでした。');
    return false;
  }
  const d = new Date();
  const s = newSession();
  s.title = title.trim() || `取り込み ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  s.lines = lines;
  s.durationMs = Math.max(0, ...lines.map((l) => l.t ?? 0));
  s.imported = true;
  current = s;
  saveSessions();
  render();
  showNotice(`${lines.length} 行を取り込みました。大事な行は、左の時間(・)を押すと ★ が付き、要点リストの「印を付けたところ」に入ります。`);
  return true;
}

$('btn-import').onclick = () => {
  $('dlg-sessions').close();
  $('import-text').value = '';
  $('import-title').value = '';
  $('import-file').value = '';
  $('dlg-import').showModal();
};
$('import-file').addEventListener('change', async () => {
  const f = $('import-file').files[0];
  if (!f) return;
  $('import-text').value = await f.text();
  if (!$('import-title').value) $('import-title').value = f.name.replace(/\.[^.]+$/, '');
});
$('btn-import-paste').onclick = async () => {
  try { $('import-text').value = await navigator.clipboard.readText(); }
  catch { showNotice('貼り付けできませんでした。入力欄を長押しして「貼り付け」を選んでください。'); }
};
$('btn-import-go').onclick = () => {
  if (importText($('import-text').value, $('import-title').value)) $('dlg-import').close();
};

// ほかのアプリの「共有」からこのアプリを選んだとき(sw.js が受け取って控えておく)
async function takeShared() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('lt-share');
    const res = await cache.match('shared');
    await cache.delete('shared');
    if (!res) return;
    const { title, text } = await res.json();
    importText(text, title);
  } catch {
    showNotice('共有された文字を受け取れませんでした。コピーして「取り込む」に貼り付けてください。');
  }
}

// ---- 起動 ----

if (safeGet('lt.caption')) { document.body.classList.add('caption'); $('btn-caption').classList.add('active'); }
render();
if (!SR) {
  $('btn-rec').disabled = true;
  showNotice('このブラウザは音声認識に対応していません。iPad は Safari、Android は Chrome で開いてください。');
}
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
takeShared();
