import {workerTask,renderQueue} from './performance.js';
import {adjustCanvas} from './image-adjustments.js';
import {ensureScript,acquire,open,renderPage,load,base,asBlob,canvasOf} from './pdf.js';
const {PDFDocument,degrees}=window.PDFLib;
export const pageTools=new Set(['remove','extract','organize','rotate','split']);
export async function transformPages(file,state,selectedOnly=false,existingSource=null) {
  const pages=state.items.filter(p=>!selectedOnly||p.selected);
  if(!pages.length) throw Error('Выберите хотя бы одну страницу.');
  if(state.originalCount===pages.length&&pages.every((p,i)=>p.index===i&&p.angle===0))return file;
  if(typeof Worker!=='undefined'&&!existingSource){const bytes=await file.arrayBuffer();const blob=await workerTask('pdf-operations-worker.js',{kind:'transform',bytes,items:pages},[bytes]);return new File([blob],file.name,{type:'application/pdf'});}
  const source=existingSource||await load(file);
  if(pages.length===source.getPageCount()&&pages.every((p,i)=>p.index===i&&p.angle===0)) return file;
  const doc=await PDFDocument.create();
  if(source.getTitle())doc.setTitle(source.getTitle());
  if(source.getAuthor())doc.setAuthor(source.getAuthor());
  if(source.getSubject())doc.setSubject(source.getSubject());
  const unique=[...new Set(pages.map(p=>p.index))];
  const copies=new Map((await doc.copyPages(source,unique)).map((page,i)=>[unique[i],page]));
  const used=new Set();
  for(const item of pages) {
    const page=used.has(item.index)?(await doc.copyPages(source,[item.index]))[0]:copies.get(item.index);used.add(item.index);
    page.setRotation(degrees((page.getRotation().angle+item.angle)%360));
    doc.addPage(page);
  }
  return new File([await doc.save({updateFieldAppearances:false})],file.name,{type:'application/pdf'});
}
export async function pageResult(file,state,kind) {
  if(kind==='split') {
    let group=[],groups=[];
    for(const page of state.items) {group.push(page);if(page.breakAfter){groups.push(group);group=[];}}
    if(group.length) groups.push(group);
    if(!groups.length) throw Error('В документе должна остаться хотя бы одна страница.');
    if(typeof Worker!=='undefined'){const bytes=await file.arrayBuffer();return {name:base(file)+'-split.zip',blob:await workerTask('pdf-operations-worker.js',{kind:'split',bytes,groups},[bytes])};}
    if(!window.JSZip)await ensureScript('jszip.min.js','JSZip');
    const zip=new window.JSZip(), source=await load(file);
    for(const [i,items] of groups.entries()) zip.file('part-'+String(i+1).padStart(3,'0')+'.pdf',await transformPages(file,{items},false,source));
    return {name:base(file)+'-split.zip',blob:await zip.generateAsync({type:'blob'})};
  }
  const result=await transformPages(file,state,kind==='extract');
  return {name:base(file)+'-'+kind+'.pdf',blob:result};
}
export async function createPages(file,kind,host,previous,onchange,onerror,getAdjustments=()=>null) {
  const lease=await acquire(file);
  const source=lease.doc;
  const state=previous||{items:Array.from({length:source.numPages},(_,index)=>({index,angle:0,selected:kind!=='extract',breakAfter:kind==='split'}))};
  state.originalCount=source.numPages;
  let disposed=false, version=0, observer, previewVersion=0, previewPosition=0, zoom=1;
  const cache=new Map(), history=[], rawPreviews=new Map();
  const thumbnailQueue=renderQueue(2);
  let gridPage=0,pendingPreview=null,previewRunning=false;
  const pageSize=48;
  const toolbar=document.createElement('div'); toolbar.className='page-toolbar';
  const heading=document.createElement('h3');heading.textContent='Страницы · '+file.name;
  const info=document.createElement('p');info.className='hint';
  const grid=document.createElement('div');grid.className='page-grid';
  const preview=document.createElement('div');preview.className='page-preview';preview.hidden=true;
  const previewTitle=document.createElement('strong'),previewBody=document.createElement('div');
  const makeButton=(label,fn,parent=toolbar,title=label)=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);b.onclick=fn;parent.append(b);return b;};
  const selectionChanged=()=>{info.textContent=info.textContent.replace(/Выбрано: \d+/,'Выбрано: '+state.items.filter(p=>p.selected).length);for(const card of grid.children)card.querySelector('input').checked=state.items[Number(card.dataset.position)].selected;onchange(state);};
  const select=(value)=>{state.items.forEach(p=>p.selected=value);selectionChanged();};
  makeButton('Выбрать все',()=>select(true));makeButton('Снять выбор',()=>select(false));
  const save=()=>{history.push(structuredClone(state.items));if(history.length>30)history.shift();};
  const mutate=fn=>{save();fn();render();};
  makeButton('↻ Повернуть выбранные',()=>mutate(()=>state.items.filter(p=>p.selected).forEach(p=>p.angle=(p.angle+90)%360)));
  makeButton('🗑 Удалить выбранные',()=>{const keep=state.items.filter(p=>!p.selected);if(!keep.length){onerror('В документе должна остаться хотя бы одна страница.',true);return;}mutate(()=>{state.items=keep;});});
  const undo=makeButton('Отменить',()=>{if(history.length){state.items=history.pop();render();}});
  if(kind==='split') {
    makeButton('Каждая страница отдельно',()=>mutate(()=>state.items.forEach(p=>p.breakAfter=true)));
    makeButton('Одна часть',()=>mutate(()=>state.items.forEach(p=>p.breakAfter=false)));
  }
  const previewNav=document.createElement('div');previewNav.className='viewer-controls';
  makeButton('←',()=>void showPage(state.items[Math.max(0,previewPosition-1)]),previewNav,'Предыдущая страница');
  previewNav.append(previewTitle);
  makeButton('→',()=>void showPage(state.items[Math.min(state.items.length-1,previewPosition+1)]),previewNav,'Следующая страница');
  makeButton('−',()=>{zoom=Math.max(.5,zoom-.25);void showPage(state.items[previewPosition]);},previewNav,'Уменьшить масштаб');
  makeButton('+',()=>{zoom=Math.min(2,zoom+.25);void showPage(state.items[previewPosition]);},previewNav,'Увеличить масштаб');
  makeButton('К миниатюрам',()=>{preview.hidden=true;grid.hidden=false;previewVersion++;pendingPreview=null;pagination.hidden=state.items.length<=pageSize;},previewNav);
  preview.append(previewNav,previewBody);
  host.replaceChildren(heading,info,toolbar,preview,grid);
  async function thumb(index) {
    if(!cache.has(index)) {
      const task=thumbnailQueue(async()=>{
        if(disposed)return null;
        const page=await source.getPage(index+1),unit=page.getViewport({scale:1});
        const {canvas}=await renderPage(source,index,Math.min(1,180/Math.max(unit.width,unit.height)));
        try {const blob=await asBlob(canvas,'image/jpeg',.78);if(disposed)return null;return URL.createObjectURL(blob);}finally{canvas.width=0;}
      });
      cache.set(index,task);
      task.catch(()=>{if(cache.get(index)===task)cache.delete(index);});
      while(cache.size>64){const key=cache.keys().next().value;const old=cache.get(key);cache.delete(key);old.then(url=>{if(url)URL.revokeObjectURL(url);}).catch(()=>{});}
    }
    return cache.get(index);
  }
  async function showPage(item) {
    if(!item||disposed)return;
    previewPosition=state.items.indexOf(item);
    const request=++previewVersion;
    pendingPreview={item,request,scale:1.3*zoom,width:zoom*100};
    preview.hidden=false;grid.hidden=true;pagination.hidden=true;
    previewTitle.textContent=(previewPosition+1)+' / '+state.items.length;
    if(previewRunning)return;
    previewRunning=true;
    try {
      while(pendingPreview&&!disposed){
        const job=pendingPreview;pendingPreview=null;
        const key=job.item.index+':'+job.scale;
        let raw=rawPreviews.get(key);
        if(!raw){raw=(await renderPage(source,job.item.index,job.scale)).canvas;if(disposed){raw.width=0;break;}rawPreviews.set(key,raw);while(rawPreviews.size>2){const oldest=rawPreviews.keys().next().value;rawPreviews.get(oldest).width=0;rawPreviews.delete(oldest);}}
        if(disposed||job.request!==previewVersion)continue;
        const canvas=canvasOf(raw.width,raw.height);canvas.getContext('2d').drawImage(raw,0,0);
        try{
          await adjustCanvas(canvas,getAdjustments());
          if(disposed||job.request!==previewVersion){canvas.width=0;continue;}
          canvas.style.transform='rotate('+job.item.angle+'deg)';canvas.style.width=job.width+'%';canvas.style.maxWidth='none';
          for(const previous of previewBody.querySelectorAll('canvas'))previous.width=0;
          previewBody.replaceChildren(canvas);
        }catch(error){canvas.width=0;throw error;}
      }
    }catch(error){if(!disposed)onerror(error.message,true);}finally{previewRunning=false;}
  }
  const pagination=document.createElement('div');pagination.className='page-pagination viewer-controls';
  const before=makeButton('← Предыдущие',()=>{gridPage--;render();},pagination);
  const pageCounter=document.createElement('span');pagination.append(pageCounter);
  const after=makeButton('Следующие →',()=>{gridPage++;render();},pagination);
  host.append(pagination);
  function render() {
    const current=++version;observer?.disconnect();grid.replaceChildren();
    undo.disabled=!history.length;
    if(!preview.hidden)void showPage(state.items[Math.min(previewPosition,state.items.length-1)]);
    const selected=state.items.filter(p=>p.selected).length;
    info.textContent=state.items.length+' стр. · Выбрано: '+selected+'. Нажмите на миниатюру для просмотра. Корзина удаляет страницу; стрелки меняют порядок.'+(kind==='split'?' Кнопка «Разрез после» задаёт границы частей.':kind==='extract'?' В результат попадут только выбранные страницы.':['crop','watermark','jpg','png','ocr','color'].includes(kind)?' Инструмент применяется к выбранным страницам.':' Выбор используется для группового поворота и удаления.');
    observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const img=entry.target.querySelector('img');thumb(Number(entry.target.dataset.index)).then(url=>{if(url&&!disposed&&current===version)img.src=url;}).catch(e=>{if(!disposed&&current===version)onerror(e.message,true);});}},{root:null,rootMargin:'250px'});
    gridPage=Math.max(0,Math.min(gridPage,Math.ceil(state.items.length/pageSize)-1));
    const first=gridPage*pageSize;
    before.disabled=gridPage===0;after.disabled=first+pageSize>=state.items.length;pagination.hidden=!preview.hidden||state.items.length<=pageSize;
    pageCounter.textContent=(first+1)+'–'+Math.min(first+pageSize,state.items.length)+' из '+state.items.length;
    state.items.slice(first,first+pageSize).forEach((item,localPosition)=>{
      const position=first+localPosition;
      const card=document.createElement('article');card.className='page-card';card.dataset.index=item.index;card.dataset.position=position;
      const label=document.createElement('label');label.className='page-select';
      const check=document.createElement('input');check.type='checkbox';check.checked=item.selected;check.onchange=()=>{item.selected=check.checked;selectionChanged();};
      label.append(check,document.createTextNode('Стр. '+(item.index+1)+(item.angle?' · '+item.angle+'°':'')));
      const pic=makeButton('',()=>void showPage(item),card,'Открыть страницу '+(item.index+1));pic.className='page-thumb';const img=document.createElement('img');img.alt='Предпросмотр страницы '+(item.index+1);img.style.transform='rotate('+item.angle+'deg)';pic.append(img);
      card.prepend(label);
      const actions=document.createElement('div');actions.className='page-actions';
      for(const [step,text] of [[-1,'←'],[1,'→']]){const b=makeButton(text,()=>mutate(()=>{const target=position+step;[state.items[position],state.items[target]]=[state.items[target],state.items[position]];}),actions,(step<0?'Переместить назад':'Переместить вперёд')+' страницу '+(item.index+1));b.disabled=position+step<0||position+step>=state.items.length;}
      makeButton('↻',()=>mutate(()=>{item.angle=(item.angle+90)%360;}),actions,'Повернуть страницу '+(item.index+1));
      makeButton('⧉',()=>mutate(()=>state.items.splice(position+1,0,{...item})),actions,'Дублировать страницу '+(item.index+1));
      makeButton('🗑',()=>{if(state.items.length===1){onerror('Нельзя удалить последнюю страницу.',true);return;}mutate(()=>state.items.splice(position,1));},actions,'Удалить страницу '+(item.index+1));
      card.append(actions);
      if(kind==='split'){const b=makeButton(item.breakAfter?'✂ Разрез после ✓':'Разрез после',()=>mutate(()=>{item.breakAfter=!item.breakAfter;}),card);b.setAttribute('aria-pressed',String(item.breakAfter));}
      grid.append(card);observer.observe(card);
    });
    onchange(state);
  }
  render();
  return {state,refreshPreview:()=>{if(!preview.hidden)void showPage(state.items[previewPosition]);},showDocument:()=>showPage(state.items[Math.min(previewPosition,state.items.length-1)]),showGrid:()=>{preview.hidden=true;grid.hidden=false;previewVersion++;pendingPreview=null;pagination.hidden=state.items.length<=pageSize;},dispose:async()=>{disposed=true;version++;previewVersion++;observer.disconnect();pendingPreview=null;lease.release();for(const promise of cache.values())promise.then(url=>{if(url)URL.revokeObjectURL(url);}).catch(()=>{});cache.clear();for(const canvas of rawPreviews.values())canvas.width=0;rawPreviews.clear();for(const canvas of previewBody.querySelectorAll('canvas'))canvas.width=0;}};
}
