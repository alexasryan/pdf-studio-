const vendor=new URL('./vendor/',import.meta.url).href;
const loads=new Map();
export function ensureScript(name,globalName) {
  if(window[globalName])return Promise.resolve();
  if(!loads.has(name))loads.set(name,new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=vendor+name;script.onload=()=>window[globalName]?resolve():reject(Error('Компонент не загрузился. Обновите страницу.'));script.onerror=()=>{script.remove();loads.delete(name);reject(Error('Не удалось загрузить компонент. Проверьте подключение.'));};document.head.append(script);}));
  return loads.get(name);
}
