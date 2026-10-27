import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';

const wav = Buffer.alloc(480);
wav.write('RIFF',0);wav.writeUInt32LE(472,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(436,40);
const worker=http.createServer(async(req,res)=>{
  const data=[];for await(const chunk of req)data.push(chunk);
  const payload=JSON.parse(Buffer.concat(data).toString('utf8'));
  if(payload.text.includes('broken')){res.writeHead(200,{'content-type':'text/html'});res.end('<html>Error</html>');}
  else {res.writeHead(200,{'content-type':'audio/wav'});res.end(wav);}
});
await new Promise(resolve=>worker.listen(0,'127.0.0.1',resolve));
const port=worker.address().port;
process.env.HABIBI_URL=`http://127.0.0.1:${port}`;
process.env.HABIBI_API_KEY='local-test-token';
const {handleHabibi,habibiStatus}=await import('../habibi_gateway.mjs');
const api=http.createServer(async(req,res)=>{
  const route = new URL(req.url,'http://localhost').pathname;
  const processed = await handleHabibi(req,res,route);
  if(processed===false){res.writeHead(404);res.end('no route');}
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${api.address().port}`;
try {
  assert.equal(habibiStatus().configured,true);
  let response=await fetch(base+'/api/habibi/status');assert.equal((await response.json()).configured,true);
  response=await fetch(base+'/api/habibi/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'هلا والله شلونكم؟',speed:1})});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,4).toString(),'RIFF');
  response=await fetch(base+'/api/habibi/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'broken'})});
  assert.equal(response.status,502);
  response=await fetch(base+'/api/habibi/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'س'.repeat(221)})});
  assert.equal(response.status,400);
  console.log('PASS: status, real WAV proxy, invalid HTML response, 221-character guard');
}finally{api.close();worker.close();}
