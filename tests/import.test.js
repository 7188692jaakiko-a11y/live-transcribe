// 取り込み: 「音声文字変換」などの文字を、貼り付け・ファイル・共有から記録にする
// 使い方: python3 -m http.server 8799 &  →  CHROME_PATH=... node tests/import.test.js [画面写真の出力先]
const { chromium } = require('playwright-core');
const assert = require('assert');
const outDir = process.argv[2] || require('os').tmpdir();

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8799' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8799/');

  // 読み分け
  const parse = (text) => p.evaluate(async (t) => (await import('/import.js')).parseTranscript(t), text);
  // 時刻なし・句点なし(音声文字変換によくある形)
  assert.deepEqual(await parse('おはようございます\n\nリハーサルは14日の午後にしましょう\n衣装はどうしますか'),
    [{ t: null, text: 'おはようございます' }, { t: null, text: 'リハーサルは14日の午後にしましょう' }, { t: null, text: '衣装はどうしますか' }]);
  // 句点で分ける
  assert.deepEqual((await parse('左手を弱く。テンポは96で。')).map((l) => l.text), ['左手を弱く。', 'テンポは96で。']);
  // 時刻だけの行のあとに本文(最初を 00:00 にする)、午後の時刻
  assert.deepEqual(await parse('午後3:20\n始めます\n午後3:22\n2幕から'),
    [{ t: 0, text: '始めます' }, { t: 120000, text: '2幕から' }]);
  // 行頭の [分:秒]
  // [分:秒] は録音の頭からの経過時間なので、ずらさない(Mac の文字起こしの形)
  assert.deepEqual(await parse('[00:05] はい\n[01:10] 次\n[1:02:03] 終わり'),
    [{ t: 5000, text: 'はい' }, { t: 70000, text: '次' }, { t: 3723000, text: '終わり' }]);
  // 「12:30に集合」は時刻の見出しではなく本文
  assert.deepEqual(await parse('12:30に集合'), [{ t: null, text: '12:30に集合' }]);
  // 句点も無い長い一続きは、空白で区切る
  const long = Array.from({ length: 12 }, (_, i) => `これは${i}番目の話でけっこう長い`).join(' ');
  const parts = await parse(long);
  assert.ok(parts.length > 1 && parts.every((l) => l.text.length <= 120), JSON.stringify(parts));
  // このアプリの書き出しを取り込み直すと、要点の部分を飛ばす
  assert.deepEqual((await parse('稽古\n2026/10/12\n\n■ やること\n・譜面台\n\n■ 文字起こし\n[00:00] 譜面台は持参で')).map((l) => l.text), ['譜面台は持参で']);

  // 貼り付けて取り込む
  await p.evaluate(() => navigator.clipboard.writeText('今日は2幕の通しです\nリハーサルは14日の午後にしましょう\n衣装はどうしますか\nここの和音きれいですね\n来週までに3場をさらっておいてください'));
  await p.click('#btn-sessions');
  await p.click('#btn-import');
  await p.fill('#import-title', '10/12 稽古');
  await p.click('#btn-import-paste');
  await p.waitForFunction(() => document.querySelector('#import-text').value !== '');
  assert.match(await p.inputValue('#import-text'), /2幕の通し/);
  await p.screenshot({ path: outDir + '/import-dialog.png' });
  await p.click('#btn-import-go');
  assert.equal(await p.inputValue('#title'), '10/12 稽古');
  assert.equal(await p.$$eval('.line', (e) => e.length), 5);
  assert.match(await p.textContent('#notice'), /5 行を取り込みました/);
  // 時刻なしの行は「・」。押すと ★ が付き、印として拾われる
  assert.equal(await p.textContent('.line:nth-child(5) .t'), '・');
  await p.click('.line:nth-child(5) .t');
  assert.equal(await p.textContent('.line:nth-child(5) .x'), '★ ここの和音きれいですね');
  await p.click('#tab-summary');
  const sec = await p.$$eval('.summary h3', (e) => e.map((x) => x.textContent));
  assert.deepEqual(sec, ['印を付けたところ', '決まったこと・指示', 'やること', '保留・質問']);
  assert.equal(await p.$$eval('.summary .at', (e) => e.length), 0, '時刻が無いので時間のボタンは出さない');
  await p.screenshot({ path: outDir + '/import-points.png' });
  // もう一度押すと外れる
  await p.click('#tab-text');
  await p.click('.line:nth-child(5) .t');
  assert.equal(await p.textContent('.line:nth-child(5) .x'), 'ここの和音きれいですね');

  // 書き出しでは時刻なしの行に [00:00] を付けない
  await p.click('#btn-export');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btn-download')]);
  const txt = require('fs').readFileSync(await dl.path(), 'utf8');
  assert.match(txt, /■ 文字起こし\n今日は2幕の通しです\n/);
  await p.click('#dlg-export [data-close]');

  // ファイルから
  await p.click('#btn-sessions');
  await p.click('#btn-import');
  await p.setInputFiles('#import-file', { name: '稽古メモ.txt', mimeType: 'text/plain', buffer: Buffer.from('[00:00] 始めます\n[02:30] テンポは96で') });
  await p.waitForFunction(() => document.querySelector('#import-text').value.includes('テンポ'));
  assert.equal(await p.inputValue('#import-title'), '稽古メモ');
  await p.click('#btn-import-go');
  assert.deepEqual(await p.$$eval('.line .t', (e) => e.map((x) => x.textContent)), ['00:00', '02:30']);

  // 共有から(sw.js が受け取り、画面で取り込む)
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  const status = await p.evaluate(async () => {
    const fd = new FormData();
    fd.append('title', '音声文字変換');
    fd.append('text', '譜面台は各自持参でお願いします');
    const r = await fetch('./share-target', { method: 'POST', body: fd, redirect: 'manual' });
    return r.type;
  });
  assert.equal(status, 'opaqueredirect');
  await p.goto('http://localhost:8799/?shared=1');
  await p.waitForFunction(() => document.querySelector('#title').value === '音声文字変換');
  assert.equal(await p.textContent('.line .x'), '譜面台は各自持参でお願いします');
  assert.equal(new URL(p.url()).search, '', '取り込んだら ?shared を消す(再読み込みで二重にしない)');
  await p.reload();
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('lt.sessions.v1')).filter((s) => s.title === '音声文字変換').length), 1);

  assert.deepEqual(errs, []);
  console.log('OK');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
