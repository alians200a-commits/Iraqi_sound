import { handleSawtak } from './sawtak-arabi.mjs';
/**
 * Sawtak cloud server (for Google AI Studio/Cloud Run or any Node hosting).
 * Server returns MP3 directly without saving audio or text to disk.
 * Security note: a public Cloud Run deployment should add proper authentication
 * if it must be private. Basic limits here are not a substitute for auth.
 */
import http from 'node:http';
import {handleHabibi} from './habibi_gateway.mjs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const { generateSecMsGecToken_V2, SEC_MS_GEC_VERSION_V2, TRUSTED_CLIENT_TOKEN, CHROMIUM_FULL_VERSION } = require('node-edge-tts/dist/drm.js');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const MAX_CHARS = 4500;
const VOICES = Object.freeze({
  'ar-IQ-BasselNeural': 'باسل — صوت عراقي رجالي',
  'ar-IQ-RanaNeural': 'رنا — صوت عراقي نسائي'
});
const FILES = new Map([
  ['/sawtak-arabi.js', ['public/sawtak-arabi.js', 'text/javascript; charset=utf-8']],
  ['/sawtak-arabi.css', ['public/sawtak-arabi.css', 'text/css; charset=utf-8']],
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/habibi.js', ['public/habibi.js', 'text/javascript; charset=utf-8']],
  ['/chunker.mjs', ['public/chunker.mjs', 'text/javascript; charset=utf-8']],
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

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return c;
    }
  });
}

async function synthesizeAudio(text, voice, options = {}) {
  const token = generateSecMsGecToken_V2();
  const connId = crypto.randomUUID().replace(/-/g, '');
  const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION_V2}&ConnectionId=${connId}`;

  const ws = new WebSocket(url, {
    headers: {
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0`
    }
  });

  return new Promise((resolve, reject) => {
    const audioChunks = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('انتهت مهلة الاتصال بالخدمة الصوتية.'));
    }, options.timeout || 35000);

    ws.on('open', () => {
      const configMsg = 'Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
      ws.send(configMsg);

      const rate = options.rate || '+0%';
      const pitch = options.pitch || '+0Hz';
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='ar-IQ'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
      const requestId = crypto.randomUUID().replace(/-/g, '');
      const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
      ws.send(ssmlMsg);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const headerLen = data.readUInt16BE(0);
        const audioData = data.subarray(2 + headerLen);
        if (audioData.length > 0) audioChunks.push(audioData);
      } else {
        const textMsg = data.toString('utf8');
        if (textMsg.includes('Path:turn.end')) {
          clearTimeout(timer);
          ws.close();
          resolve(Buffer.concat(audioChunks));
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('unexpected-response', (req, res) => {
      clearTimeout(timer);
      reject(new Error(`استجابة غير متوقعة من خادم الصوت: ${res.statusCode}`));
    });
  });
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
    const buffer = await synthesizeAudio(script, voice, {
      rate,
      pitch: pitchS,
      timeout: 50000
    });
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
    if (pathname.startsWith('/api/sawtak/')) {
      await handleSawtak(req, res, pathname);
      return;
    }
    if ((req.method === 'GET' && pathname === '/api/habibi/status') || (req.method === 'POST' && pathname === '/api/habibi/generate')) {
      await handleHabibi(req, res, pathname);
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && FILES.has(pathname)) {
      const [relative, type] = FILES.get(pathname);
      const bytes = await readFile(path.join(ROOT, relative));
      res.writeHead(200, {'Content-Type': type, 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff'});
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(bytes);
      }
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/status') {
      if (req.method === 'HEAD') {
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        return res.end();
      }
      return sendJson(res, 200, {ok: true, server: 'cloud', voices: VOICES, maxChars: MAX_CHARS});
    }
    if (req.method === 'POST' && pathname === '/api/generate') {
      const origin = req.headers.origin;
      // Requests from an unrelated website are rejected; not full authentication.
      if (origin) {
        try {
          const site = new URL(origin);
          const allowedHost = req.headers['x-forwarded-host'] || req.headers.host;
          if (site.host !== allowedHost && !site.host.endsWith('.run.app') && !site.host.includes('localhost') && !site.host.includes('127.0.0.1')) {
            return sendJson(res, 403, {error: 'الطلب من موقع مختلف غير مسموح.'});
          }
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
