import {ensureScript} from './assets.js';
import {yieldToUI} from './performance.js';
const textExtensions=/\.(txt|csv|md|html?)$/i;
export function sourceKind(file) {
  if(/\.docx$/i.test(file.name))return 'docx';
  if(/\.(jpe?g|png|webp)$/i.test(file.name)||/^image\/(jpeg|png|webp)$/.test(file.type))return 'image';
  if(textExtensions.test(file.name))return 'text';
  return null;
}
export function decodeText(bytes) {let text=new TextDecoder().decode(bytes);if(text.includes('\ufffd'))text=new TextDecoder('windows-1251').decode(bytes);return text.replace(/^\ufeff/,'');}
export function parseCsv(text) {
  const counts=new Map([[';',0],[',',0],['\t',0]]);let inQuotes=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='\"'){if(inQuotes&&text[i+1]==='\"')i++;else inQuotes=!inQuotes;}else if(!inQuotes){if(c==='\n'||c==='\r')break;if(counts.has(c))counts.set(c,counts.get(c)+1);}}
  const delimiter=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter&&!quoted){row.push(value);value='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(value.length||row.length){row.push(value);rows.push(row);}return rows;
}
const baseStyles=`
[hidden]{display:none!important}html{color-scheme:light;background:#e5e9ef}body{margin:0;padding:16px;background:#e5e9ef;color:#111;font:12pt/1.5 Arial,sans-serif}
*{box-sizing:border-box}.import-page{width:210mm;min-height:297mm;padding:20mm;background:white;color:#111;margin:0 auto 18px;position:relative;box-shadow:0 2px 8px #0002;overflow:hidden}
.import-page article{overflow-wrap:break-word}.import-page p{margin:0 0 9pt}.import-page h1{font-size:24pt;line-height:1.2}.import-page h2{font-size:18pt;line-height:1.3}.import-page h3{font-size:14pt}.import-page pre{white-space:pre-wrap;overflow-wrap:anywhere;font:10.5pt/1.5 monospace}
.import-page table{border-collapse:collapse;width:100%;table-layout:auto;font-size:10pt}.import-page td,.import-page th{border:1px solid #9ba4b2;padding:6px;overflow-wrap:anywhere}.import-page th{background:#e8edf4;text-align:left}
.import-page img{max-width:100%;height:auto}.docx-wrapper{padding:0!important;background:transparent!important}.docx-wrapper>section.docx{margin:0 auto 18px!important;box-shadow:0 2px 8px #0002!important}.docx-wrapper>section.docx article{overflow-wrap:break-word}
@media print{html,body{margin:0!important;padding:0!important;background:white!important}section.import-page,section.docx{margin:0!important;box-shadow:none!important;break-after:page;page-break-after:always}section:last-child{break-after:auto} [data-source-hidden]{display:block!important}section.docx[data-source-hidden]{display:flex!important}}
`;
function safeAssets(doc) {
  for(const el of doc.querySelectorAll('[href]'))el.removeAttribute('href');
  for(const el of doc.querySelectorAll('[src]'))if(!/^(data:image\/|blob:)/i.test(el.getAttribute('src')||'')){el.removeAttribute('src');el.setAttribute('alt','Внешнее изображение недоступно');}
  const clean=css=>css.replace(/@import\s[^;]+;?/gi,'').replace(/url\(\s*([^)]*)\)/gi,(all,url)=>/^(data:|blob:)/i.test(url.trim().replace(/^['"]|['"]$/g,''))?all:'url("")');
  for(const style of doc.querySelectorAll('style'))style.textContent=clean(style.textContent);
  for(const el of doc.querySelectorAll('[style]'))el.setAttribute('style',clean(el.getAttribute('style')));
}
function newFrame() {
  const frame=document.createElement('iframe');frame.className='source-document-frame';frame.title='Предпросмотр исходного документа';
  frame.style.width='1000px';frame.style.height='1200px';
  frame.setAttribute('sandbox','allow-same-origin allow-modals');frame.setAttribute('referrerpolicy','no-referrer');
  return frame;
}
function setupFrame(frame) {
  const doc=frame.contentDocument;
  doc.open();doc.write('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; font-src data: blob:; style-src \'unsafe-inline\'"><title>Документ</title></head><body></body></html>');doc.close();
  const style=doc.createElement('style');style.textContent=baseStyles;doc.head.append(style);return doc;
}
function cssPixels(value,fallback=0){const match=String(value||'').trim().match(/^([\d.]+)(px|pt|mm|cm|in)?$/);if(!match)return fallback;return Number(match[1])*({px:1,pt:96/72,mm:96/25.4,cm:96/2.54,in:96}[match[2]||'px']);}
export function pageGeometry(page) {
  const css=page.ownerDocument.defaultView.getComputedStyle(page);
  const width=cssPixels(page.style.width,cssPixels(css.width,794));
  const height=cssPixels(page.style.minHeight||page.style.height,cssPixels(css.minHeight,1123))||1123;
  const paddingTop=cssPixels(css.paddingTop),paddingBottom=cssPixels(css.paddingBottom);
  return {width,height,paddingTop,paddingBottom};
}
function pageShell(doc,template=null) {
  if(template){const page=template.cloneNode(false);for(const child of template.children)if(child.tagName==='HEADER')page.append(child.cloneNode(true));return page;}
  const page=doc.createElement('section');page.className='import-page';page.style.width='210mm';page.style.minHeight='297mm';return page;
}
function textSplit(block,limit,pageTop) {
  const doc=block.ownerDocument,walker=doc.createTreeWalker(block,4);const nodes=[];let node,total=0;
  while(node=walker.nextNode()){nodes.push({node,start:total});total+=node.length;}
  if(total<2)return null;
  const at=index=>{for(let i=nodes.length-1;i>=0;i--)if(index>=nodes[i].start)return {node:nodes[i].node,offset:index-nodes[i].start};return {node:block,offset:0};};
  const full=block.textContent;let low=1,high=total-1,best=0;
  // Range rects use the browser's actual line wrapping and preserve nested run styles.
  while(low<=high){const mid=Math.floor((low+high)/2),point=at(mid),range=doc.createRange();range.setStart(block,0);range.setEnd(point.node,point.offset);const rects=[...range.getClientRects()];const bottom=rects.reduce((n,r)=>Math.max(n,r.bottom-pageTop),0);if(bottom<=limit){best=mid;low=mid+1;}else high=mid-1;}
  if(!best)return null;
  const space=full.lastIndexOf(' ',best);if(space>best*.65)best=space+1;
  const point=at(best),prefix=doc.createRange(),suffix=doc.createRange();prefix.setStart(block,0);prefix.setEnd(point.node,point.offset);suffix.setStart(point.node,point.offset);suffix.setEnd(block,block.childNodes.length);
  const a=prefix.cloneContents(),b=suffix.cloneContents(),next=block.cloneNode(false);next.append(b);block.replaceChildren(a);return next;
}
function splitTable(table,limit,pageTop) {
  const rows=[...table.querySelectorAll(':scope > tbody > tr,:scope > tr')];
  const index=rows.findIndex(row=>row.getBoundingClientRect().bottom-pageTop>limit+.5);
  if(index<=0)return null;
  const next=table.cloneNode(false);for(const child of table.children)if(['COLGROUP','THEAD'].includes(child.tagName))next.append(child.cloneNode(true));
  const body=table.ownerDocument.createElement('tbody');for(const row of rows.slice(index))body.append(row);next.append(body);return next;
}
export async function paginateFlow(root) {
  const originals=[...root.querySelectorAll('section.docx,section.import-page')];
  for(const original of originals) {
    const {height,paddingBottom}=pageGeometry(original),limit=height-paddingBottom;
    const articles=[...original.children].filter(el=>el.tagName==='ARTICLE');
    if(!articles.length)continue;
    const footer=[...original.children].filter(el=>['FOOTER','OL'].includes(el.tagName));
    for(const el of footer)el.remove();
    let page=original,article=null,pageTop=page.getBoundingClientRect().top,hasContent=false;
    const advance=template=>{for(const el of footer)page.append(el.cloneNode(true));const next=pageShell(root.ownerDocument,original);page.after(next);page=next;pageTop=page.getBoundingClientRect().top;article=template.cloneNode(false);page.append(article);hasContent=false;};
    for(const source of articles){const children=[...source.childNodes];source.replaceChildren();article=source;
      if(page!==original){article=source.cloneNode(false);page.append(article);source.remove();}
      for(const block of children) {
        if(block.nodeType!==1){article.append(block);continue;}
        article.append(block);
        let guard=0;
        while(block.getBoundingClientRect().bottom-pageTop>limit+.5&&guard++<200) {
          let continuation=null;
          if(block.tagName==='TABLE')continuation=splitTable(block,limit,pageTop);
          else if(/^(P|DIV|PRE|H[1-6])$/.test(block.tagName)&&typeof root.ownerDocument.createRange().getClientRects==='function')continuation=textSplit(block,limit,pageTop);
          if(continuation){const template=article;advance(template);article.append(continuation);let next=continuation;while(next.getBoundingClientRect().bottom-pageTop>limit+.5&&guard++<200){const rest=next.tagName==='TABLE'?splitTable(next,limit,pageTop):textSplit(next,limit,pageTop);if(!rest)break;advance(template);article.append(rest);next=rest;}break;}
          if(hasContent){const template=article;block.remove();advance(template);article.append(block);}
          break;
        }
        hasContent=true;
      }
    }
    for(const el of footer)page.append(el.cloneNode(true));
    await yieldToUI();
  }
  // Never silently crop an unusually tall unsplittable object: export it in slices.
  return [...root.querySelectorAll('section.docx,section.import-page')];
}
async function settleAssets(doc) {
  await doc.fonts?.ready;
  await Promise.all([...doc.images].map(image=>image.decode?image.decode().catch(()=>{}):Promise.resolve()));
}
async function renderText(file,doc,root) {
  const text=decodeText(await file.arrayBuffer());
  if(/\.csv$/i.test(file.name)) {
    const rows=parseCsv(text);if(!rows.length)throw Error('Файл CSV пуст.');
    for(let offset=1;offset<Math.max(2,rows.length);offset+=32){const page=pageShell(doc),article=doc.createElement('article'),table=doc.createElement('table'),head=doc.createElement('thead'),tr=doc.createElement('tr');for(const value of rows[0]){const th=doc.createElement('th');th.textContent=value;tr.append(th);}head.append(tr);table.append(head);const body=doc.createElement('tbody');for(const row of rows.slice(offset,offset+32)){const tr=doc.createElement('tr');for(const value of row){const td=doc.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}table.append(body);article.append(table);page.append(article);root.append(page);}return;
  }
  const page=pageShell(doc),article=doc.createElement('article');page.append(article);root.append(page);
  if(/\.(html?|md)$/i.test(file.name)) {
    await ensureScript('purify.min.js','DOMPurify');
    let html=text;
    if(/\.md$/i.test(file.name)){await ensureScript('marked.umd.js','marked');html=window.marked.parse(text,{async:false});}
    const clean=window.DOMPurify.sanitize(html,{WHOLE_DOCUMENT:true,ADD_TAGS:['style'],FORBID_TAGS:['script','iframe','object','embed','form','input','button','link','meta','base','video','audio'],FORBID_ATTR:['srcset','action','formaction'],ALLOW_DATA_ATTR:false});
    const parsed=new DOMParser().parseFromString(clean,'text/html');
    for(const style of parsed.head.querySelectorAll('style'))doc.head.append(doc.importNode(style,true));
    for(const child of [...parsed.body.childNodes])article.append(doc.importNode(child,true));safeAssets(doc);
  } else {const pre=doc.createElement('pre');pre.textContent=text;article.append(pre);}
}
export async function createSourcePreview(file,host,report=()=>{},isCurrent=()=>true) {
  const kind=sourceKind(file);if(!kind)throw Error('Для этого формата нет предпросмотра.');
  let disposed=false,frame=null,url=null,doc=null,pages=[],index=0,zoom=1;
  const controls=document.createElement('div');controls.className='viewer-controls';
  const caption=document.createElement('span');
  const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.onclick=fn;controls.append(b);return b;};
  const previous=button('←',()=>show(index-1));controls.append(caption);const next=button('→',()=>show(index+1));
  button('−',()=>{zoom=Math.max(.25,zoom-.25);fit();});button('+',()=>{zoom=Math.min(2,zoom+.25);fit();});
  const viewport=document.createElement('div');viewport.className='source-preview-viewport';
  const note=document.createElement('p');note.className='hint';
  host.replaceChildren(controls,note,viewport);
  let observer;
  function fit() {
    if(disposed)return;
    if(kind==='image'){const image=viewport.querySelector('img');if(image)image.style.maxWidth=(zoom*100)+'%';return;}
    if(!frame||!pages[index])return;
    const {width,height}=pageGeometry(pages[index]);
    const actualHeight=Math.max(height,pages[index].scrollHeight||0);
    frame.style.width=(width+32)+'px';frame.style.height=(actualHeight+32)+'px';
    const scale=Math.min(1,(viewport.clientWidth||width+32)/(width+32))*zoom;
    frame.style.transform='scale('+scale+')';viewport.style.height=((actualHeight+32)*scale)+'px';
  }
  function show(position) {
    index=Math.max(0,Math.min(pages.length-1,position));
    for(const [i,page] of pages.entries()){page.hidden=i!==index;page.toggleAttribute('data-source-hidden',i!==index);}
    caption.textContent=kind==='image'?'Изображение':(index+1)+' / '+pages.length;
    previous.disabled=kind==='image'||index===0;next.disabled=kind==='image'||index>=pages.length-1;fit();
  }
  const dispose=()=>{if(disposed)return;disposed=true;observer?.disconnect();if(url)URL.revokeObjectURL(url);frame?.remove();host.replaceChildren();};
  try {
    if(kind==='image') {
      const image=document.createElement('img');image.alt=file.name;url=URL.createObjectURL(file);image.src=url;image.className='source-image';viewport.append(image);await image.decode();if(!isCurrent()){dispose();return {file,dispose};}
      caption.textContent='Изображение';previous.disabled=next.disabled=true;note.textContent=image.naturalWidth+' × '+image.naturalHeight+' пикселей · '+file.name;
    } else {
      frame=newFrame();viewport.append(frame);doc=setupFrame(frame);const root=doc.createElement('main');doc.body.append(root);
      if(kind==='docx') {
        report('Загружаем оформление Word…');await ensureScript('jszip.min.js','JSZip');await ensureScript('docx-preview.min.js','docxPreview');
        if(!isCurrent()){dispose();return {file,dispose};}
        await window.docxPreview.renderAsync(await file.arrayBuffer(),root,doc.head,{className:'docx',inWrapper:true,ignoreWidth:false,ignoreHeight:false,ignoreFonts:false,breakPages:true,ignoreLastRenderedPageBreak:false,renderHeaders:true,renderFooters:true,renderFootnotes:true,renderEndnotes:true,renderAltChunks:false,useBase64URL:true,experimental:false});
        safeAssets(doc);note.textContent='Оформление Word: шрифты, таблицы, изображения и отступы. Недоступные шрифты заменяются браузером.';
      } else await renderText(file,doc,root);
      if(!isCurrent()){dispose();return {file,dispose};}
      await settleAssets(doc);pages=await paginateFlow(root);if(!pages.length)throw Error('В документе нет страниц для просмотра.');
      if(kind==='text')note.textContent='Предпросмотр '+file.name;
      const printStyles=doc.createElement('style');
      printStyles.textContent=pages.map((page,i)=>{const size=pageGeometry(page);page.style.setProperty('page','source-page-'+i);return '@page source-page-'+i+'{size:'+(size.width*.75)+'pt '+(size.height*.75)+'pt;margin:0}';}).join('\n');doc.head.append(printStyles);
      const print=button('Печать / PDF с текстом',()=>{if(disposed)return;for(const page of pages)page.hidden=false;frame.contentWindow.focus();frame.contentWindow.print();show(index);});print.title='Открыть системное окно печати для сохранения PDF с текстом';
      show(0);
    }
    if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(fit);observer.observe(viewport);}
    return {file,kind,dispose,toPdf:async(settings={},progress=report)=>{
      if(disposed||!doc||!pages.length)throw Error('Сначала откройте документ для просмотра.');
      await ensureScript('html2canvas.min.js','html2canvas');
      const pdf=await window.PDFLib.PDFDocument.create();
      try {
        for(const [pageIndex,page] of pages.entries()) {
          show(pageIndex);await settleAssets(doc);await yieldToUI();
          const {width,height}=pageGeometry(page),actualHeight=Math.max(height,page.scrollHeight||0),scale=Number(settings.documentDpi||150)/96;
          if(!Number.isFinite(scale)||scale<.75||scale>3.125)throw Error('Выберите качество от 72 до 300 dpi.');
          const slices=Math.max(1,Math.ceil((actualHeight-.5)/height));
          for(let slice=0;slice<slices;slice++) {
            progress('Сохраняем оформление: страница '+(pageIndex+1)+' / '+pages.length+(slices>1?' · часть '+(slice+1):''));
            if(Math.ceil(width*scale)*Math.ceil(height*scale)>40000000)throw Error('Страница слишком велика. Выберите меньшее качество экспорта.');
            const canvas=await window.html2canvas(page,{scale,backgroundColor:'#ffffff',useCORS:false,allowTaint:false,logging:false,width,height,x:0,y:slice*height,windowWidth:Math.ceil(width+32),windowHeight:Math.ceil(height+32),scrollX:0,scrollY:0,onclone:clone=>{for(const page of clone.querySelectorAll('section.docx,section.import-page'))page.style.boxShadow='none';}});
            try {const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Не удалось сохранить страницу.')),'image/png'));const image=await pdf.embedPng(await blob.arrayBuffer());pdf.addPage([width*.75,height*.75]).drawImage(image,{x:0,y:0,width:width*.75,height:height*.75});}finally{canvas.width=0;}
          }
        }
        return {name:file.name.replace(/\.[^.]+$/,'')+'.pdf',blob:new Blob([await pdf.save({objectsPerTick:30})],{type:'application/pdf'})};
      } finally{if(!disposed)show(0);}
    }};
  }catch(error){dispose();throw error;}
}
export async function convertFormatted(file,settings,report,existing=null) {
  if(existing?.file===file&&existing.toPdf)return existing.toPdf(settings,report);
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:1000px;';document.body.append(host);
  let preview;try{preview=await createSourcePreview(file,host,report);return await preview.toPdf(settings,report);}finally{preview?.dispose();host.remove();}
}
