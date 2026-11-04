const { build } = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  await fs.mkdir('offline-dist/wasm', { recursive: true });
  await build({ entryPoints: ['offline-worker.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'offline-dist/worker.js' });
  const dir = 'node_modules/onnxruntime-web/dist';
  for (const name of await fs.readdir(dir)) if (/^ort-wasm-simd-threaded(?:\.jsep)?\.(mjs|wasm)$/.test(name)) await fs.copyFile(path.join(dir, name), path.join('offline-dist/wasm', name));
})().catch(e => { console.error(e); process.exitCode = 1; });
