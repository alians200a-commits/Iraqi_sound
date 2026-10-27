/** Sawtak v4 – Node.js HTTP backend for Edge TTS and optional Habibi IRQ worker. */
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EdgeTTS } from '@andresaya/edge-tts';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const MAX_CHARS_EDGE = 4500;
const MAX_CHARS_HABIBI = 850; // Local model is more resource-intensive
const MAX_CONCURRENT = 2;
const HABIBI_URL = String(process.env.HABIBI_URL || '').replace(/\/+$/, '');
const HABIBI_API_KEY = process.env.HABIBI_API_KEY || '';
const VOICES = Object.freeze({
  'ar-IQ-BasselNeural': 'باسل — عراقي رجالي',
  'ar-IQ-RanaNeural': 'رنا — عراقية نسائية'
});
const FILES = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['public/manifest.webmanifest', 'application/manifest+json']],
  ['/icons/icon-192.png', ['public/icons/icon-192.png', 'image/png']],
  ['/icons/icon-512.png', ['public/icons/icon-512.png', 'image/png']]
]);
let active = 0;
const counters = new Map();
function json(res, status, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Length': data.length
  });
  res.end(data);
}
function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json'))
    throw fail('صيغة الطلب لازم تكون JSON.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 24576) throw fail('حجم الطلب كبير.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail('ما نكدر نقرأ طلب التوليد.', 400); }
}
function rateLimited(ip) {
  const now = Date.now();
  if (counters.size > 3000) counters.clear();
  let entry = counters.get(ip);
  if (!entry || now - entry.start > 60000) entry = { start: now, count: 0 };
  entry.count++;
  counters.set(ip, entry);
  return entry.count > 8;
}
function isMp3(buf) {
  return buf.length > 128 && (
    buf.subarray(0, 3).toString('ascii') === 'ID3' ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  );
}
function isWav(buf) {
  return buf.length > 44 && buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE';
}
async function edgeGenerate(text, voice, speed, pitch) {
  if (!Object.hasOwn(VOICES, voice)) throw fail('اختار صوت باسل أو رنا.', 400);
  const rateNum = Math.round((speed - 1) * 100);
  const rate = `${rateNum >= 0 ? '+' : ''}${rateNum}%`;
  const pitchLabel = `${pitch >= 0 ? '+' : ''}${Math.round(pitch)}Hz`;
  // New object per request: no shared mutable result state.
  const result = await new EdgeTTS().generate(text, voice, {
    rate, pitch: pitchLabel, timeout: 60000,
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3'
  });
  const bytes = Buffer.from(result?.audio || []);
  if (!isMp3(bytes)) throw fail('محرك Edge ما رجّع ملف MP3 صالحاً. جرّب لاحقاً أو غيّر المحرك.', 502);
  return { bytes, mime: 'audio/mpeg', ext: 'mp3' };
}
async function habibiGenerate(text, speed) {
  if (!HABIBI_URL || !HABIBI_API_KEY) throw fail('Habibi مو مفعّل على الخادم بعد. لازم ربط خدمة Python بالنموذج العراقي وإضافة HABIBI_URL وHABIBI_API_KEY في إعدادات الاستضافة.', 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 280000);
  try {
    const response = await fetch(`${HABIBI_URL}/generate`, {
      method: 'POST', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(HABIBI_API_KEY ? { 'Authorization': `Bearer ${HABIBI_API_KEY}` } : {})
      },
      body: JSON.stringify({ text, speed })
    });
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      if (type === 'application/json') {
        try { const value = await response.json(); detail = value.error || detail; } catch {}
      }
      throw fail(`خادم Habibi: ${String(detail).slice(0, 240)}`, response.status === 429 ? 429 : 502);
    }
    if (!['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mpeg'].includes(type)) {
      throw fail('خادم Habibi رجّع بيانات مو صوت. تحقق من عنوان HABIBI_URL وتشغيل Python.', 502);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (type === 'audio/mpeg' && isMp3(bytes)) return {bytes, mime: 'audio/mpeg', ext: 'mp3'};
    if (type !== 'audio/mpeg' && isWav(bytes)) return {bytes, mime: 'audio/wav', ext: 'wav'};
    throw fail('ملف Habibi غير صالح أو فارغ.', 502);
  } finally { clearTimeout(timer); }
}
async function generate(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return json(res, 429, { error: 'حد الحماية: 8 طلبات بالدقيقة. جرّب بعد دقيقة.' });
  if (active >= MAX_CONCURRENT) return json(res, 429, { error: 'أكو طلبين شغالين، جرّب بعد اكتمال أحدهما.' });
  const input = await readJson(req);
  const text = String(input.text ?? '').trim();
  const engine = String(input.engine || 'edge');
  const voice = String(input.voice || 'ar-IQ-BasselNeural');
  const speed = Number(input.speed ?? 1);
  const pitch = Number(input.pitch ?? 0);
  if (!['edge', 'habibi'].includes(engine)) throw fail('المحرك المحدد غير معروف.');
  if (!text) throw fail('اكتب السكربت أولاً.');
  const limit = engine === 'habibi' ? MAX_CHARS_HABIBI : MAX_CHARS_EDGE;
  if (text.length > limit) throw fail(`حد المحرك ${limit} حرف للمقطع. قسّم السكربت.`);
  if (!Number.isFinite(speed) || speed < 0.7 || speed > 1.3 ||
      !Number.isFinite(pitch) || pitch < -30 || pitch > 30) throw fail('السرعة أو النبرة خارج المجال.');
  active++;
  try {
    const result = engine === 'habibi'
      ? await habibiGenerate(text, speed)
      : await edgeGenerate(text, voice, speed, pitch);
    res.writeHead(200, {
      'Content-Type': result.mime,
      'Content-Disposition': `attachment; filename="sawtak_${engine}_${Date.now()}.${result.ext}"`,
      'Content-Length': result.bytes.length,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(result.bytes);
  } catch (error) {
    const status = error.status || 502;
    console.error(`[sawtak] ${engine} error:`, error.message);
    json(res, status, { error: error.status ? error.message :
      (engine === 'edge'
        ? 'تعذّر الاتصال بخدمة الصوت Edge. تأكد من الإنترنت وصلاحية الاتصالات الخارجية داخل الاستضافة. إذا تستخدم Google AI Studio Preview فقد تحتاج نشر خادم Node مستقل.'
        : 'فشل توليد Habibi أو انتهت مهلة خادم Python. راجع سجلات خدمة Habibi.') });
  } finally { active--; }
}
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && FILES.has(pathname)) {
      const [relative, mime] = FILES.get(pathname);
      const bytes = await readFile(path.join(ROOT, relative));
      res.writeHead(200, {'Content-Type': mime, 'Content-Length': bytes.length,
        'X-Content-Type-Options': 'nosniff'});
      res.end(bytes);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/status') {
      return json(res, 200, {
        ok: true, app: 'sawtak', version: '4.0.0', edge: {available: true, voices: VOICES, maxChars: MAX_CHARS_EDGE},
        habibi: { configured: Boolean(HABIBI_URL && HABIBI_API_KEY), dialect: 'IRQ', model: 'Specialized', maxChars: MAX_CHARS_HABIBI }
      });
    }
    if (req.method === 'POST' && pathname === '/api/generate') {
      if (req.headers.origin) {
        try {
          const src = new URL(req.headers.origin);
          const allowed = new Set([req.headers.host, ...(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)]);
          if (!allowed.has(src.host) && !allowed.has(src.origin)) return json(res, 403, { error: 'مصدر الطلب غير مسموح. تحقق من رابط المعاينة أو ALLOWED_ORIGINS.' });
        } catch { return json(res, 403, {error: 'مصدر الطلب غير صحيح.'}); }
      }
      return await generate(req, res);
    }
    return json(res, 404, { error: `المسار ${pathname} غير متاح بالخادم الصوتي.` });
  } catch (error) {
    console.error('[sawtak] request error:', error.message);
    if (!res.headersSent) json(res, error.status || 500, {error: error.status ? error.message : 'حدث خطأ داخلي في الخادم.'});
  }
});
server.requestTimeout = 300000;
server.listen(PORT, '0.0.0.0', () => console.log(`Sawtak API v4 ready: port ${PORT}`));
