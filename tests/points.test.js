// 要点リスト(端末の中で拾う)と、Claude アプリへの受け渡しを確かめる
// 使い方: python3 -m http.server 8799 &  →  CHROME_PATH=... node tests/points.test.js [画面写真の出力先]
const { chromium } = require('playwright-core');
const assert = require('assert');
const outDir = process.argv[2] || require('os').tmpdir();

const fakeSR = () => {
  class FakeSR {
    constructor() { window.__rec = this; this.results = []; }
    start() { setTimeout(() => this.onstart && this.onstart(), 0); }
    stop() { setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this.stop(); }
    say(text) {
      this.results.push(Object.assign([{ transcript: text }], { isFinal: true }));
      this.onresult({ resultIndex: this.results.length - 1, results: this.results });
    }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
  window.open = (url) => { window.__opened = url; };
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8799' });
  await ctx.addInitScript(fakeSR);
  // 料金のかかる通信が起きないこと
  const external = [];
  await ctx.route((url) => !url.href.startsWith('http://localhost:8799'), (route) => { external.push(route.request().url()); route.abort(); });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8799/');

  // 拾い方そのもの
  const pts = await p.evaluate(async () => {
    const { extractPoints } = await import('/points.js');
    const L = (text, t = 0, mark) => ({ t, text, ...(mark ? { mark: true } : {}) });
    return extractPoints([
      L('おはようございます 今日もよろしくお願いいたします'),
      L('リハーサルは14日の午後にしましょう', 5000),
      L('衣装はどうしますか', 9000),
      L('譜面台は各自持参でお願いします', 12000),
      L('左手をもう少し弱く弾いてください。テンポは96で。', 20000),
      L('来週までに3楽章をさらっておいてください', 30000),
      L('★ 印', 31000, true),
      L('ここの和音きれいですね', 40000),
      L('★ 印 ペダル浅め', 41000, true),
      L('開場は18時です', 50000),
    ], (ms) => `00:${String(ms / 1000).padStart(2, '0')}`);
  });
  const texts = (k) => pts[k].map((x) => x.text);
  assert.deepEqual(texts('decisions'), ['リハーサルは14日の午後にしましょう', '左手をもう少し弱く弾いてください。', 'テンポは96で。']);
  assert.deepEqual(texts('questions'), ['衣装はどうしますか']);
  assert.deepEqual(texts('todos'), ['譜面台は各自持参でお願いします', '来週までに3楽章をさらっておいてください']);
  assert.deepEqual(texts('marked'), ['来週までに3楽章をさらっておいてください', 'ここの和音きれいですね (ペダル浅め)']);
  assert.deepEqual(texts('facts'), ['開場は18時です']);
  assert.equal(pts.marked[1].at, '00:40', '印は直前の発言の時間');
  // あいさつは拾わない
  assert.ok(!Object.values(pts).flat().some((x) => x.text.includes('おはよう')));

  // 画面: 話すそばから並ぶ
  assert.match(await p.textContent('#summary'), /話し始めると/);
  assert.ok(await p.isDisabled('#btn-claude'));
  await p.fill('#title', '本番の打ち合わせ'); await p.press('#title', 'Tab');
  await p.click('#btn-rec');
  await p.waitForTimeout(50);
  await p.evaluate(() => { __rec.say('今日は来月の本番の段取りを決めます'); __rec.say('リハーサルは14日の午後にしましょう'); });
  assert.deepEqual(await p.$$eval('.summary li.new', (e) => e.map((x) => x.firstChild.textContent)), ['リハーサルは14日の午後にしましょう']);
  await p.evaluate(() => __rec.say('衣装はどうしますか'));
  // 新しく増えたものだけが光る
  assert.deepEqual(await p.$$eval('.summary li.new', (e) => e.map((x) => x.firstChild.textContent)), ['衣装はどうしますか']);
  await p.evaluate(() => __rec.say('譜面台は各自持参でお願いします'));
  await p.click('#btn-mark');
  await p.screenshot({ path: outDir + '/points-ipad.png' });
  assert.deepEqual(await p.$$eval('.summary h3', (e) => e.map((x) => x.textContent)), ['印を付けたところ', '決まったこと・指示', 'やること', '保留・質問', '日時・数字']);
  await p.click('#btn-rec');

  // 行を直すと要点も変わる
  await p.click('.line:nth-child(4) .x');
  await p.keyboard.press('Control+A'); await p.keyboard.type('衣装は黒で統一にします'); await p.keyboard.press('Enter');
  assert.ok((await p.textContent('.summary')).includes('衣装は黒で統一にします'));
  assert.ok(!(await p.textContent('.summary')).includes('どうしますか'));

  // Claude で詳しく: コピーして claude.ai を開く
  await p.click('#btn-claude');
  await p.click('#btn-claude-copy');
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /要点\n- 決まったこと・指示/);
  assert.match(clip, /記録: 本番の打ち合わせ/);
  assert.match(clip, /\[00:00\] 譜面台は各自持参でお願いします\n\[00:00\] ★ 印/);
  assert.equal(await p.evaluate(() => window.__opened), 'https://claude.ai/new');
  assert.match(await p.textContent('#notice'), /貼り付けて/);

  // 書き出しに要点が入る
  await p.click('#btn-export');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btn-download')]);
  const txt = require('fs').readFileSync(await dl.path(), 'utf8');
  assert.match(txt, /■ やること\n・譜面台は各自持参でお願いします \[00:00\]/);
  assert.match(txt, /■ 文字起こし\n\[00:00\] 今日は来月/);
  await p.click('#dlg-export [data-close]');

  // スマホ幅: 要点タブに「新」が出て、時間を押すと文字起こしへ移る
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('#btn-rec'); await p.waitForTimeout(50);
  await p.evaluate(() => __rec.say('開場は18時です'));
  await p.click('#btn-rec');
  assert.ok(await p.isVisible('#summary-badge'));
  await p.click('#tab-summary');
  assert.ok(await p.isHidden('#summary-badge'));
  await p.screenshot({ path: outDir + '/points-phone.png' });
  await p.click('.summary li .at');
  assert.ok(await p.isVisible('.pane-text'));

  assert.deepEqual(external, []);
  assert.deepEqual(errs, []);
  console.log('OK');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
