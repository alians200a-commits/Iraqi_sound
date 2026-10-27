/** Optional Habibi-TTS proxy. Node itself never claims to host the AI model.
 * This route does not alter the existing working Edge-TTS implementation.
 */
const HABIBI_URL = (process.env.HABIBI_URL || '').replace(/\/+$/, '');
const HABIBI_API_KEY = process.env.HABIBI_API_KEY || '';
const MAX_CHARS = 220;
const WINDOW_MS = 60_000;
const REQUESTS_PER_MINUTE = 16;
const ipCounters = new Map();
let running = 0;
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(body);
}
function rejectCrossOrigin(req) {
  if (!req.headers.origin) return false;
  try {
    const origin = new URL(req.headers.origin);
    const forwarded = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwarded || req.headers.host;
    return origin.host !== host;
  } catch {return true;}
}
async function readPayload(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw {status:415,message:'الطلب لازم يكون JSON.'};
  const pieces=[];let length=0;
  for await(const piece of req) {
    length += piece.length;
    if(length > 3500) throw {status:413,message:'الطلب أكبر من المسموح.'};
    pieces.push(piece);
  }
  try {return JSON.parse(Buffer.concat(pieces).toString('utf8'));}
  catch{throw {status:400,message:'نص الطلب مو JSON صالح.'};}
}
function audioValid(bytes, mime) {
  if (bytes.length < 128) return false;
  if (mime === 'audio/mpeg') return bytes.subarray(0,3).toString('ascii') === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  return bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WAVE';
}
export function habibiStatus() {
  return {configured: Boolean(HABIBI_URL && HABIBI_API_KEY), model:'Specialized/IRQ', maximumSegmentChars:MAX_CHARS, note:'A separate Python inference host is required.'};
}
export async function handleHabibi(req,res,pathname) {
  if (pathname === '/api/habibi/status' && req.method === 'GET') return sendJson(res,200,habibiStatus());
  if(pathname !== '/api/habibi/generate' || req.method !== 'POST') return false;
  if (rejectCrossOrigin(req)) return sendJson(res,403,{error:'مصدر الطلب غير مسموح.'});
  if (!HABIBI_URL || !HABIBI_API_KEY) return sendJson(res,503,{error:'Habibi مو مربوط بعد بخادم النموذج. يلزم إعداد HABIBI_URL وHABIBI_API_KEY على استضافة Node، وتشغيل خدمة Python منفصلة.'});
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  if (ipCounters.size > 1000) ipCounters.clear();
  const state = ipCounters.get(ip);
  const current = (!state || now-state.start>WINDOW_MS) ? {start:now,count:0} : state;
  current.count += 1;
  ipCounters.set(ip,current);
  if(current.count>REQUESTS_PER_MINUTE) return sendJson(res,429,{error:'مؤقتاً أكو حد حماية، أعد المحاولة بعد دقيقة.'});
  if(running>=1) return sendJson(res,429,{error:'محرك Habibi مشغول. انتظر اكتمال التسجيل السابق.'});
  let input;
  try{input = await readPayload(req);}catch(e){return sendJson(res,e.status||400,{error:e.message||'طلب غير صالح'});}
  const text = String(input.text ?? '').trim();
  const speed = Number(input.speed ?? 1);
  if(!text || text.length>MAX_CHARS || !Number.isFinite(speed) || speed<0.7 || speed>1.3) return sendJson(res,400,{error:`المقطع لازم يكون 1–${MAX_CHARS} حرف، وسرعته 0.7–1.3.`});
  running++;
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),290_000);
  try {
    const response = await fetch(`${HABIBI_URL}/generate`,{
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${HABIBI_API_KEY}`},
      body:JSON.stringify({text,speed})
    });
    const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if(!response.ok){
      let reason = `خطأ بالخادم (${response.status})`;
      if(mime==='application/json'){try{const j=await response.json();reason=String(j.error||reason);}catch{}}
      return sendJson(res,response.status===429?429:502,{error:`خادم Habibi: ${reason.slice(0,250)}`});
    }
    if (!['audio/wav','audio/x-wav','audio/wave','audio/mpeg'].includes(mime)) return sendJson(res,502,{error:'الخادم رجّع بيانات مو صوت. راجع ربط Habibi.'});
    const bytes=Buffer.from(await response.arrayBuffer());
    const standardized = mime==='audio/mpeg' ? 'audio/mpeg' : 'audio/wav';
    if(!audioValid(bytes,standardized)) return sendJson(res,502,{error:'التسجيل الراجع مو WAV/MP3 صالح.'});
    res.writeHead(200,{'Content-Type':standardized,'Content-Length':bytes.length,'Content-Disposition':`attachment; filename="sawtak_habibi.${standardized==='audio/mpeg'?'mp3':'wav'}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    return res.end(bytes);
  }catch(error){
    console.error('[habibi-proxy]',String(error?.message||error));
    return sendJson(res,502,{error:error?.name==='AbortError'?'خادم Habibi تجاوز مهلة الانتظار.':'تعذّر الاتصال بخادم Habibi. راجع إعدادات الاستضافة.'});
  }finally{clearTimeout(timer);running--;}
}
