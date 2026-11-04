import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
env.allowRemoteModels = true; // Static model files only; inference never sends audio.
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('./wasm/', self.location.href).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let recognizer;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      recognizer ||= await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { device: 'wasm', dtype: 'q8', progress_callback: p => self.postMessage({ type: 'progress', progress: p }) });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'transcribe') {
      if (!recognizer) throw new Error('音声認識モデルが準備できていません。');
      let sum = 0; for (const x of data.audio) sum += x * x;
      // Avoid hallucinations from near silence. Never amplify background noise.
      if (Math.sqrt(sum / Math.max(data.audio.length, 1)) < 0.002) { self.postMessage({ type: 'result', id: data.id, text: '' }); return; }
      const result = await recognizer(data.audio, { language: 'japanese', task: 'transcribe', return_timestamps: false, chunk_length_s: 30, temperature: 0, max_new_tokens: 160 });
      self.postMessage({ type: 'result', id: data.id, text: result.text.trim() });
    }
  } catch (error) { self.postMessage({ type: 'error', action: data.type, message: error?.message || String(error) }); }
};
