// 要点リスト: Anthropic の API を偽物に差し替えて、送る中身と表示を確かめる
// 使い方: python3 -m http.server 8799 &  →  CHROME_PATH=... node tests/summary.test.js [画面写真の出力先]
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
};

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  await ctx.addInitScript(fakeSR);
  const requests = [];
  let reply = null; // 次に返す内容
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    requests.push({ headers: req.headers(), body: JSON.parse(req.postData()) });
    const r = reply;
    if (r.status) return route.fulfill({ status: r.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(r) }], usage: { input_tokens: 10, output_tokens: 10 } }) });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8799/');

  // キーが無いときの案内
  assert.match(await p.textContent('#summary'), /API キー/);
  assert.ok(await p.isDisabled('#btn-summarize'));

  // キーを入れる
  await p.click('#btn-settings');
  await p.fill('#api-key', 'sk-ant-test');
  await p.press('#api-key', 'Tab');
  await p.click('#dlg-settings [data-close]');
  assert.ok(!(await p.isDisabled('#btn-summarize')));

  await p.click('#btn-rec');
  await p.waitForTimeout(50);
  await p.evaluate(() => { __rec.say('今日は来月の本番の段取りを決めます'); __rec.say('リハーサルは14日の午後にしましょう'); });

  // 1回目
  reply = { points: [{ text: '来月の本番の段取りを相談', at: '00:00' }], decisions: [{ text: 'リハーサルは14日午後', at: '00:00' }], todos: [], questions: [] };
  await p.click('#btn-summarize');
  await p.waitForSelector('.summary li');
  let req = requests.at(-1);
  assert.equal(req.headers['x-api-key'], 'sk-ant-test');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  let content = req.body.messages[0].content;
  assert.equal(content.length, 2);
  assert.match(content[0].text, /\[00:00\] リハーサルは14日の午後にしましょう/);
  assert.deepEqual(content[0].cache_control, { type: 'ephemeral' });
  assert.equal(content[1].text, '要点リストを作ってください。');
  assert.deepEqual(await p.$$eval('.summary h3', (e) => e.map((x) => x.textContent)), ['要点', '決まったこと・指示']);
  const firstBlock = content[0].text;

  // 2回目: 前回までの部分は同じブロックのまま、新しい部分だけ別のブロックで送る
  await p.click('#btn-mark');
  await p.evaluate(() => __rec.say('衣装は黒で統一 譜面台は各自持参'));
  reply = { points: [{ text: '来月の本番の段取りを相談', at: '00:00' }], decisions: [{ text: 'リハーサルは14日午後', at: '00:00' }, { text: '衣装は黒で統一', at: '00:00' }],
            todos: [{ text: '譜面台を各自持参', at: '00:00' }], questions: [] };
  await p.click('#btn-summarize');
  await p.waitForFunction(() => document.querySelectorAll('.summary li').length === 4);
  content = requests.at(-1).body.messages[0].content;
  assert.equal(content.length, 3);
  assert.equal(content[0].text, firstBlock);
  assert.equal(content[0].cache_control, undefined);
  assert.match(content[1].text, /★ 印\n.*衣装は黒/);
  assert.deepEqual(content[1].cache_control, { type: 'ephemeral' });
  assert.match(content[2].text, /前回まとめた要点リスト/);
  assert.match(content[2].text, /リハーサルは14日午後/);
  // 新しく増えた項目だけ目立たせる
  assert.match(await p.textContent('#summary-status'), /に更新/);
  assert.deepEqual(await p.$$eval('.summary li.new', (e) => e.map((x) => x.firstChild.textContent)), ['衣装は黒で統一', '譜面台を各自持参']);
  await p.screenshot({ path: outDir + '/summary-ipad.png' });

  // 停止すると、新しい行があれば最後にもう一度まとめる
  await p.evaluate(() => __rec.say('開場は18時です'));
  const n = requests.length;
  reply = { ...reply, points: [...reply.points, { text: '開場は18時', at: '00:00' }] };
  await p.click('#btn-rec');
  await p.waitForFunction(() => [...document.querySelectorAll('.summary li')].some((li) => li.textContent.includes('開場')));
  assert.equal(requests.length, n + 1);

  // 書き出しに要点が入る
  await p.click('#btn-export');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btn-download')]);
  const txt = require('fs').readFileSync(await dl.path(), 'utf8');
  assert.match(txt, /■ 決まったこと・指示\n・リハーサルは14日午後 \[00:00\]/);
  assert.match(txt, /■ 文字起こし\n\[00:00\] 今日は来月/);
  await p.click('#dlg-export [data-close]');

  // キーの誤り
  await p.click('#btn-rec'); await p.waitForTimeout(50);
  await p.evaluate(() => __rec.say('アンコールはなし'));
  await p.click('#btn-rec');
  reply = { status: 401 };
  await p.click('#btn-summarize');
  await p.waitForFunction(() => document.querySelector('#summary-status').classList.contains('err'));
  assert.match(await p.textContent('#summary-status'), /API キーが正しくありません/);
  assert.equal(await p.$$eval('.summary li', (e) => e.length), 5, 'エラーでも前の要点は残す');

  // 再読み込みしても要点が残る
  await p.reload();
  assert.equal(await p.$$eval('.summary li', (e) => e.length), 5);

  // スマホ幅: タブで切り替え。要点の時間を押すと文字起こしへ移る
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(await p.isHidden('.pane-summary'));
  await p.click('#tab-summary');
  assert.ok(await p.isVisible('.pane-summary'));
  await p.screenshot({ path: outDir + '/summary-phone.png' });
  await p.click('.summary li .at');
  assert.ok(await p.isVisible('.pane-text'));
  assert.ok(await p.isHidden('.pane-summary'));

  // 別の記録に切り替えると要点も切り替わる
  await p.click('#btn-sessions'); await p.click('#btn-new');
  await p.click('#tab-summary');
  assert.equal(await p.$$eval('.summary li', (e) => e.length), 0);

  assert.deepEqual(errs, []);
  console.log('OK');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
