import createQpdf from './vendor/qpdf/qpdf.mjs';
const wasmUrl=new URL('./vendor/qpdf/qpdf.wasm',import.meta.url).href;
self.onmessage=async ({data:{bytes,password,mode}})=>{
  const messages=[];
  try {
    const instance=await createQpdf({noInitialRun:true,locateFile:()=>wasmUrl,printErr:message=>messages.push(message)});
    instance.FS.writeFile('/input.pdf',new Uint8Array(bytes));
    if(mode==='protect') {
      const owner=Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,'0')).join('');
      instance.callMain(['--encrypt',password,owner,'256','--','/input.pdf','/output.pdf']);
    } else {
      instance.callMain(['--password='+password,'--decrypt','/input.pdf','/output.pdf']);
    }
    const result=instance.FS.readFile('/output.pdf');
    self.postMessage({result},[result.buffer]);
  } catch(error) {
    self.postMessage({error:/password/i.test(messages.join(' '))?'Пароль неверен.':'Не удалось обработать защиту этого PDF.'});
  }
};
