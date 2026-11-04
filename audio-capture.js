// Continuous downsampling. Small frames reach the main thread before the page can be suspended.
class NoteCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.sum=0;this.count=0;this.next=sampleRate/16000;this.position=0;this.frame=[];this.levelCount=0;
    this.port.onmessage=e=>{if(e.data==='flush'){this.send();this.port.postMessage({type:'flushed'});}};
  }
  send(){if(!this.frame.length)return;const audio=Float32Array.from(this.frame);this.frame=[];this.port.postMessage({type:'frame',audio},[audio.buffer]);}
  process(inputs){
    const channels=inputs[0];if(!channels?.length||!channels[0]?.length)return true;
    let power=0,peak=0;
    for(let i=0;i<channels[0].length;i++){
      let v=0;for(const channel of channels)v+=channel[i]/channels.length;
      power+=v*v;peak=Math.max(peak,Math.abs(v));this.sum+=v;this.count++;this.position++;
      if(this.position>=this.next){this.frame.push(this.sum/this.count);this.sum=0;this.count=0;this.next+=sampleRate/16000;}
    }
    if(++this.levelCount>=30){this.port.postMessage({type:'level',db:20*Math.log10(Math.max(Math.sqrt(power/channels[0].length),0.000001)),peak});this.levelCount=0;}
    if(this.frame.length>=4000)this.send();
    return true;
  }
}
registerProcessor('note-capture',NoteCapture);
