let paused=false, next=0;
const timers=new Map();
function schedule(timer){
  timer.started=performance.now();
  timer.native=window.setTimeout(()=>{ timers.delete(timer.id); timer.fn(); },timer.remaining);
}
export function delay(fn,ms){
  const timer={id:++next,fn,remaining:ms,native:null};
  timers.set(timer.id,timer); if(!paused) schedule(timer); return timer.id;
}
export function cancelDelay(id){ const t=timers.get(id); if(t){window.clearTimeout(t.native);timers.delete(id);} }
export function pauseTimers(value){
  if(paused===value)return;paused=value;
  for(const t of timers.values()){
    if(value){window.clearTimeout(t.native);if(t.native!==null)t.remaining=Math.max(0,t.remaining-(performance.now()-t.started));t.native=null;}
    else schedule(t);
  }
}
