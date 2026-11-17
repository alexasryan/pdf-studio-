import {acquire,asBlob,base,canvasOf,imageBitmap,load,open,output,rasterPdf,renderPage,stamp} from './pdf.js';
const {degrees}=window.PDFLib;
function paint(canvas,marks) {
  const ctx=canvas.getContext('2d');
  const {width,height}=canvas;
  for(const mark of marks) {
    ctx.save();
    ctx.fillStyle=mark.color;
    ctx.strokeStyle=mark.color;
    const x=mark.x*width,y=mark.y*height;
    if(mark.type==='hide'||mark.type==='highlight') {
      ctx.globalAlpha=mark.type==='highlight'?.37:1;
      const endX=mark.end.x*width,endY=mark.end.y*height;
      const padding=mark.type==='hide'?2:0;
      ctx.fillRect(Math.min(x,endX)-padding,Math.min(y,endY)-padding,Math.abs(endX-x)+2*padding,Math.abs(endY-y)+2*padding);
    }
    if(mark.type==='ink') {
      ctx.lineWidth=Math.max(2,width*.004);
      ctx.lineCap='round';
      ctx.lineJoin='round';
      ctx.beginPath();
      ctx.moveTo(x,y);
      for(const point of mark.points) ctx.lineTo(point.x*width,point.y*height);
      ctx.stroke();
    }
    if(mark.bitmap) ctx.drawImage(mark.bitmap,x,y,mark.width*width,mark.height*height);
    ctx.restore();
  }
}
export async function createViewer(file,kind,stage,settings,report) {
  const lease=await acquire(file);
  const source=lease.doc;
  let index=0, snapshot, current, draft, disposed=false, generation=0;
  const marks=new Map();
  const controls=document.createElement('div');
  controls.className='viewer-controls';
  const button=(label,action)=>{
    const button=document.createElement('button');
    button.className='secondary';
    button.type='button';
    button.textContent=label;
    button.onclick=action;
    controls.append(button);
    return button;
  };
  const previous=button('←',()=>turn(-1));
  previous.setAttribute('aria-label','Предыдущая страница');
  const counter=document.createElement('span');
  controls.append(counter);
  const next=button('→',()=>turn(1));
  next.setAttribute('aria-label','Следующая страница');
  const undo=kind==='view'?null:button('Отменить правку',()=>{
    const mark=marks.get(index)?.pop();
    mark?.bitmap?.close?.();
    redraw();
  });
  let zoom=1;
  button('−',()=>{zoom=Math.max(.5,zoom-.25);pageWrap.style.width=(zoom*100)+'%';});
  button('+',()=>{zoom=Math.min(2,zoom+.25);pageWrap.style.width=(zoom*100)+'%';});
  const pageWrap=document.createElement('div');
  pageWrap.className='page-view';
  const overlay=canvasOf(1,1);
  const pageMarks=()=>marks.get(index)||[];
  let paintFrame=0;
  const scheduleRedraw=()=>{if(!paintFrame)paintFrame=requestAnimationFrame(()=>{paintFrame=0;redraw();});};
  function redraw(){
    if(!snapshot||disposed) return;
    overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
    paint(overlay,draft?[...pageMarks(),draft]:pageMarks());
    if(undo) undo.disabled=!pageMarks().length;
  }
  async function turn(delta) {
    const target=index+delta;
    if(target<0||target>=source.numPages||disposed) return;
    const turnId=++generation;
    previous.disabled=true;
    next.disabled=true;
    if(undo) undo.disabled=true;
    overlay.style.pointerEvents='none';
    draft=null;
    try {
      const result=await renderPage(source,target,1.35);
      if(disposed||turnId!==generation){result.canvas.width=0;return;}
      if(snapshot)snapshot.canvas.width=0;
      snapshot=result;
      index=target;
      overlay.width=snapshot.canvas.width;
      overlay.height=snapshot.canvas.height;
      pageWrap.replaceChildren(snapshot.canvas);
      if(kind!=='view') pageWrap.append(overlay);
      counter.textContent=(index+1)+' / '+source.numPages;
      redraw();
    } catch(error) {
      if(!disposed) report(error.message,true);
    } finally {
      if(!disposed&&generation===turnId) {
        previous.disabled=index===0;
        next.disabled=index>=source.numPages-1;
        overlay.style.pointerEvents='';
      }
    }
  }
  const push=(page,mark)=>{
    if(!marks.has(page)) marks.set(page,[]);
    marks.get(page).push(mark);
    redraw();
  };
  const point=event=>{
    const rect=overlay.getBoundingClientRect();
    const clamp=number=>Math.max(0,Math.min(1,number));
    return {x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height)};
  };
  overlay.addEventListener('pointerdown',async event=>{
    if(!snapshot||disposed||event.button!==0||draft) return;
    event.preventDefault();
    const start=point(event), s=settings(), page=index, {unit}=snapshot;
    const type=kind==='redact'?'hide':kind==='sign'?'ink':s.mode;
    const color=kind==='redact'?'#000':kind==='sign'?'#192644':type==='highlight'?'#ffcf33':s.color;
    const mark={...start,color,type};
    try {
      if(type==='text'||type==='image') {
        if(type==='text'&&!s.text.trim()) throw Error('Введите текст для вставки.');
        if(type==='image'&&!s.image) throw Error('Добавьте изображение в поле над страницей.');
        const bitmap=type==='text'?stamp(s.text.trim(),Number(s.size),color):await imageBitmap(s.image);
        if(disposed) {bitmap.close?.();return;}
        mark.bitmap=bitmap;
        mark.width=Math.min(type==='text'?bitmap.width/3/unit.width:.4,.94);
        mark.height=mark.width*unit.width*bitmap.height/bitmap.width/unit.height;
        if(mark.height>.9) {mark.width*=.9/mark.height;mark.height=.9;}
        mark.x=Math.min(mark.x,1-mark.width);
        mark.y=Math.min(mark.y,1-mark.height);
        push(page,mark);
        report('');
        return;
      }
      draft={...mark,points:[start],end:start};
      current=event.pointerId;
      overlay.setPointerCapture(current);
    } catch(error) {report(error.message,true);}
  });
  const extend=event=>{
    if(!draft||current!==event.pointerId) return;
    const p=point(event);
    draft.end=p;
    if(draft.type==='ink') draft.points.push(p);
    scheduleRedraw();
  };
  overlay.addEventListener('pointermove',extend);
  overlay.addEventListener('pointerup',event=>{
    if(!draft||current!==event.pointerId) return;
    extend(event);
    const mark=draft;
    draft=null;
    if(Math.hypot(mark.x-mark.end.x,mark.y-mark.end.y)>.003||mark.points.length>2) push(index,mark);
    else redraw();
  });
  overlay.addEventListener('pointercancel',()=>{draft=null;redraw();});
  stage.replaceChildren(controls,pageWrap);
  stage.hidden=false;
  await turn(0);
  return {
    suspend:()=>{generation++;cancelAnimationFrame(paintFrame);paintFrame=0;if(snapshot)snapshot.canvas.width=0;snapshot=null;overlay.width=0;pageWrap.replaceChildren();void source.cleanup().catch(()=>{});},
    resume:async()=>{if(!snapshot&&!disposed)await turn(0);},
    dispose:async()=>{
      disposed=true;
      cancelAnimationFrame(paintFrame);
      for(const entries of marks.values()) for(const mark of entries) mark.bitmap?.close?.();
      lease.release();
      if(snapshot)snapshot.canvas.width=0;overlay.width=0;
    },
    export:async(id,progress)=>{
      if(![...marks.values()].some(entries=>entries.length)) return {name:base(file)+'-edited.pdf',blob:file};
      if(id==='redact') {
        const indexes=Array.from({length:source.numPages},(_,i)=>i);
        const bytes=await rasterPdf(source,indexes,2,.95,progress,(i,canvas)=>paint(canvas,marks.get(i)||[]));
        return output(base(file)+'-redacted.pdf',bytes);
      }
      const doc=await load(file);
      for(const [pageIndex,entries] of marks) {
        if(!entries.length) continue;
        progress('Сохранение страницы '+(pageIndex+1));
        const page=await source.getPage(pageIndex+1), unit=page.getViewport({scale:1});
        const layer=canvasOf(unit.width*2,unit.height*2);
        paint(layer,entries);
        const image=await doc.embedPng(await (await asBlob(layer,'image/png')).arrayBuffer());
        const [x,y]=unit.convertToPdfPoint(0,unit.height);
        const [rightX,rightY]=unit.convertToPdfPoint(unit.width,unit.height);
        const [topX,topY]=unit.convertToPdfPoint(0,0);
        const rotation=Math.atan2(rightY-y,rightX-x)*180/Math.PI;
        doc.getPage(pageIndex).drawImage(image,{x,y,width:Math.hypot(rightX-x,rightY-y),height:Math.hypot(topX-x,topY-y),rotate:degrees(rotation)});
      }
      return output(base(file)+(id==='sign'?'-signed.pdf':'-edited.pdf'),await doc.save({updateFieldAppearances:false}));
    },
  };
}
