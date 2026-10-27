/**
 * Sawtak Arabi REST integration. No API key is returned to the browser.
 * Explicit app passphrase protects prepaid credits on public deployments.
 * WAV is only returned after operation completion and PCM byte verification.
 * Node.js >= 20; no additional dependencies.
 */
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const BASE = 'https://api.sawtakarabi.ai/v1';
const API_KEY = process.env.SAWTAK_API_KEY || '';
const APP_PASSWORD = process.env.SAWTAK_APP_PASSWORD || '';
const ENABLED = Boolean(API_KEY.trim() && APP_PASSWORD.length >= 12);
function setupStatus() {
  if (!API_KEY.trim()) return 'الخادم ما استلم SAWTAK_API_KEY. احفظ المفتاح في Secrets وأعد تشغيل أو نشر الخادم.';
  if (!APP_PASSWORD) return 'الخادم ما استلم SAWTAK_APP_PASSWORD. احفظ رمز الدخول في Secrets وأعد تشغيل أو نشر الخادم.';
  if (APP_PASSWORD.length < 12) return 'رمز دخول التطبيق على الخادم أقل من 12 حرفاً؛ غيّره في Secrets ثم أعد تشغيل أو نشر الخادم.';
  return 'خادم Sawtak مهيأ. أدخل رمز الدخول واضغط جلب الأصوات قبل التوليد.';
}
const MAX_CHARS = Math.min(2000, Math.max(100, Number(process.env.SAWTAK_MAX_CHARS || 900) || 900));
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
let generating = false;
let cache = { expiry: 0, data: [] };

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function secureEquals(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function gate(req, res) {
  if (!ENABLED) {
    json(res, 503, { error: 'محرك Sawtak Arabi غير مفعّل. اضبط SAWTAK_API_KEY وSAWTAK_APP_PASSWORD (12 حرفاً على الأقل) في أسرار الخادم.' });
    return false;
  }
  if (!secureEquals(req.headers['x-sawtak-access'] || '', APP_PASSWORD)) {
    json(res, 401, { error: 'رمز دخول تطبيق صَوْتَك غير صحيح. هذا ليس مفتاح API.' });
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const expected = req.headers['x-forwarded-host'] || req.headers.host;
      if (!expected || new URL(origin).host !== expected) {
        json(res, 403, { error: 'مصدر الطلب غير مسموح.' });
        return false;
      }
    } catch {
      json(res, 403, { error: 'مصدر الطلب غير صحيح.' });
      return false;
    }
  }
  return true;
}
async function readJsonBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('نوع الطلب غير صحيح.');
  const buffers = []; let bytes = 0;
  for await (const part of req) {
    bytes += part.length;
    if (bytes > 16_000) throw new Error('حجم الطلب كبير.');
    buffers.push(part);
  }
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')); }
  catch { throw new Error('تعذر قراءة الطلب.'); }
}
async function upstream(url, options = {}, timeout = 30_000) {
  return fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${API_KEY}`, ...options.headers },
    signal: AbortSignal.timeout(timeout)
  });
}
async function vendorError(response) {
  let details = '';
  try { const x = await response.json(); details = String(x.detail?.message || x.detail || x.error?.message || x.error || x.message || ''); } catch {}
  if (response.status === 401) return 'مفتاح Sawtak Arabi غير صالح أو ملغي.';
  if (response.status === 402) return 'رصيد Sawtak Arabi غير كافٍ.';
  if (response.status === 403) return 'مفتاح الخدمة ما عنده صلاحية تحويل النص أو قراءة الأصوات.';
  if (response.status === 404) return 'الصوت غير متاح أو معرفه غير صحيح.';
  if (response.status === 429) return 'وصلت حد طلبات Sawtak Arabi، جرّب بعدين.';
  return `خدمة Sawtak Arabi رجّعت ${response.status}${details ? ': ' + details.slice(0, 160) : ''}`;
}
function isIraqi(voice) {
  const dialect = String(voice.labels?.dialect || '').toLowerCase();
  return /iraq|iraqi|(^|-)iq($|-)|عراق|بغداد|نجف|موصل|بصر/.test(dialect);
}
async function listVoices() {
  if (Date.now() < cache.expiry) return cache.data;
  const result = []; let after = '';
  for (let i = 0; i < 8; i++) {
    const url = new URL(BASE + '/voices');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const r = await upstream(url, {}, 15_000);
    if (!r.ok) throw new Error(await vendorError(r));
    const data = await r.json();
    for (const x of data.data || []) {
      if (x.status === 'ready' && isIraqi(x)) result.push({
        id: x.id,
        name: String(x.name || 'صوت عراقي'),
        dialect: String(x.labels?.dialect || ''),
        gender: String(x.labels?.gender || ''),
        description: String(x.description || '').slice(0, 140)
      });
    }
    if (!data.has_more || !data.next_cursor || data.next_cursor === after) break;
    after = data.next_cursor;
  }
  cache = { expiry: Date.now() + 10 * 60_000, data: result };
  return result;
}
async function inspectOperation(id) {
  for (let i = 0; i < 22; i++) {
    const r = await upstream(BASE + '/operations/' + encodeURIComponent(id), {}, 12_000);
    if (!r.ok) throw new Error('تعذّر تأكيد اكتمال الصوت من الخادم؛ لا تعيد التوليد قبل فحص الرصيد والسجل.');
    const op = await r.json();
    if (op.state === 'terminal') {
      if (op.outcome !== 'completed') throw new Error('انقطع توليد الصوت (الحالة: ' + String(op.outcome) + '). راجع سجل العمليات قبل إعادة الطلب.');
      return op;
    }
    await new Promise(resolve => setTimeout(resolve, 650));
  }
  throw new Error('لم يتأكد اكتمال التسجيل. راجع سجل Sawtak Arabi قبل أي إعادة لتجنب خصم مزدوج.');
}
async function receiveWav(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('audio/wav') && !contentType.includes('audio/wave') && !contentType.includes('application/octet-stream'))
    throw new Error('الاستجابة من مزود الصوت ليست WAV.');
  let bytes = 0; const parts = [];
  if (!response.body) throw new Error('لم يصل أي ملف صوتي.');
  for await (const part of response.body) {
    bytes += part.length;
    if (bytes > MAX_AUDIO_BYTES) throw new Error('حجم التسجيل تجاوز الحد الآمن.');
    parts.push(Buffer.from(part));
  }
  const wav = Buffer.concat(parts);
  if (wav.length < 48 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE' || wav.toString('ascii', 36, 40) !== 'data')
    throw new Error('الصوت WAV غير مكتمل أو غير صالح.');
  return wav;
}

const DAY = 86400;
const PRICE_ESTIMATE_PER_1000 = 0.05; // Informational only, current advertised base TTS rate.
function parseMoney(s) {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function makePcmWav(pcm) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0, 4, 'ascii');
  b.writeUInt32LE(pcm.length + 36, 4);
  b.write('WAVEfmt ', 8, 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 4, 'ascii');
  b.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([b, pcm]);
}
// Re-time the already paid-for WAV; atempo preserves the original speaker's pitch.
// This never calls the paid voice-generation endpoint a second time.
function stretchWav(wav, speed) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner','-loglevel','error','-nostdin','-i','pipe:0',
      '-af', 'atempo=' + speed.toFixed(2), '-ar','24000','-ac','1','-c:a','pcm_s16le','-f','s16le','pipe:1'];
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, {stdio: ['pipe','pipe','pipe']});
    let bytes=0, stderr='', settled=false;
    const pieces=[];
    const timeout=setTimeout(()=>child.kill('SIGKILL'), 120000);
    child.stdout.on('data', d => {bytes += d.length; if(bytes <= MAX_AUDIO_BYTES) pieces.push(d); else child.kill('SIGKILL');});
    child.stderr.on('data', d => {stderr += d.toString().slice(0, 250);});
    child.on('error', e => {if(!settled){settled=true;clearTimeout(timeout);reject(e);}});
    child.on('close', code => {
      if(settled) return;
      settled=true;clearTimeout(timeout);
      const pcm=Buffer.concat(pieces);
      if(code !== 0 || pcm.length < 100 || pcm.length % 2 || bytes > MAX_AUDIO_BYTES)
        return reject(new Error('فشل تعديل السرعة: ' + (stderr.slice(-160) || String(code))));
      resolve(makePcmWav(pcm));
    });
    child.stdin.on('error', ()=>{});
    child.stdin.end(wav);
  });
}
async function accountSummary(res) {
  try {
    const meResp = await upstream(BASE + '/me', {}, 15000);
    if(!meResp.ok) throw new Error(await vendorError(meResp));
    const me = await meResp.json();
    const balanceUsd = parseMoney(me.balance_usd);
    if(balanceUsd === null) throw new Error('خادم الخدمة ما أرسل balance_usd بالشكل المتوقع.');
    const end = (Math.floor(Date.now() / (DAY*1000)) + 1) * DAY;
    const start = end - 730*DAY;
    const thirty = end - 30*DAY;
    const today = end - DAY;
    let spent730=0, spent30=0, spentToday=0, chars730=0, chars30=0, charsToday=0;
    let usageError = null;
    try {
      for(let from=start;from<end;from+=365*DAY){
        const to=Math.min(end,from+365*DAY);
        const url = new URL(BASE + '/usage');
        url.searchParams.set('start_time', String(from));
        url.searchParams.set('end_time',String(to));
        url.searchParams.set('limit','366');
        const r=await upstream(url,{},18000);
        if(!r.ok) throw new Error(await vendorError(r));
        const list=await r.json();
        if(!Array.isArray(list.data)) throw new Error('صيغة سجل الاستخدام غير متوقعة.');
        for (const row of list.data) {
          const when=Number(row.start_time), cost=parseMoney(row.cost_usd);
          const chars=Number(row.tts_characters);
          if(!Number.isFinite(when) || cost===null || !Number.isFinite(chars)) continue;
          spent730+=cost;chars730+=chars;
          if(when>=thirty){spent30+=cost;chars30+=chars;}
          if(when>=today){spentToday+=cost;charsToday+=chars;}
        }
        if(list.has_more) throw new Error('سجل الاستخدام فيه صفحات إضافية؛ لم نعرض أرقاماً غير مكتملة.');
      }
    } catch(e){usageError=String(e?.message||e).slice(0,160);}
    return json(res,200,{
      balanceUsd:balanceUsd.toFixed(6),
      priceEstimatePer1000:PRICE_ESTIMATE_PER_1000,
      estimatedRemainingCharacters:Math.floor((balanceUsd/PRICE_ESTIMATE_PER_1000)*1000),
      spent730dUsd:usageError?null:spent730.toFixed(6),
      spent30dUsd:usageError?null:spent30.toFixed(6),
      spentTodayUsd:usageError?null:spentToday.toFixed(6),
      used730dCharacters:usageError?null:chars730,
      used30dCharacters:usageError?null:chars30,
      usedTodayCharacters:usageError?null:charsToday,
      usageError,usageNote:'الاستهلاك مُسجّل يومياً وقد يتأخر حتى ساعة؛ الرصيد يُحدّث بعد تسوية الطلب.',
      updatedAt:new Date().toISOString()
    });
  }catch(e){
    return json(res,502,{error:'تعذّر قراءة الحساب: '+String(e?.message||e).slice(0,220)});
  }
}

async function generate(req, res) {
  if (generating) return json(res, 429, { error: 'يوجد طلب قيد التوليد. حاول بعد اكتماله.' });
  let payload;
  try { payload = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const text = String(payload.text || '').trim();
  const voice = String(payload.voice || '');
  const speed = Number(payload.speed ?? 1);
  if (!Number.isFinite(speed) || speed < 0.75 || speed > 1) return json(res, 400, {error: 'سرعة الصوت يجب أن تكون بين 0.75 و1.00.'});
  if (!text || text.length > MAX_CHARS) return json(res, 400, { error: `اكتب مقطعاً من 1 إلى ${MAX_CHARS} حرف.` });
  if (!/^[\w-]{8,128}$/.test(voice)) return json(res, 400, { error: 'معرّف الصوت غير صحيح.' });
  if (payload.enhancePronunciation !== undefined && typeof payload.enhancePronunciation !== 'boolean') return json(res, 400, { error: 'إعداد النطق غير صحيح.' });
  generating = true;
  try {
    const request = await upstream(BASE + '/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ model: 'arabic-tts-1', voice, input: text, response_format: 'wav', sample_rate: 24000,
        normalize_text: true, enhance_pronunciation: payload.enhancePronunciation === true })
    }, 95_000);
    if (!request.ok) throw new Error(await vendorError(request));
    const id = request.headers.get('x-request-id');
    if (!id || !/^[\w-]{1,128}$/.test(id)) throw new Error('لم يرجع رقم العملية للتأكد من نجاح التوليد. لا تعيد الطلب مباشرة.');
    const wav = await receiveWav(request);
    const op = await inspectOperation(id);
    const dataBytes = wav.length - 44;
    if (!Number.isSafeInteger(op.completion_bytes) || op.completion_bytes !== dataBytes)
      throw new Error('طول التسجيل لا يطابق طول الصوت المكتمل في خادم Sawtak.');
    // Provider sends streaming WAV with placeholder sizes; finalize RIFF/data lengths.
    wav.writeUInt32LE(dataBytes + 36, 4);
    wav.writeUInt32LE(dataBytes, 40);
    let finishedAudio=wav;
    let speedApplied=speed===1;
    if(speed<1) {
      try { finishedAudio=await stretchWav(wav,speed);speedApplied=true; }
      catch(e){console.warn('Sawtak speed adjustment unavailable; delivering original WAV:',String(e?.message||e));}
    }
    res.writeHead(200, {
      'X-Sawtak-Speed-Applied': speedApplied ? 'true' : 'false',
      'Content-Type': 'audio/wav',
      'Content-Disposition': `attachment; filename="sawtak_iraqi_${Date.now()}.wav"`,
      'Content-Length': finishedAudio.length,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(finishedAudio);
  } catch (e) {
    // Never retry requests automatically: a failed stream could already be chargeable.
    json(res, 502, { error: String(e?.message || e).slice(0, 400) });
  } finally { generating = false; }
}
export async function handleSawtak(req, res, pathname) {
  if (pathname === '/api/sawtak/status' && req.method === 'GET') {
    return json(res, 200, { configured: ENABLED, maxChars: MAX_CHARS, format: 'wav',
      detail: setupStatus(), diagnostics: {
        apiKeyPresent: Boolean(API_KEY.trim()),
        passwordPresent: Boolean(APP_PASSWORD),
        passwordMeetsMinimum: APP_PASSWORD.length >= 12
      } });
  }
  if (!['/api/sawtak/voices', '/api/sawtak/generate', '/api/sawtak/account'].includes(pathname)) return json(res, 404, { error: 'المسار غير موجود.' });
  if (!gate(req, res)) return;
  if (pathname === '/api/sawtak/account' && req.method === 'GET') return accountSummary(res);
  if (pathname === '/api/sawtak/voices' && req.method === 'GET') {
    try { return json(res, 200, { voices: await listVoices() }); }
    catch (e) { return json(res, 502, { error: String(e?.message || e).slice(0, 300) }); }
  }
  if (pathname === '/api/sawtak/generate' && req.method === 'POST') return generate(req, res);
  return json(res, 405, { error: 'الطريقة غير مدعومة.' });
}
