import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {handleSawtak} from './sawtak-arabi.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT || 3000);
const TYPES=new Map([
  ['/','public/index.html','text/html; charset=utf-8'],
  ['/app.js','public/app.js','text/javascript; charset=utf-8'],
  ['/style.css','public/style.css','text/css; charset=utf-8'],
  ['/manifest.webmanifest','public/manifest.webmanifest','application/manifest+json'],
  ['/icons/icon-192.png','public/icons/icon-192.png','image/png'],
  ['/icons/icon-512.png','public/icons/icon-512.png','image/png']
].map(([url,file,type])=>[url,{file,type}]));
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url||'/', 'http://localhost').pathname;
    if(pathname.startsWith('/api/sawtak/')){
      return await handleSawtak(req,res,pathname);
    }
    const item=TYPES.get(pathname);
    if(item && (req.method==='GET'||req.method==='HEAD')){
      const bytes=await readFile(path.join(ROOT,item.file));
      res.writeHead(200,{
        'Content-Type':item.type,
        'Content-Length':bytes.length,
        'X-Content-Type-Options':'nosniff',
        'Cache-Control':'no-cache',
        'Referrer-Policy':'no-referrer',
        'X-Frame-Options':'SAMEORIGIN'
      });
      return res.end(req.method==='HEAD'?undefined:bytes);
    }
    res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});
    return res.end(JSON.stringify({error:'الصفحة المطلوبة غير موجودة.'}));
  }catch(e){
    console.error('HTTP error', String(e?.message||e));
    if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'خطأ داخلي في الخادم.'}));}
    else res.end();
  }
});
server.requestTimeout=180000;
server.listen(PORT,'0.0.0.0',()=>console.log('Sawtak Iraqi Studio listening on '+PORT));
