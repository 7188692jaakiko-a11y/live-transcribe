// ブラウザの音声認識を偽物に差し替えて、表示・保存・書き出しを確かめる
// 使い方: python3 -m http.server 8799 &  →  CHROME_PATH=... node tests/app.test.js [画面写真の出力先]
const { chromium } = require('playwright-core');
const outDir = process.argv[2] || require("os").tmpdir();
const assert = require('assert');
const fake = () => {
  class FakeSR {
    constructor() { window.__rec = this; window.__count = (window.__count||0)+1; this.results = []; }
    start() { setTimeout(() => this.onstart && this.onstart(), 0); }
    stop() { setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this.stop(); }
    emit(list, idx) { // list: [[text, isFinal]]
      const results = list.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f }));
      this.onresult({ resultIndex: idx ?? 0, results });
    }
  }
  window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const ctx = await b.newContext({ viewport: { width: 820, height: 1180 }, acceptDownloads: true });
  await ctx.addInitScript(fake);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8799/');
  await p.fill('#title', 'ピアノのレッスン'); await p.press('#title', 'Tab');
  await p.click('#btn-rec');
  await p.waitForTimeout(50);
  await p.evaluate(() => __rec.emit([['今日は', false]]));
  assert.equal(await p.textContent('#interim'), '今日は');
  await p.evaluate(() => __rec.emit([['今日はショパンから', true]]));
  await p.evaluate(() => __rec.emit([['今日はショパンから', true], ['左手を', false]], 1));
  await p.evaluate(() => __rec.emit([['今日はショパンから', true], ['左手をもう少し弱く', true]], 1));
  // Android の重複: 前を含む長い確定
  await p.evaluate(() => __rec.emit([['今日はショパンから', true], ['左手をもう少し弱く', true], ['左手をもう少し弱く 特に3小節目', true]], 2));
  let lines = await p.$$eval('.line .x', els => els.map(e => e.textContent));
  assert.deepEqual(lines, ['今日はショパンから', '左手をもう少し弱く 特に3小節目']);
  // 確定せずに終わる (iPad) → 途中の文字を残し、つなぎ直す
  await p.evaluate(() => __rec.emit([['ペダルは浅く', false]]));
  const before = await p.evaluate(() => __count);
  await p.evaluate(() => __rec.onend());
  await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => __count), before + 1, '自動でつなぎ直す');
  await p.click('#btn-mark');
  await p.evaluate(() => __rec.emit([['テンポは96で', true]]));
  lines = await p.$$eval('.line .x', els => els.map(e => e.textContent));
  assert.deepEqual(lines, ['今日はショパンから', '左手をもう少し弱く 特に3小節目', 'ペダルは浅く', '★ 印', 'テンポは96で']);
  await p.screenshot({ path: outDir + '/ipad.png' });
  await p.click('#btn-rec');
  // 直す
  await p.click('.line:nth-child(5) .x'); await p.keyboard.press('End'); await p.keyboard.type(' ここ大事'); await p.keyboard.press('Enter');
  // 再読み込みで残る
  await p.reload();
  lines = await p.$$eval('.line .x', els => els.map(e => e.textContent));
  assert.equal(lines[2], 'ペダルは浅く');
  assert.ok(lines.some(l => l.includes('ここ大事')), lines.join('|'));
  assert.equal(await p.inputValue('#title'), 'ピアノのレッスン');
  // 書き出し
  await p.click('#btn-export');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btn-download')]);
  const txt = require('fs').readFileSync(await dl.path(), 'utf8');
 
  assert.ok(txt.includes('[00:00] 今日はショパンから'));
  await p.click('#dlg-export [data-close]');
  await p.click('#btn-caption');
  await p.screenshot({ path: outDir + '/caption.png' });
  await p.click('#btn-caption');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: outDir + '/phone.png' });
  await p.click('#btn-sessions'); await p.click('#btn-new');
  assert.equal(await p.$$eval('.line', e => e.length), 0);
  await p.click('#btn-sessions');
  assert.equal(await p.$$eval('#session-list li', e => e.length), 2);
  await p.screenshot({ path: outDir + '/sessions.png' });
  await p.emulateMedia({ colorScheme: 'dark' });
  // 非対応ブラウザ
  const c2 = await b.newContext(); await c2.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; }); const p2 = await c2.newPage(); await p2.goto('http://localhost:8799/');
  assert.ok(await p2.isDisabled('#btn-rec'));
  console.log(await p2.textContent('#notice'));
  assert.deepEqual(errs, []);
  console.log('OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
