export function chooseProfile(env={},choice='auto') {
  if(!['auto','lite','full'].includes(choice))choice='auto';
  const cores=Number(env.hardwareConcurrency)||0,memory=Number(env.deviceMemory)||0;
  const low=choice==='lite'||choice==='auto'&&(env.saveData||env.reducedMotion||cores>0&&cores<=4||memory>0&&memory<=4||!cores&&!memory);
  return Object.freeze({low,pageSize:low?16:48,thumbnailConcurrency:low?1:2,thumbnailSide:low?120:180,thumbnailCache:low?24:64,previewScale:low?.85:1.3,previewMaxSide:low?1280:4500,previewCache:low?1:2,previewDebounce:low?320:160,workerIdle:low?10000:30000,documentIdle:low?150:800});
}
export function getProfile() {
  if(typeof document!=='undefined'&&['lite','full'].includes(document.documentElement.dataset.performance))return chooseProfile({},document.documentElement.dataset.performance);
  const n=typeof navigator==='undefined'?{}:navigator;
  let choice='auto';try{choice=localStorage.getItem('pdf-studio-performance')||'auto';}catch{}
  return chooseProfile({hardwareConcurrency:n.hardwareConcurrency,deviceMemory:n.deviceMemory,saveData:n.connection?.saveData,reducedMotion:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches},choice);
}
export function initPerformanceControl() {
  const select=document.getElementById('performance-mode');if(!select)return;
  try{select.value=localStorage.getItem('pdf-studio-performance')||'auto';}catch{}
  if(!select.value)select.value='auto';
  const updateLabel=()=>{select.title=(getProfile().low?'Активен быстрый режим. ':'Активен полный режим. ')+'Качество сохраняемого файла выбирается отдельно в инструменте.';};updateLabel();
  select.addEventListener('change',()=>{try{localStorage.setItem('pdf-studio-performance',select.value);}catch{}const n=navigator;document.documentElement.dataset.performance=chooseProfile({hardwareConcurrency:n.hardwareConcurrency,deviceMemory:n.deviceMemory,saveData:n.connection?.saveData,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches},select.value).low?'lite':'full';updateLabel();location.reload();});
}
