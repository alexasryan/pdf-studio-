import {open,renderPage,load,base} from './pdf.js';
const {PDFDocument,degrees}=window.PDFLib;
export const pageTools=new Set(['remove','extract','organize','rotate','split']);
export async function transformPages(file,state,selectedOnly=false) {
  const pages=state.items.filter(p=>!selectedOnly||p.selected);
  if(!pages.length) throw Error('Выберите хотя бы одну страницу.');
  const source=await load(file);
  if(pages.length===source.getPageCount()&&pages.every((p,i)=>p.index===i&&p.angle===0)) return file;
  const doc=await PDFDocument.create();
  if(source.getTitle())doc.setTitle(source.getTitle());
  if(source.getAuthor())doc.setAuthor(source.getAuthor());
  if(source.getSubject())doc.setSubject(source.getSubject());
  for(const item of pages) {
    const [page]=await doc.copyPages(source,[item.index]);
    page.setRotation(degrees((page.getRotation().angle+item.angle)%360));
    doc.addPage(page);
  }
  return new File([await doc.save({updateFieldAppearances:false})],file.name,{type:'application/pdf'});
}
export async function pageResult(file,state,kind) {
  if(kind==='split') {
    const zip=new window.JSZip(); let group=[],groups=[];
    for(const page of state.items) {group.push(page);if(page.breakAfter){groups.push(group);group=[];}}
    if(group.length) groups.push(group);
    if(!groups.length) throw Error('В документе должна остаться хотя бы одна страница.');
    for(const [i,items] of groups.entries()) zip.file('part-'+String(i+1).padStart(3,'0')+'.pdf',await transformPages(file,{items}));
    return {name:base(file)+'-split.zip',blob:await zip.generateAsync({type:'blob'})};
  }
  const result=await transformPages(file,state,kind==='extract');
  return {name:base(file)+'-'+kind+'.pdf',blob:result};
}
export async function createPages(file,kind,host,previous,onchange,onerror) {
  const source=await open(file);
  const state=previous||{items:Array.from({length:source.numPages},(_,index)=>({index,angle:0,selected:kind!=='extract',breakAfter:kind==='split'}))};
  let disposed=false, version=0, observer, previewVersion=0, previewPosition=0, zoom=1;
  const cache=new Map(), history=[];
  const toolbar=document.createElement('div'); toolbar.className='page-toolbar';
  const heading=document.createElement('h3');heading.textContent='Страницы · '+file.name;
  const info=document.createElement('p');info.className='hint';
  const grid=document.createElement('div');grid.className='page-grid';
  const preview=document.createElement('div');preview.className='page-preview';preview.hidden=true;
  const previewTitle=document.createElement('strong'),previewBody=document.createElement('div');
  const makeButton=(label,fn,parent=toolbar,title=label)=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);b.onclick=fn;parent.append(b);return b;};
  const select=(value)=>{state.items.forEach(p=>p.selected=value);render();};
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
  makeButton('К миниатюрам',()=>{preview.hidden=true;grid.hidden=false;previewVersion++;},previewNav);
  preview.append(previewNav,previewBody);
  host.replaceChildren(heading,info,toolbar,preview,grid);
  async function thumb(index) {
    if(!cache.has(index)) cache.set(index,(async()=>{const page=await source.getPage(index+1);const unit=page.getViewport({scale:1});const {canvas}=await renderPage(source,index,Math.min(1,180/Math.max(unit.width,unit.height)));const url=canvas.toDataURL();canvas.width=0;return url;})());
    return cache.get(index);
  }
  async function showPage(item) {
    if(!item)return;previewPosition=state.items.indexOf(item);const request=++previewVersion;preview.hidden=false;grid.hidden=true;previewTitle.textContent=(previewPosition+1)+' / '+state.items.length;previewBody.textContent='Загрузка…';
    try {const {canvas}=await renderPage(source,item.index,1.3*zoom);if(disposed||request!==previewVersion)return;canvas.style.transform='rotate('+item.angle+'deg)';canvas.style.width=(zoom*100)+'%';canvas.style.maxWidth='none';previewBody.replaceChildren(canvas);preview.scrollIntoView({block:'nearest',behavior:'smooth'});}catch(e){if(!disposed)onerror(e.message,true);}
  }
  function render() {
    const current=++version;observer?.disconnect();grid.replaceChildren();
    undo.disabled=!history.length;
    if(!preview.hidden)void showPage(state.items[Math.min(previewPosition,state.items.length-1)]);
    const selected=state.items.filter(p=>p.selected).length;
    info.textContent=state.items.length+' стр. · Выбрано: '+selected+'. Нажмите на миниатюру для просмотра. Корзина удаляет страницу; стрелки меняют порядок.'+(kind==='split'?' Кнопка «Разрез после» задаёт границы частей.':kind==='extract'?' В результат попадут только выбранные страницы.':['crop','watermark','jpg','png','ocr'].includes(kind)?' Инструмент применяется к выбранным страницам.':' Выбор используется для группового поворота и удаления.');
    observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const img=entry.target.querySelector('img');thumb(Number(entry.target.dataset.index)).then(url=>{if(!disposed&&current===version)img.src=url;}).catch(e=>{if(!disposed&&current===version)onerror(e.message,true);});}},{root:null,rootMargin:'250px'});
    state.items.forEach((item,position)=>{
      const card=document.createElement('article');card.className='page-card';card.dataset.index=item.index;
      const label=document.createElement('label');label.className='page-select';
      const check=document.createElement('input');check.type='checkbox';check.checked=item.selected;check.onchange=()=>{item.selected=check.checked;render();};
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
  return {state,showDocument:()=>showPage(state.items[Math.min(previewPosition,state.items.length-1)]),showGrid:()=>{preview.hidden=true;grid.hidden=false;previewVersion++;},dispose:async()=>{disposed=true;version++;previewVersion++;observer.disconnect();await source.loadingTask.destroy();}};
}
