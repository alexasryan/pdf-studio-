const MM=72/25.4;
export const paperFormats={A0:[841,1189],A1:[594,841],A2:[420,594],A3:[297,420],A4:[210,297],A5:[148,210],A6:[105,148],B4:[250,353],B5:[176,250],Letter:[215.9,279.4],Legal:[215.9,355.6],Tabloid:[279.4,431.8]};
export function resizeLayout(sourceWidth,sourceHeight,s={}) {
  const format=s.paperFormat||'A4';
  const size=format==='custom'?[Number(s.widthMm),Number(s.heightMm)]:paperFormats[format];
  if(!size||!size.every(n=>Number.isFinite(n)&&n>=1&&n<=2000))throw Error('Укажите размер страницы от 1 до 2000 мм.');
  let [width,height]=size.map(n=>n*MM);
  const landscape=s.orientation==='landscape'||s.orientation==='auto'&&sourceWidth>sourceHeight;
  [width,height]=landscape?[Math.max(width,height),Math.min(width,height)]:[Math.min(width,height),Math.max(width,height)];
  const margin=Number(s.marginMm??0)*MM;
  if(!Number.isFinite(margin)||margin<0||margin*2>=Math.min(width,height))throw Error('Поля должны быть меньше половины ширины и высоты страницы.');
  if(!(sourceWidth>0&&sourceHeight>0))throw Error('Некорректный размер исходной страницы.');
  const availableWidth=width-2*margin,availableHeight=height-2*margin;
  const fit=Math.min(availableWidth/sourceWidth,availableHeight/sourceHeight);
  const mode=s.resizeMode||'fit';
  const scale=mode==='fill'?Math.max(availableWidth/sourceWidth,availableHeight/sourceHeight):mode==='shrink'?Math.min(1,fit):mode==='actual'?1:fit;
  const contentWidth=sourceWidth*scale,contentHeight=sourceHeight*scale;
  return {width,height,margin,scale,x:(width-contentWidth)/2,y:(height-contentHeight)/2,contentWidth,contentHeight};
}
function translateAnnotations(page,tx,ty,lib) {
  const annotations=page.node.Annots();if(!annotations)return;
  for(const ref of annotations.asArray()) {
    const annotation=page.doc.context.lookup(ref);if(!(annotation instanceof lib.PDFDict))continue;
    const move=array=>{if(!(array instanceof lib.PDFArray))return;for(let i=0;i<array.size();i++){const item=array.lookup(i);if(item instanceof lib.PDFNumber)array.set(i,lib.PDFNumber.of(item.asNumber()+(i%2?ty:tx)));}};
    for(const key of ['Rect','QuadPoints','Vertices','L','CL'])move(annotation.lookup(lib.PDFName.of(key)));
    const ink=annotation.lookup(lib.PDFName.of('InkList'));if(ink instanceof lib.PDFArray)for(let i=0;i<ink.size();i++)move(ink.lookup(i));
  }
}
export async function resizeDocument(doc,s,lib,report=()=>{}) {
  const total=doc.getPageCount();
  const selected=new Set();
  if(!s.pages?.trim())for(let i=0;i<total;i++)selected.add(i);
  else for(const part of s.pages.split(',')) {
    const match=part.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if(!match)throw Error('Некорректный выбор страниц.');
    const first=Number(match[1]),last=Number(match[2]||match[1]);if(first<1||last>total||last<first)throw Error('Недопустимый номер страницы.');
    for(let i=first-1;i<last;i++)selected.add(i);
  }
  // Validate all pages first so an invalid margin cannot leave a partial result.
  const plans=[...selected].map(index=>{
    const page=doc.getPage(index),box=page.getCropBox(),angle=((page.getRotation().angle%360)+360)%360;
    const rotated=angle===90||angle===270;
    const layout=resizeLayout(rotated?box.height:box.width,rotated?box.width:box.height,s);
    const width=rotated?layout.height:layout.width,height=rotated?layout.width:layout.height;
    return {index,page,box,width,height,scale:layout.scale,margin:layout.margin};
  });
  for(const {index,page,box,width,height,scale,margin} of plans) {
    report('Масштабируем страницу '+(index+1)+' / '+total);
    const tx=(width-box.width*scale)/2-box.x*scale,ty=(height-box.height*scale)/2-box.y*scale;
    page.scaleContent(scale,scale);page.translateContent(tx,ty);
    page.scaleAnnotations(scale,scale);translateAnnotations(page,tx,ty,lib);
    const left=Math.max(margin,(width-box.width*scale)/2),bottom=Math.max(margin,(height-box.height*scale)/2);
    const right=Math.min(width-margin,(width+box.width*scale)/2),top=Math.min(height-margin,(height+box.height*scale)/2);
    const start=doc.context.register(doc.context.contentStream([lib.pushGraphicsState(),lib.rectangle(left,bottom,right-left,top-bottom),lib.clip(),lib.endPath()]));
    const end=doc.context.register(doc.context.contentStream([lib.popGraphicsState()]));
    page.node.wrapContentStreams(start,end);
    page.setMediaBox(0,0,width,height);page.setCropBox(0,0,width,height);
    for(const key of ['TrimBox','BleedBox','ArtBox'])if(page.node.has(lib.PDFName.of(key)))page.node.set(lib.PDFName.of(key),doc.context.obj([0,0,width,height]));
  }
  return doc.save({updateFieldAppearances:false,objectsPerTick:30});
}
export function resizePreview(raw,s,extraRotation=0) {
  const quarter=((extraRotation%360)+360)%360;
  const rotated=quarter===90||quarter===270;
  const unit=raw.pdfUnit||{width:raw.width,height:raw.height};
  const sourceWidth=rotated?unit.height:unit.width,sourceHeight=rotated?unit.width:unit.height;
  const layout=resizeLayout(sourceWidth,sourceHeight,s);
  const density=Math.min(raw.width/unit.width,1800/Math.max(layout.width,layout.height));
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(layout.width*density);canvas.height=Math.ceil(layout.height*density);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.beginPath();ctx.rect(layout.margin*density,layout.margin*density,(layout.width-2*layout.margin)*density,(layout.height-2*layout.margin)*density);ctx.clip();
  ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(quarter*Math.PI/180);
  const width=(rotated?layout.contentHeight:layout.contentWidth)*density,height=(rotated?layout.contentWidth:layout.contentHeight)*density;
  ctx.drawImage(raw,-width/2,-height/2,width,height);ctx.restore();return canvas;
}
