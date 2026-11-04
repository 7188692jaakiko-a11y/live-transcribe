export class AudioCapture {
  constructor(onAudio, onLevel, onEnded) { this.onAudio = onAudio; this.onLevel = onLevel; this.onEnded = onEnded; }
  async start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('このブラウザでは録音できません。HTTPS接続のChrome（Android）またはSafari（iPad）で開いてください。');
    try {
      this.frames = []; this.length = 0; this.offset = 0;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.context = new AudioContext();
      await this.context.resume();
      await this.context.audioWorklet.addModule(new URL('./audio-capture.js', import.meta.url));
      this.node = new AudioWorkletNode(this.context, 'note-capture');
      this.node.port.onmessage = ({ data }) => {
        if (data.type === 'frame') {
          this.frames.push(data.audio); this.length += data.audio.length;
          if(this.length >= 128000) this.emitAudio(false);
        }
        if (data.type === 'level') this.onLevel(data.db, data.peak);
        if (data.type === 'flushed') this.flushDone?.();
      };
      this.source = this.context.createMediaStreamSource(this.stream);
      this.mute = this.context.createGain(); this.mute.gain.value = 0;
      this.source.connect(this.node).connect(this.mute).connect(this.context.destination);
      this.stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => this.onEnded('マイクの接続が切れたため一時停止しました。')));
      this.context.onstatechange = () => { if (this.context?.state === 'interrupted' || this.context?.state === 'suspended') this.onEnded('録音が中断されたため一時停止しました。'); };
      return this.stream.getAudioTracks()[0]?.label || 'マイク';
    } catch (e) {
      await this.stop(false);
      if (e.name === 'NotAllowedError') throw new Error('マイクが許可されていません。ブラウザのサイト設定でマイクを許可してください。');
      if (e.name === 'NotFoundError') throw new Error('マイクが見つかりません。接続と端末の設定を確認してください。');
      throw e;
    }
  }
  emitAudio(final) {
    if (!this.length) return;
    const audio = new Float32Array(this.length); let cursor = 0;
    for(const frame of this.frames) { audio.set(frame, cursor); cursor += frame.length; }
    const overlap = final ? 0 : Math.min(8000, audio.length);
    const keep = audio.slice(audio.length - overlap);
    // Do not re-transcribe an overlap-only tail on stopping.
    if(!final || this.offset === 0 || audio.length > 8000) this.onAudio(audio, this.offset / 16000);
    this.offset += this.length - overlap; this.frames = overlap ? [keep] : []; this.length = overlap;
  }
  async stop(flush = true) {
    const context = this.context;
    if (context) context.onstatechange = null;
    if (flush && this.node && context?.state !== 'closed') await new Promise(resolve => { this.flushDone = resolve; this.node.port.postMessage('flush'); setTimeout(resolve, 500); });
    if (flush) this.emitAudio(true);
    this.source?.disconnect(); this.node?.disconnect(); this.mute?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.context = null; this.node = null; this.source = null; this.stream = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
