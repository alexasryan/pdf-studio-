import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('./dist',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.ttf':'font/ttf','.gz':'application/gzip'};
const port=Number(process.env.PDF_STUDIO_PORT||4173);
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!path.startsWith(root+sep)||!(await stat(path)).isFile()) throw Error();
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});
    if(req.method==='HEAD') res.end();
    else createReadStream(path).on('error',()=>res.destroy()).pipe(res);
  } catch {res.writeHead(404).end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log('PDF Studio: http://127.0.0.1:'+port));
