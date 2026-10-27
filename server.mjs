/**
 * Sawtak cloud server (for Google AI Studio/Cloud Run or any Node hosting).
 * Server returns MP3 directly without saving audio or text to disk.
 * Security note: a public Cloud Run deployment should add proper authentication
 * if it must be private. Basic limits here are not a substitute for auth.
 */
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EdgeTTS } from '@andresaya/edge-tts';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';
const MAX_CHARS = 4500;
const SERVICE = new EdgeTTS();
const VOICES = Object.freeze({
  'ar-IQ-BasselNeural': 'باسل — صوت عراقي رجالي',
  'ar-IQ-RanaNeural': 'رنا — صوت عراقي نسائي'
});
const FILES = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['public/manifest.webmanifest', 'application/manifest+json']],
  ['/icons/icon-192.png', ['public/icons/icon-192.png', 'image/png']],
  ['/icons/icon-512.png', ['public/icons/icon-512.png', 'image/png']]
]);
const counters = new Map();
let active = 0;
const MAX_CONCURRENT = 2;

function sendJson(res, status, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': data.length
  });
  res.end(data);
}
async function bodyJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) {
    const e = new Error('الطلب لازم يكون JSON.'); e.httpStatus = 415; throw e;
  }
  let count = 0;
  const chunks = [];
  for await (const piece of req) {
    count += piece.length;
    if (count > 24000) { const e = new Error('حجم الطلب كبير.'); e.httpStatus = 413; throw e; }
    chunks.push(piece);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const e = new Error('تعذر قراءة النص المُرسل.'); e.httpStatus = 400; throw e; }
}
function throttled(ip) {
  const now = Date.now();
  if (counters.size > 2000) counters.clear();
  let c = counters.get(ip);
  if (!c || now - c.start > 60_000) c = {start: now, count: 0};
  c.count += 1;
  counters.set(ip, c);
  return c.count > 8;
}
async function generate(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (throttled(ip)) return sendJson(res, 429, {error: 'وصلت حد الحماية المؤقت (8 طلبات بالدقيقة)، جرّب بعد دقيقة.'});
  if (active >= MAX_CONCURRENT) return sendJson(res, 429, {error: 'المحرك مشغول حالياً. حاول مجدداً بعد اكتمال الطلب الحالي.'});
  const input = await bodyJson(req);
  const script = String(input.text ?? '').trim();
  const voice = String(input.voice || 'ar-IQ-BasselNeural');
  const speed = Number(input.speed ?? 1);
  const pitch = Number(input.pitch ?? 0);
  if (!script) return sendJson(res, 400, {error: 'اكتب السكربت أولاً.'});
  if (script.length > MAX_CHARS) return sendJson(res, 400, {error: `الحد الآمن للمقطع الواحد ${MAX_CHARS} حرف. قسم السكربت إلى مقاطع.`});
  if (!Object.hasOwn(VOICES, voice)) return sendJson(res, 400, {error: 'الصوت المحدد غير متاح.'});
  if (!Number.isFinite(speed) || speed < 0.7 || speed > 1.3 || !Number.isFinite(pitch) || pitch < -30 || pitch > 30) {
    return sendJson(res, 400, {error: 'قيم سرعة ونبرة الصوت خارج النطاق.'});
  }
  active += 1;
  try {
    const rateN = Math.round((speed - 1) * 100);
    const rate = `${rateN >= 0 ? '+' : ''}${rateN}%`;
    const pitchS = `${pitch >= 0 ? '+' : ''}${Math.round(pitch)}Hz`;
    const audio = await SERVICE.generate(script, voice, {
      rate, pitch: pitchS, timeout: 50000,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });
    const buffer = Buffer.from(audio?.audio || []);
    if (buffer.length < 100) throw new Error('لم يصل ملف صوتي من الخدمة.');
    const filename = `sawtak_${Date.now()}.mp3`;
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': buffer.length
    });
    res.end(buffer);
  } catch (e) {
    sendJson(res, 502, {error: `تعذر توليد الصوت من الخدمة الخارجية: ${String(e?.message || e).slice(0, 180)}`});
  } finally { active -= 1; }
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && FILES.has(pathname)) {
      const [relative, type] = FILES.get(pathname);
      const bytes = await readFile(path.join(ROOT, relative));
      res.writeHead(200, {'Content-Type': type, 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff'});
      res.end(bytes);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/status') {
      return sendJson(res, 200, {ok: true, server: 'cloud', voices: VOICES, maxChars: MAX_CHARS});
    }
    if (req.method === 'POST' && pathname === '/api/generate') {
      const origin = req.headers.origin;
      // Requests from an unrelated website are rejected; not full authentication.
      if (origin) {
        try {
          const site = new URL(origin);
          if (site.host !== req.headers.host) return sendJson(res, 403, {error: 'الطلب من موقع مختلف غير مسموح.'});
        } catch { return sendJson(res, 403, {error: 'مصدر الطلب غير صحيح.'}); }
      }
      return await generate(req, res);
    }
    return sendJson(res, 404, {error: 'الرابط غير موجود.'});
  } catch (e) {
    if (!res.headersSent) sendJson(res, e.httpStatus || 500, {error: e.httpStatus ? e.message : 'حدث خطأ داخل الخادم.'});
  }
});
server.requestTimeout = 120_000;
server.listen(PORT, HOST, () => console.log(`Sawtak Cloud ready on port ${PORT}`));
