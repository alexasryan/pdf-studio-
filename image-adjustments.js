import {workerTask,yieldToUI} from './performance.js';
const clamp=n=>Math.max(0,Math.min(255,Math.round(n)));
export function adjustPixels(data,width,height,settings={}) {
  const brightness=Number(settings.brightness||0)*2.55;
  const contrast=(100+Number(settings.contrast||0))/100;
  const saturation=Number(settings.saturation??100)/100;
  const warmth=Number(settings.warmth||0)*.55;
  const mode=settings.colorMode||'color';
  if(!brightness&&contrast===1&&saturation===1&&!warmth&&mode==='color'&&!Number(settings.sharpness||0))return data;
  for(let i=0;i<data.length;i+=4) {
    let r=(data[i]-128)*contrast+128+brightness+warmth;
    let g=(data[i+1]-128)*contrast+128+brightness;
    let b=(data[i+2]-128)*contrast+128+brightness-warmth;
    const gray=.2126*r+.7152*g+.0722*b;
    r=gray+(r-gray)*saturation;g=gray+(g-gray)*saturation;b=gray+(b-gray)*saturation;
    if(mode==='gray')r=g=b=gray;
    if(mode==='bw')r=g=b=gray>=Number(settings.threshold??160)?255:0;
    if(mode==='sepia'){const a=r,c=g,d=b;r=.393*a+.769*c+.189*d;g=.349*a+.686*c+.168*d;b=.272*a+.534*c+.131*d;}
    if(mode==='invert'){r=255-r;g=255-g;b=255-b;}
    data[i]=clamp(r);data[i+1]=clamp(g);data[i+2]=clamp(b);
  }
  const sharp=Number(settings.sharpness||0)/100;
  if(sharp>0&&width>2&&height>2) {
    // Keep only three scanlines so sharpening does not double the bitmap memory.
    const stride=width*4;
    let above=data.slice(0,stride), row=data.slice(stride,2*stride);
    for(let y=1;y<height-1;y++) {
      const below=data.slice((y+1)*stride,(y+2)*stride);
      for(let x=1;x<width-1;x++)for(let c=0;c<3;c++) {
        const i=x*4+c, blurred=(above[i]+below[i]+row[i-4]+row[i+4])/4;
        data[y*stride+i]=clamp(row[i]+sharp*(row[i]-blurred));
      }
      above=row;row=below;
    }
  }
  return data;
}
export async function adjustCanvas(canvas,settings) {
  if(!settings||(!Number(settings.brightness||0)&&!Number(settings.contrast||0)&&Number(settings.saturation??100)===100&&!Number(settings.warmth||0)&&!Number(settings.sharpness||0)&&(!settings.colorMode||settings.colorMode==='color')))return canvas;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const image=ctx.getImageData(0,0,canvas.width,canvas.height);
  const task=workerTask('image-worker.js',{buffer:image.data.buffer,width:canvas.width,height:canvas.height,settings},[image.data.buffer]);
  if(task){const buffer=await task;ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer),canvas.width,canvas.height),0,0);}
  else{await yieldToUI();adjustPixels(image.data,canvas.width,canvas.height,settings);ctx.putImageData(image,0,0);}
  return canvas;
}
export function renderDimensions(width,height,dpi) {
  if(!Number.isFinite(dpi)||dpi<72||dpi>600)throw Error('Выберите разрешение от 72 до 600 dpi.');
  const w=Math.ceil(width*dpi/72),h=Math.ceil(height*dpi/72);
  if(w>32767||h>32767||w*h>80000000)throw Error('Эта страница слишком велика для выбранного dpi. Уменьшите разрешение или размер страницы.');
  return {width:w,height:h,scale:dpi/72};
}
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
export async function withDpi(blob,dpi) {
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(blob.type==='image/png') {
    const chunk=new Uint8Array(21),v=new DataView(chunk.buffer);
    v.setUint32(0,9);chunk.set([112,72,89,115],4);
    v.setUint32(8,Math.round(dpi/0.0254));v.setUint32(12,Math.round(dpi/0.0254));chunk[16]=1;v.setUint32(17,crc32(chunk.subarray(4,17)));
    let offset=8;const parts=[bytes.subarray(0,8)];let inserted=false;
    while(offset+12<=bytes.length){const length=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0);const end=offset+12+length;const kind=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
      if(end>bytes.length)throw Error('Повреждённое PNG-изображение.');
      if(kind!=='pHYs')parts.push(bytes.subarray(offset,end));
      if(kind==='IHDR'){parts.push(chunk);inserted=true;}offset=end;
    }
    if(!inserted)throw Error('Не удалось записать dpi PNG.');return new Blob(parts,{type:blob.type});
  }
  if(blob.type==='image/jpeg') {
    let offset=2;
    while(offset+4<bytes.length&&bytes[offset]===255){const marker=bytes[offset+1];if(marker===218||marker===217)break;const length=(bytes[offset+2]<<8)|bytes[offset+3];if(length<2||offset+2+length>bytes.length)break;
      if(marker===224&&String.fromCharCode(...bytes.subarray(offset+4,offset+9))==='JFIF\0') {bytes[offset+11]=1;bytes[offset+12]=dpi>>8;bytes[offset+13]=dpi&255;bytes[offset+14]=dpi>>8;bytes[offset+15]=dpi&255;return new Blob([bytes],{type:blob.type});}offset+=2+length;
    }
    const jfif=new Uint8Array([255,224,0,16,74,70,73,70,0,1,1,1,dpi>>8,dpi&255,dpi>>8,dpi&255,0,0]);
    return new Blob([bytes.subarray(0,2),jfif,bytes.subarray(2)],{type:blob.type});
  }
  return blob;
}
