import {resizeDocument} from './resize.js';
import './vendor/pdf-lib.min.js';
import './vendor/jszip.min.js';
const {PDFDocument,degrees}=self.PDFLib;
async function copy(source,items) {
  const result=await PDFDocument.create();
  if(source.getTitle())result.setTitle(source.getTitle());
  if(source.getAuthor())result.setAuthor(source.getAuthor());
  if(source.getSubject())result.setSubject(source.getSubject());
  const unique=[...new Set(items.map(p=>p.index))];
  const templates=new Map((await result.copyPages(source,unique)).map((page,i)=>[unique[i],page]));
  const used=new Set();
  for(const item of items){const page=used.has(item.index)?(await result.copyPages(source,[item.index]))[0]:templates.get(item.index);used.add(item.index);page.setRotation(degrees((page.getRotation().angle+item.angle)%360));result.addPage(page);}
  return result.save({updateFieldAppearances:false,objectsPerTick:30});
}
async function process(data) {
  if(data.kind==='merge'){
    const result=await PDFDocument.create();
    for(const [i,bytes] of data.files.entries()){self.postMessage({id:data.id,progress:'Объединяем файл '+(i+1)+' / '+data.files.length});const doc=await PDFDocument.load(bytes instanceof Blob?await bytes.arrayBuffer():bytes,{updateMetadata:false});for(const page of await result.copyPages(doc,doc.getPageIndices()))result.addPage(page);}
    return new Blob([await result.save({objectsPerTick:30})],{type:'application/pdf'});
  }
  const source=await PDFDocument.load(data.bytes,{updateMetadata:false});
  if(data.kind==='resize')return new Blob([await resizeDocument(source,data.settings,self.PDFLib,message=>self.postMessage({id:data.id,progress:message}))],{type:'application/pdf'});
  if(data.kind==='split'){
    const zip=new self.JSZip();
    for(const [i,items] of data.groups.entries()){self.postMessage({id:data.id,progress:'Часть '+(i+1)+' / '+data.groups.length});zip.file('part-'+String(i+1).padStart(3,'0')+'.pdf',await copy(source,items));}
    return zip.generateAsync({type:'blob',streamFiles:true});
  }
  return new Blob([await copy(source,data.items)],{type:'application/pdf'});
}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{try{self.postMessage({id:data.id,result:await process(data)});}catch(error){self.postMessage({id:data.id,error:error.message});}});};
