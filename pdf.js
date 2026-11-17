import * as pdfjs from './vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const {PDFDocument, PDFName, degrees, StandardFonts, rgb} = window.PDFLib;
const vendor = new URL('./vendor/', import.meta.url).href;
const read = file => file.arrayBuffer();
const canvasOf = (w,h) => Object.assign(document.createElement('canvas'), {width:Math.ceil(w), height:Math.ceil(h)});
const base = file => file.name.replace(/\.[^.]+$/, '');
const output = (name, bytes, type='application/pdf') => ({name, blob:new Blob([bytes], {type})});
const load = async file => PDFDocument.load(await read(file), {updateMetadata:false});
const open = async file => pdfjs.getDocument({
  data:await read(file), cMapUrl:vendor+'cmaps/', cMapPacked:true, standardFontDataUrl:vendor+'standard_fonts/',
  wasmUrl:vendor+'wasm/', iccUrl:vendor+'iccs/', isEvalSupported:false,
}).promise;

function pageList(value, count, required=false, unique=true) {
  value = value.trim();
  if (!value) {
    if (required) throw Error('Укажите номера страниц.');
    return Array.from({length:count}, (_,i)=>i);
  }
  const result = [];
  for (const part of value.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if (!match) throw Error('Укажите страницы в формате 1, 3–5.');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first<1 || last>count || first>last) throw Error('Допустимые номера страниц: от 1 до '+count+'.');
    for (let index=first-1;index<last;index++) result.push(index);
  }
  return unique ? [...new Set(result)] : result;
}
const fromPages = async (source, list) => {
  if (!list.length) throw Error('В документе должна остаться хотя бы одна страница.');
  const result = await PDFDocument.create();
  for (const page of await result.copyPages(source,list)) result.addPage(page);
  return result.save();
};

async function renderPage(doc,index,scale=1.5) {
  const page=await doc.getPage(index+1);
  const unit=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:Math.min(scale, 4500/Math.max(unit.width,unit.height))});
  const canvas=canvasOf(viewport.width,viewport.height);
  await page.render({canvas,viewport}).promise;
  return {canvas,viewport,unit};
}
const asBlob = (canvas,type,quality) => new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Не удалось обработать изображение.')),type,quality));

