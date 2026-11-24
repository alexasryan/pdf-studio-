import {getProfile} from './device-profile.js';
// Keep CPU-heavy jobs off the UI thread and bound background rendering.
const workers=new Map();let nextJob=0;
export function workerTask(name,payload,transfer=[],progress) {
  if(typeof Worker==='undefined')return null;
  let pool=workers.get(name);
  if(!pool){
    const worker=new Worker(new URL(name,import.meta.url),{type:'module'});
    pool={worker,jobs:new Map(),timer:null};workers.set(name,pool);
    worker.onmessage=({data})=>{const job=pool.jobs.get(data.id);if(!job)return;if(data.progress){job.progress?.(data.progress);return;}pool.jobs.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.result);if(!pool.jobs.size)pool.timer=setTimeout(()=>{worker.terminate();workers.delete(name);},getProfile().workerIdle);};
    worker.onerror=()=>{for(const job of pool.jobs.values())job.reject(Error('Не удалось запустить обработчик PDF. Обновите страницу и повторите.'));pool.jobs.clear();clearTimeout(pool.timer);worker.terminate();workers.delete(name);};
  }
  clearTimeout(pool.timer);
  return new Promise((resolve,reject)=>{const id=++nextJob;pool.jobs.set(id,{resolve,reject,progress});try{pool.worker.postMessage({id,...payload},transfer);}catch(error){pool.jobs.delete(id);reject(error);}});
}
export function renderQueue(limit=2) {
  let active=0;const pending=[];
  const pump=()=>{while(active<limit&&pending.length){const {run,resolve,reject}=pending.shift();active++;Promise.resolve().then(run).then(resolve,reject).finally(()=>{active--;pump();});}};
  return run=>new Promise((resolve,reject)=>{pending.push({run,resolve,reject});pump();});
}
export const yieldToUI=()=>new Promise(resolve=>setTimeout(resolve,0));
