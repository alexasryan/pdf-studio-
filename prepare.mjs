import {cp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {tools} from './dist/tools.js';

const dist=new URL('./dist/',import.meta.url);
const dependencies=new URL('./node_modules/',import.meta.url);
const vendor=new URL('vendor/',dist);
await mkdir(vendor,{recursive:true});
const targets={
  'pdf-lib/dist/pdf-lib.min.js':'pdf-lib.min.js',
  'pdfjs-dist/build/pdf.min.mjs':'pdf.min.mjs',
  'pdfjs-dist/build/pdf.worker.min.mjs':'pdf.worker.min.mjs',
  'pdfjs-dist/cmaps':'cmaps',
  'pdfjs-dist/wasm':'wasm',
  'pdfjs-dist/iccs':'iccs',
  'pdfjs-dist/standard_fonts':'standard_fonts',
  'jszip/dist/jszip.min.js':'jszip.min.js',
  'docx/dist/index.iife.js':'docx.js',
  'mammoth/mammoth.browser.min.js':'mammoth.browser.min.js',
  '@pdf-lib/fontkit/dist/fontkit.umd.min.js':'fontkit.min.js',
  'dejavu-fonts-ttf/ttf/DejaVuSans.ttf':'dejavu-sans.ttf',
  'tesseract.js/dist/tesseract.min.js':'tesseract.min.js',
  'tesseract.js/dist/worker.min.js':'worker.min.js',
  'tesseract.js-core/tesseract-core-lstm.wasm.js':'ocr/tesseract-core-lstm.wasm.js',
  '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz':'languages/eng.traineddata.gz',
  '@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz':'languages/rus.traineddata.gz',
  '@jspawn/qpdf-wasm/qpdf.js':'qpdf/qpdf.js',
  '@jspawn/qpdf-wasm/qpdf.mjs':'qpdf/qpdf.mjs',
  '@jspawn/qpdf-wasm/browser.js':'qpdf/browser.js',
  '@jspawn/qpdf-wasm/qpdf.wasm':'qpdf/qpdf.wasm',
};
await Promise.all(Object.entries(targets).map(([from,to])=>cp(new URL(from,dependencies),new URL(to,vendor),{recursive:true})));
const licenses=new URL('licenses/',vendor);
await mkdir(licenses,{recursive:true});
const names=['pdf-lib','pdfjs-dist','jszip','docx','mammoth','lucide-static','@pdf-lib/fontkit','dejavu-fonts-ttf','tesseract.js','tesseract.js-core','@jspawn/qpdf-wasm'];
for(const name of names) {
  const directory=new URL(name+'/',dependencies);
  for(const item of await readdir(directory)) {
    if(/^(licen[cs]e|copying|notice)(\b|[-_])/i.test(item)) {
      await cp(new URL(item,directory),new URL(name.replace(/[^\w.-]/g,'_')+'-'+item,licenses),{recursive:true});
    }
  }
}
const icons={};
const used=new Set([...tools.map(tool=>tool[4]),'arrow-up-right','check','moon','search','sparkles','sun','upload-cloud','x']);
for(const icon of used) {
  icons[icon]=(await readFile(new URL('lucide-static/icons/'+icon+'.svg',dependencies),'utf8'))
    .replace(/<!--[\s\S]*?-->/g,'').replace('<svg','<svg aria-hidden="true" focusable="false"').trim();
}
await writeFile(new URL('icons.json',dist),JSON.stringify(icons));