async function rasterPdf(source, indexes, scale, quality, report, paint) {
  const pdf = await PDFDocument.create();
  for (const [i,index] of indexes.entries()) {
    report('Страница '+(i+1)+' из '+indexes.length);
    const {canvas,unit} = await renderPage(source,index,scale);
    paint?.(index,canvas);
    const jpg = await pdf.embedJpg(await (await asBlob(canvas,'image/jpeg',quality)).arrayBuffer());
    pdf.addPage([unit.width,unit.height]).drawImage(jpg,{x:0,y:0,width:unit.width,height:unit.height});
    canvas.width=0;
  }
  return pdf.save();
}
async function extractText(source,report) {
  const result=[];
  for(let i=1;i<=source.numPages;i++) {
    report('Извлечение текста: '+i+' / '+source.numPages);
    const data=await (await source.getPage(i)).getTextContent();
    let page='', baseline;
    for(const item of data.items) {
      if(typeof item.str!=='string') continue;
      const y=item.transform[5];
      if(page && !page.endsWith('\n')) page+=Math.abs(y-baseline)>4?'\n':' ';
      page+=item.str+(item.hasEOL?'\n':'');
      baseline=y;
    }
    result.push(page.trim());
  }
  if(!result.some(Boolean)) throw Error('Текстовый слой отсутствует. Откройте инструмент «Распознать текст».');
  return result;
}
async function toWord(pages) {
  const {Document,Packer,Paragraph}=window.docx;
  const children=pages.flatMap((page,index)=>page.split('\n').map((text,line)=>new Paragraph({
    text,pageBreakBefore:index>0&&line===0,
  })));
  return Packer.toBlob(new Document({sections:[{children}]}));
}
async function imageBitmap(file) {
  try {return await createImageBitmap(file);}
  catch {throw Error('Не удалось прочитать изображение '+file.name+'.');}
}
async function imagesPdf(files) {
  const pdf=await PDFDocument.create();
  for (const file of files) {
    const bitmap=await imageBitmap(file);
    try {
      const scale=Math.min(1,3200/Math.max(bitmap.width,bitmap.height));
      const canvas=canvasOf(bitmap.width*scale,bitmap.height*scale);
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      const type=/jpe?g$/i.test(file.name)?'image/jpeg':'image/png';
      const bytes=await (await asBlob(canvas,type,.94)).arrayBuffer();
      const image=type==='image/jpeg'?await pdf.embedJpg(bytes):await pdf.embedPng(bytes);
      const ratio=Math.min(595/image.width,842/image.height);
      const width=image.width*ratio, height=image.height*ratio;
      pdf.addPage([width,height]).drawImage(image,{x:0,y:0,width,height});
    } finally {bitmap.close();}
  }
  return pdf.save();
}
async function readText(file) {
  const bytes=await read(file);
  if(/\.docx$/i.test(file.name)) return (await window.mammoth.extractRawText({arrayBuffer:bytes})).value;
  let text=new TextDecoder().decode(bytes);
  if(text.includes('\ufffd')) text=new TextDecoder('windows-1251').decode(bytes);
  if(!/\.html?$/i.test(file.name)) return text;
  const template=document.createElement('template');
  template.innerHTML=text.replace(/<\/(p|div|li|tr|h[1-6])>|<br\s*\/?>/gi,'$&\n');
  for(const node of template.content.querySelectorAll('style,script,noscript,template')) node.remove();
  return template.content.textContent;
}
async function textPdf(text) {
  if(!text.trim()) throw Error('Во входном файле нет текста.');
  const pdf=await PDFDocument.create();
  const font=await embedTextFont(pdf);
  const known=new Set(font.getCharacterSet());
    const size=11, width=505;
  let page=pdf.addPage([595,842]), y=795;
  const advance=()=>{
    y-=17;
    if(y<47) {page=pdf.addPage([595,842]);y=795;}
  };
  for(const logicalLine of text.split(/\r?\n/)) {
    let line=[], lineWidth=0, breakpoint=0;
    const flush=(count)=>{
      let x=45;
      const segments=line.splice(0,count);
      const joined=[];
      for(const segment of segments) {
        const previous=joined.at(-1);
        if(previous?.font===segment.font) {previous.text+=segment.text;previous.width+=segment.width;}
        else joined.push({...segment});
      }
      for(const segment of joined) {
        page.drawText(segment.text,{font:segment.font,size,x,y});
        x+=segment.width;
      }
      advance();
      lineWidth=line.reduce((sum,part)=>sum+part.width,0);
      breakpoint=0;
    };
    for(let character of logicalLine.replaceAll('\t','    ')) {
      if(/[\u0000-\u001f]/.test(character)) continue;
      if(!known.has(character.codePointAt(0))) character="?";
      const charWidth=font.widthOfTextAtSize(character,size);
      if(lineWidth+charWidth>width) flush(breakpoint||line.length);
      line.push({text:character,font,width:charWidth});
      lineWidth+=charWidth;
      if(character===' ') breakpoint=line.length;
    }
    flush(line.length);
  }
  return pdf.save();
}
function stamp(text,size,color='#202531') {
  const canvas=canvasOf(1,1);
  const measure=canvas.getContext('2d');
  measure.font=(size*3)+'px Arial';
  canvas.width=Math.ceil(measure.measureText(text).width+12);
  canvas.height=Math.ceil(size*4.5);
  const ctx=canvas.getContext('2d');
  ctx.font=(size*3)+'px Arial';
  ctx.fillStyle=color;
  ctx.textBaseline='middle';
  ctx.fillText(text,6,canvas.height/2);
  return canvas;
}
async function ocr(source,file,settings,report) {
  if(!window.Tesseract) await new Promise((resolve,reject)=>{
    const script=Object.assign(document.createElement('script'),{src:vendor+'tesseract.min.js',onload:resolve,onerror:reject});
    document.head.append(script);
  });
  const worker=await window.Tesseract.createWorker(settings.lang,1,{
    workerPath:vendor+'worker.min.js',corePath:vendor+'ocr/tesseract-core-lstm.wasm.js',langPath:vendor+'languages/',
    logger:message=>report(message.status==='recognizing text'?'Распознавание: '+Math.round(message.progress*100)+'%':'Подготовка распознавания…'),
  });
  try {
    if(!source) return (await worker.recognize(file)).data.text;
    const chunks=[];
    for(const index of pageList(settings.pages,source.numPages)) {
      const {canvas}=await renderPage(source,index,2);
      chunks.push((await worker.recognize(canvas)).data.text.trim());
      canvas.width=0;
    }
    return chunks.join('\n\n');
  } finally {await worker.terminate();}
}
const photoZip = async (source,settings,id,report) => {
  const indexes=pageList(settings.pages,source.numPages);
  const mime=id==='png'?'image/png':'image/jpeg';
  const zip=new window.JSZip();
  for (const [position,index] of indexes.entries()) {
    report('Экспорт: '+(position+1)+' / '+indexes.length);
    const {canvas}=await renderPage(source,index,Number(settings.scale));
    const blob=await asBlob(canvas,mime,.92);
    canvas.width=0;
    if(indexes.length===1) return {blob,extension:id};
    zip.file('page-'+String(index+1).padStart(3,'0')+'.'+id,blob);
  }
  return {blob:await zip.generateAsync({type:'blob'}),extension:'zip'};
};
function formData(doc) {
  const form=doc.getForm();
  return form.getFields().flatMap(field=>{
    const name=field.getName();
    if(field.isReadOnly()) return [];
    if(field instanceof window.PDFLib.PDFTextField) return [{name,kind:'text',value:field.getText()||'',apply:value=>field.setText(value||undefined)}];
    if(field instanceof window.PDFLib.PDFCheckBox) return [{name,kind:'checkbox',value:field.isChecked(),apply:value=>value?field.check():field.uncheck()}];
    if(field instanceof window.PDFLib.PDFDropdown || field instanceof window.PDFLib.PDFOptionList || field instanceof window.PDFLib.PDFRadioGroup) {
      const value=field.getSelected();
      return [{name,kind:'select',options:field.getOptions(),multiple:Array.isArray(value)&&(field.isMultiselect?.()||false),
        value,apply:choice=>choice?.length?field.select(choice):field.clear()}];
    }
    return [];
  });
}
async function applyForm(doc,fields) {
  const form=doc.getForm();
  let changed=false;
  for(const field of fields) {
    if(!field.input) continue;
    const value=field.kind==='checkbox'?field.input.checked:field.multiple?[...field.input.selectedOptions].map(option=>option.value):field.input.value;
    if(JSON.stringify(value)===JSON.stringify(field.initial)) continue;
    field.apply(value);
    changed=true;
  }
  if(changed) form.updateFieldAppearances(await embedTextFont(doc));
  return doc.save({updateFieldAppearances:false});
}
async function embedTextFont(doc) {
  doc.registerFontkit(window.fontkit);
  const response=await fetch(vendor+'dejavu-sans.ttf');
  if(!response.ok) throw Error('Не удалось загрузить шрифт.');
  return doc.embedFont(await response.arrayBuffer(),{subset:true});
}
async function protect(file,password,mode) {
  if(mode==='protect'&&!password) throw Error('Введите пароль для открытия PDF.');
  if(new TextEncoder().encode(password).length>127) throw Error('Этот пароль слишком длинный для PDF.');
  const bytes=await read(file);
  const worker=new Worker(new URL('./security-worker.js',import.meta.url),{type:'module'});
  try {
    return await new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);
      worker.onerror=()=>reject(Error('Не удалось загрузить компонент защиты PDF.'));
      worker.postMessage({bytes,password,mode},[bytes]);
    });
  } finally {worker.terminate();}
}
async function operate(id,files,s,report,visualData,prepared) {
  const file=files[0], name=base(file);
  if(id==='protect'||id==='unlock') return output(name+(id==='protect'?'-protected.pdf':'-unlocked.pdf'),await protect(file,s.password,id));
  if(id==='images') return output(name+'-images.pdf',await imagesPdf(files));
  if(id==='docx'||id==='textpdf') return output(name+'.pdf',await textPdf(await readText(file)));
  if(id==='merge') {
    const result=await PDFDocument.create();
    for (const entry of files) {
      const doc=await load(entry);
      for (const page of await result.copyPages(doc,doc.getPageIndices())) result.addPage(page);
    }
    return output(name+'-merged.pdf',await result.save());
  }
  if(id==='redact'||id==='edit'||id==='sign') return visualData.export(id,report);
  if(['jpg','png','text','word','ocr','compress'].includes(id)&&!(id==='compress'&&s.quality==='lossless')) {
    const source=id==='ocr'&&!/\.pdf$/i.test(file.name)?null:await open(file);
    try {
      if(id==='ocr') {
        const recognized=await ocr(source,file,s,report);
        if(!recognized.trim()) throw Error('Распознавание не нашло текст.');
        return output(name+'-ocr.txt',recognized,'text/plain;charset=utf-8');
      }
      if(id==='text'||id==='word') {
        const texts=await extractText(source,report);
        if(id==='text') return output(name+'.txt',texts.join('\n\n'),'text/plain;charset=utf-8');
        return {name:name+'.docx',blob:await toWord(texts)};
      }
      if(id==='jpg'||id==='png') {
        const {blob,extension}=await photoZip(source,s,id,report);
        return {name:name+'.'+extension,blob};
      }
      const [scale,quality]={balanced:[1.4,.72],strong:[.9,.49],soft:[2,.86]}[s.quality];
      const bytes=await rasterPdf(source,pageList('',source.numPages),scale,quality,report);
      if(bytes.length>=file.size) return {name:file.name,blob:file,note:'Сжатый вариант оказался больше. Можно скачать оригинал.'};
      return output(name+'-compressed.pdf',bytes);
    } finally {await source?.loadingTask.destroy();}
  }
  const doc=prepared?.doc||await load(file);
  const total=doc.getPageCount();
  if(id==='split') {
    const groups=s.ranges.trim()?s.ranges.split(';').map(range=>pageList(range,total,true)):doc.getPageIndices().map(index=>[index]);
    const zip=new window.JSZip();
    for(const [index,group] of groups.entries()) {
      report('Часть '+(index+1)+' из '+groups.length);
      zip.file('part-'+String(index+1).padStart(3,'0')+'.pdf',await fromPages(doc,group));
    }
    return {name:name+'-split.zip',blob:await zip.generateAsync({type:'blob'})};
  }
  if(['extract','remove','organize'].includes(id)) {
    const picked=pageList(s.pages,total,true,id!=='organize');
    const indexes=id==='remove'?doc.getPageIndices().filter(index=>!picked.includes(index)):picked;
    return output(name+'-'+id+'.pdf',await fromPages(doc,indexes));
  }
  if(id==='rotate') for (const index of pageList(s.pages,total)) {
    const page=doc.getPage(index);
    page.setRotation(degrees((page.getRotation().angle+Number(s.angle))%360));
  }
  if(id==='crop') for(const index of pageList(s.pages,total)) {
    const page=doc.getPage(index), box=page.getCropBox();
    let margins=[s.left,s.top,s.right,s.bottom].map(Number);
    const turns=((page.getRotation().angle/90)%4+4)%4;
    margins=margins.slice(turns).concat(margins.slice(0,turns));
    const [left,top,right,bottom]=margins;
    if(left+right>=box.width||top+bottom>=box.height) throw Error('Поля больше или равны размеру страницы '+(index+1)+'.');
    page.setCropBox(box.x+left,box.y+bottom,box.width-left-right,box.height-top-bottom);
  }
  if(id==='watermark') {
    if(!s.text.trim()) throw Error('Введите текст водяного знака.');
    const canvas=stamp(s.text.trim(),44,'#1b4e9b');
    const image=await doc.embedPng(await (await asBlob(canvas,'image/png')).arrayBuffer());
    for(const index of pageList(s.pages,total)) {
      const page=doc.getPage(index), box=page.getCropBox(), angle=Math.PI/6;
      const width=Math.min(box.width*.69,image.width/3), height=image.height*width/image.width;
      const x=box.x+box.width/2-width/2*Math.cos(angle)+height/2*Math.sin(angle);
      const y=box.y+box.height/2-width/2*Math.sin(angle)-height/2*Math.cos(angle);
      page.drawImage(image,{x,y,width,height,rotate:degrees(30),opacity:.22});
    }
  }
  if(id==='number') {
    const font=await doc.embedFont(StandardFonts.Helvetica);
    for(const [index,page] of doc.getPages().entries()) {
      const label=String(Number(s.start)+index), box=page.getCropBox(), size=11;
      const rotation=(page.getRotation().angle+360)%360;
      const span=rotation%180?box.height:box.width;
      const width=font.widthOfTextAtSize(label,size);
      const inset=s.align==='left'?16:s.align==='right'?span-width-16:(span-width)/2;
      const [x,y]={
        0:[inset,17],90:[box.width-17,inset],180:[box.width-inset,box.height-17],270:[17,box.height-inset]
      }[rotation];
      page.drawText(label,{font,size,x:box.x+x,y:box.y+y,rotate:degrees(rotation),color:rgb(.21,.24,.3)});
    }
  }
  if(id==='metadata') {
    doc.setTitle(s.title);doc.setAuthor(s.author);doc.setSubject(s.subject);
    doc.setKeywords(s.keywords.split(',').map(keyword=>keyword.trim()).filter(Boolean));
    doc.catalog.delete(PDFName.of('Metadata'));
  }
  if(id==='flatten') doc.getForm().flatten({updateFieldAppearances:false});
  if(id==='form') return output(name+'-filled.pdf',await applyForm(doc,prepared.fields));
  const bytes=await doc.save({updateFieldAppearances:false});
  if(id==='compress'&&bytes.length>=file.size) return {name:file.name,blob:file,note:'Пересохранение без потерь не уменьшило этот PDF. Можно скачать оригинал.'};
  return output(name+'-'+(id==='compress'?'compressed':id)+'.pdf',bytes);
}
export {asBlob,base,canvasOf,formData,imageBitmap,load,open,operate,output,pageList,rasterPdf,renderPage,stamp};
