/**
 * Sawtak Arabi REST integration. No API key is returned to the browser.
 * Explicit app passphrase protects prepaid credits on public deployments.
 * WAV is only returned after operation completion and PCM byte verification.
 * Node.js >= 20; no additional dependencies.
 */
import { timingSafeEqual, randomUUID } from 'node:crypto';

const BASE = 'https://api.sawtakarabi.ai/v1';
const API_KEY = process.env.SAWTAK_API_KEY || '';
const APP_PASSWORD = process.env.SAWTAK_APP_PASSWORD || '';
const ENABLED = Boolean(API_KEY && APP_PASSWORD.length >= 12);
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
async function generate(req, res) {
  if (generating) return json(res, 429, { error: 'يوجد طلب قيد التوليد. حاول بعد اكتماله.' });
  let payload;
  try { payload = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const text = String(payload.text || '').trim();
  const voice = String(payload.voice || '');
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
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Disposition': `attachment; filename="sawtak_iraqi_${Date.now()}.wav"`,
      'Content-Length': wav.length,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(wav);
  } catch (e) {
    // Never retry requests automatically: a failed stream could already be chargeable.
    json(res, 502, { error: String(e?.message || e).slice(0, 400) });
  } finally { generating = false; }
}
export async function handleSawtak(req, res, pathname) {
  if (pathname === '/api/sawtak/status' && req.method === 'GET') {
    return json(res, 200, { configured: ENABLED, maxChars: MAX_CHARS, format: 'wav',
      detail: ENABLED ? 'جاهز للاختبار بعد إدخال رمز دخول التطبيق.' : 'مفتاح الخدمة أو كلمة مرور التطبيق غير مضبوطة على الخادم.' });
  }
  if (!['/api/sawtak/voices', '/api/sawtak/generate'].includes(pathname)) return json(res, 404, { error: 'المسار غير موجود.' });
  if (!gate(req, res)) return;
  if (pathname === '/api/sawtak/voices' && req.method === 'GET') {
    try { return json(res, 200, { voices: await listVoices() }); }
    catch (e) { return json(res, 502, { error: String(e?.message || e).slice(0, 300) }); }
  }
  if (pathname === '/api/sawtak/generate' && req.method === 'POST') return generate(req, res);
  return json(res, 405, { error: 'الطريقة غير مدعومة.' });
}
