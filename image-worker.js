import {adjustPixels} from './image-adjustments.js';
self.onmessage=({data})=>{const {id,buffer,width,height,settings}=data;try{const pixels=new Uint8ClampedArray(buffer);adjustPixels(pixels,width,height,settings);self.postMessage({id,result:pixels.buffer},[pixels.buffer]);}catch(error){self.postMessage({id,error:error.message});}};
