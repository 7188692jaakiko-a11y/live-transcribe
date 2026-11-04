// Optional network-dependent smoke test for the real offline model.
const {chromium}=require('playwright-core');
(async()=>{
  const b=await chromium.launch({executablePath:process.env.CHROME_PATH});
  try {
    const p=await b.newPage();
    await p.goto('http://localhost:8799/');
    const result=await p.evaluate(() => new Promise((resolve,reject) => {
      const worker=new Worker('./offline-dist/worker.js',{type:'module'});
      const timer=setTimeout(()=>reject(new Error('モデルの応答がタイムアウトしました')),180000);
      worker.onerror=e=>reject(new Error(e.message));
      worker.onmessage=({data})=>{
        if(data.type==='ready') { const audio=new Float32Array(16000); for(let i=0;i<audio.length;i++) audio[i]=0.01*Math.sin(2*Math.PI*440*i/16000); worker.postMessage({type:'transcribe',id:'smoke',audio}); }
        if(data.type==='result') {clearTimeout(timer); worker.terminate(); resolve(data.text);}
        if(data.type==='error') reject(new Error(data.message));
      };
      worker.postMessage({type:'load'});
    }));
    console.log('実モデルの読み込み・推論 OK',JSON.stringify(result));
  } finally {await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
