const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => {
    class WorkerFake {
      postMessage(data) { setTimeout(() => { if (data.type === 'load') this.onmessage({ data: { type: 'ready' } }); else this.onmessage({ data: { type: 'result', id: data.id, text: '明日の練習を準備します。' } }); }, 5); }
      terminate() {}
    }
    window.Worker = WorkerFake;
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getAudioTracks: () => [{ label: 'fake', addEventListener() {} }], getTracks: () => [{ stop() {} }] }) } });
    window.AudioContext = class { constructor() { this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; } async resume() {} createMediaStreamSource() { return { connect(node) { return node; }, disconnect() {} }; } createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; } async close() { this.state = 'closed'; } };
    window.AudioWorkletNode = class { constructor() { window.testNode = this; this.port = { postMessage: () => this.port.onmessage({ data: { type: 'flushed' } }) }; } connect(node) { return node; } disconnect() {} };
  });
  const p = await context.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://localhost:8799/');
  await p.click('#btn-mic-test'); await p.waitForFunction(() => window.testNode);
  await p.evaluate(() => testNode.port.onmessage({data:{type:'level', db:-20, peak:0.4}}));
  assert.equal(await p.locator('#mic-meter').getAttribute('value'), '-20');
  assert.equal(await p.isDisabled('#btn-rec'), true); await p.click('#btn-mic-test');
  await p.selectOption('#engine', 'offline'); assert.equal(await p.isDisabled('#btn-rec'), true);
  await p.click('#btn-prepare'); await p.waitForFunction(() => !document.querySelector('#btn-rec').disabled);
  await p.click('#btn-rec'); await p.waitForFunction(() => window.testNode);
  await p.evaluate(() => testNode.port.onmessage({data:{type:'frame', audio:new Float32Array(128000).fill(.1)}}));
  await p.waitForFunction(() => document.querySelector('.line .x')?.textContent.includes('明日の練習'));
  await p.click('#btn-rec'); await p.waitForFunction(() => !document.querySelector('#btn-sessions').disabled);
  await p.click('#btn-notes');
  assert.ok((await p.locator('#note-details').textContent()).includes('やること'));
  await p.click('#btn-sessions');
  const note = {id:'old',title:'旧ノート',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',elapsed:12,segments:[{start:1,text:'前の記録'}],summary:'元の要約',decisions:[{id:'d',text:'決定'}],tasks:[{id:'t',text:'準備',done:true}]};
  await p.click('#btn-import');
  await p.locator('#import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({notes:[note]}))});
  await p.click('#btn-import-go');
  assert.equal(await p.inputValue('#title'), '旧ノート'); assert.equal(await p.inputValue('#note-details textarea'), '元の要約');
  assert.equal(await p.locator('#note-details input[type=checkbox]').first().isChecked(), true);
  await p.getByRole('button', {name:'やることを追加'}).click();
  const tasks = p.getByRole('textbox', {name:'やることを編集'}); await tasks.last().fill('新しい作業'); await tasks.last().blur();
  await p.click('#btn-export'); const [md] = await Promise.all([p.waitForEvent('download'), p.click('#btn-markdown')]);
  const markdown = require('node:fs').readFileSync(await md.path(), 'utf8'); assert.match(markdown, /- \[ \] 新しい作業/);
  await p.click('#dlg-export [data-close]');
  await p.locator('#note-details input[type=checkbox]').first().uncheck(); await p.reload();
  assert.equal(await p.locator('#note-details input[type=checkbox]').first().isChecked(), false);
  await p.click('#btn-sessions'); await p.fill('#session-search', '新しい作業'); assert.equal(await p.locator('#session-list li').count(), 1); await p.fill('#session-search', ''); const [download] = await Promise.all([p.waitForEvent('download'),p.click('#btn-backup')]);
  const backup = JSON.parse(require('node:fs').readFileSync(await download.path(), 'utf8'));
  assert.equal(backup.sessions.length, 2); assert.equal(backup.sessions[0].kotonoha.tasks[0].done, false); assert.equal(backup.sessions[0].kotonoha.tasks[1].text, '新しい作業');
  assert.deepEqual(errors, []); await browser.close(); console.log('統合テスト OK');
})().catch(e => { console.error(e); process.exit(1); });
