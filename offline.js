import { AudioCapture } from './offline-audio.js';

// Keep unprocessed audio in memory until recognition succeeds; never silently drop it.
export class OfflineRecognition {
  constructor({ onText, onStatus, onInterrupt, Capture = AudioCapture, makeWorker = () => new Worker(new URL('./offline-dist/worker.js', import.meta.url), { type: 'module' }) }) {
    Object.assign(this, { onText, onStatus, onInterrupt, Capture, makeWorker });
    this.queue = []; this.ready = false; this.processing = false; this.loading = null; this.stopping = false;
  }
  prepare() {
    if (this.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.onStatus('端末内認識を準備中です。初回はモデルの取得に時間がかかります。');
    this.worker = this.makeWorker();
    this.loading = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'progress' && data.progress?.status === 'progress') this.onStatus('音声モデルを取得中です。画面を開いたままお待ちください。');
      if (data.type === 'ready') { this.ready = true; this.loading = null; this.resolve?.(); this.onStatus('端末内認識の準備ができました。'); this.pump(); }
      if (data.type === 'result') {
        const job = this.queue[0]; if (!job || job.id !== data.id) return;
        this.onText(data.text, job.start, job.overlap); this.queue.shift(); this.processing = false; this.pump();
      }
      if (data.type === 'error') this.fail(data.message);
    };
    this.worker.onerror = e => this.fail(e.message || '音声認識を続けられませんでした。');
    this.worker.postMessage({ type: 'load' });
    return this.loading;
  }
  fail(message) {
    this.reject?.(new Error(message)); this.loading = null; this.ready = false; this.processing = false;
    this.worker?.terminate(); this.worker = null;
    this.onInterrupt(`端末内認識が止まりました。${this.queue.length ? '未処理の音声はこの画面に保持しています。「準備する」で再試行してください。' : ''} ${message}`);
  }
  async start(offsetMs) {
    if (!this.ready) throw new Error('先に「準備する」を押してください。');
    this.offset = offsetMs;
    this.capture = new this.Capture((audio, start) => {
      this.queue.push({ id: crypto.randomUUID(), audio, start: this.offset + start * 1000, overlap: start > 0 });
      this.pump();
      if (this.queue.length >= 8 && !this.stopping) this.onInterrupt('処理が追いつかないため一時停止します。処理が終わったら再開してください。');
    }, () => {}, message => this.onInterrupt(message));
    await this.capture.start();
  }
  async stop() {
    if (!this.capture || this.stopping) return;
    this.stopping = true;
    try { await this.capture.stop(true); } finally { this.capture = null; this.stopping = false; }
  }
  pump() {
    if (!this.ready || this.processing) return;
    if (!this.queue.length) { this.onStatus('端末内の音声処理が完了しました。'); return; }
    this.processing = true;
    const job = this.queue[0];
    this.onStatus(`端末内で音声を処理中（残り${this.queue.length}件）。`);
    this.worker.postMessage({ type: 'transcribe', id: job.id, audio: job.audio.slice() });
  }
}
