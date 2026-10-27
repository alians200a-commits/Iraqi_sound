'use strict';
const $ = id => document.getElementById(id);
const area = $('script');
let voice = 'ar-IQ-BasselNeural';
let audioURL = null;
let working = false;
let engine = 'edge';
let habibiConfigured = false;
const storageKey = 'sawtak.web.v3.text';

function notify(message, error = true) {
  const m = $('message');
  m.hidden = !message;
  m.textContent = message;
  m.style.background = error ? '#3a2530' : '#173b34';
  m.style.borderColor = error ? '#7c4559' : '#387969';
  if (message) m.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
function count() {
  const value = area.value;
  $('counter').textContent = `${value.length.toLocaleString('ar-IQ')} حرف • ${(value.trim() ? value.trim().split(/\s+/u).length : 0).toLocaleString('ar-IQ')} كلمة`;
}
function clearAudio() {
  $('player').pause();
  $('player').removeAttribute('src');
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = null;
  $('result').hidden = true;
}
function setEngine(newEngine) {
  const changed = engine !== newEngine;
  engine = newEngine;
  document.querySelectorAll('.engine-option').forEach(b => {
    const on = b.dataset.engine === engine;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const isHabibi = engine === 'habibi';
  $('edge-voices').hidden = isHabibi;
  $('pitch-controls').hidden = isHabibi;
  $('engine-note').textContent = isHabibi
    ? (habibiConfigured
      ? 'Habibi-TTS: النموذج العراقي Specialized/IRQ مربوط بالخادم. يعتمد على عينة عراقية مرجعية ويعيد WAV أو MP3 حسب تجهيز الخدمة.'
      : 'Habibi-TTS العراقي أُضيف للكود لكنه يحتاج تشغيل خدمة Python مستقلة. ما راح يولّد صوت إلى أن تربط HABIBI_URL في الاستضافة.')
    : 'Edge-TTS: صوتا باسل ورنا عبر خدمة Microsoft. يحتاج خادماً Node.js واتصالاً خارجياً؛ مو تشغيل محلي.';
  $('terms').textContent = isHabibi
    ? 'Habibi: حد 850 حرف للمقطع. نموذج مستقل يحتاج خادماً مناسباً؛ الوقت والموارد يعتمدون على العتاد. النبرة تتحدد بالعينة المرجعية مو شريط Pitch.'
    : 'حد 4500 حرف بالمقطع. الخدمة الخارجية قد تفرض حدوداً. يتم إرسال النص إلى خدمة Microsoft.';
  $('generate').disabled = working || (isHabibi && !habibiConfigured);
  $('generate-label').textContent = isHabibi && !habibiConfigured ? 'Habibi يحتاج ربط خادم النموذج' : 'توليد التعليق الصوتي';
  if (changed) clearAudio();
}
async function checkBackend() {
  try {
    const response = await fetch('/api/status', {cache: 'no-store'});
    const mime = response.headers.get('content-type') || '';
    if (!response.ok || !mime.includes('application/json')) throw new Error('المعاينة رجّعت HTML بدل API');
    const status = await response.json();
    if (status.app !== 'sawtak' || !status.ok || !status.edge || !status.habibi) throw new Error('رد /api/status مو تابع لخادم صَوْتَك v4');
    habibiConfigured = Boolean(status.habibi.configured);
    $('connection').textContent = '● خادم Node متصل';
    $('connection').classList.remove('error');
    setEngine(engine);
  } catch (error) {
    $('connection').textContent = '● API غير متصل';
    $('connection').classList.add('error');
    $('generate').disabled = true;
    notify('خادم الصوت مو متصل أو Google AI Studio يرجّع صفحة معاينة بدل /api/status. لا يكفي عرض الواجهة: لازم تشغيل server.mjs كخادم Node.js، أو نشره على استضافة Node وربطه بنفس عنوان الواجهة.');
  }
}
area.addEventListener('input', () => {count(); try {localStorage.setItem(storageKey, area.value);} catch {}});
$('clear').addEventListener('click', () => {area.value = ''; area.dispatchEvent(new Event('input')); area.focus();});
$('copy').addEventListener('click', async () => {
  try {await navigator.clipboard.writeText(area.value); notify('تم نسخ النص.', false);} catch {notify('حدد النص وانسخه يدوياً.');}
});
$('example').addEventListener('click', () => {
  area.value = 'هلا والله طلاب، شلونكم؟ اليوم راح نتعلم موضوع مهم بالكيمياء، وهو شلون نفرّق بين الحرارة ودرجة الحرارة. خلّونا نبدي خطوة بخطوة!';
  area.dispatchEvent(new Event('input'));
});
document.querySelectorAll('.engine-option').forEach(b => b.addEventListener('click', () => setEngine(b.dataset.engine)));
document.querySelectorAll('.voice-option').forEach(b => b.addEventListener('click', () => {
  voice = b.dataset.voice;
  document.querySelectorAll('.voice-option').forEach(c => {
    c.classList.toggle('active', c === b);
    c.setAttribute('aria-pressed', String(c === b));
  });
}));
$('speed').addEventListener('input', () => {$('speed-value').textContent = Number($('speed').value).toFixed(2) + '×';});
$('pitch').addEventListener('input', () => {$('pitch-value').textContent = $('pitch').value + ' Hz';});

async function parseError(response) {
  const mime = response.headers.get('content-type') || '';
  if (mime.includes('application/json')) {
    try {const object = await response.json(); return object.error || `فشل الطلب HTTP ${response.status}`;} catch {}
  }
  if (mime.includes('text/html')) {
    return `الاستضافة رجّعت صفحة HTML بدل الصوت (HTTP ${response.status}). الطلب /api/generate ما وصل إلى خادم Node.js. تأكد من إعداد Google AI Studio وربط الخادم أو جرّب النشر.`;
  }
  return `تعذر التوليد: HTTP ${response.status}، نوع الاستجابة: ${mime || 'غير محدد'}.`;
}
function validAudio(bytes, type) {
  if (bytes.length < 128) return false;
  const mp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  const wav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
  return (type.includes('audio/mpeg') && mp3) || (type.includes('audio/wav') && wav);
}
$('generate').addEventListener('click', async () => {
  if (working) return;
  const text = area.value.trim();
  if (!text) {notify('اكتب السكربت أولاً.'); area.focus(); return;}
  if (text.length > (engine === 'habibi' ? 850 : 4500)) {notify(`هذا المحرك يقبل ${engine === 'habibi' ? 850 : 4500} حرف بالمقطع.`); return;}
  if (engine === 'habibi' && !habibiConfigured) {notify('خادم Habibi يحتاج إعداد HABIBI_URL أولاً.'); return;}
  working = true;
  $('generate').disabled = true;
  $('generate-label').textContent = 'جارِ التوليد...';
  clearAudio();
  notify('');
  try {
    const response = await fetch('/api/generate', {
      method: 'POST', headers: {'Content-Type': 'application/json', 'Accept': 'audio/*,application/json'},
      body: JSON.stringify({text, engine, voice, speed: Number($('speed').value), pitch: Number($('pitch').value)})
    });
    if (!response.ok) throw new Error(await parseError(response));
    const mime = (response.headers.get('content-type') || '').toLowerCase();
    if (!mime.includes('audio/mpeg') && !mime.includes('audio/wav')) {
      throw new Error(await parseError(response));
    }
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!validAudio(bytes, mime)) throw new Error('الملف المستلم مو MP3 أو WAV صحيح. راجع سجل الخادم الصوتي.');
    const ext = mime.includes('mpeg') ? 'mp3' : 'wav';
    audioURL = URL.createObjectURL(new Blob([bytes], {type: mime}));
    $('player').src = audioURL;
    $('download').href = audioURL;
    $('download').download = `sawtak_${engine}_${new Date().toISOString().slice(0,10)}.${ext}`;
    $('download').textContent = `↓ تنزيل التسجيل ${ext.toUpperCase()}`;
    $('format').textContent = `${ext.toUpperCase()} • ${(bytes.length/1048576).toFixed(2)} MB`;
    $('result').hidden = false;
    $('result').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  } catch (error) {
    notify(String(error?.message || error));
  } finally {working = false; setEngine(engine);}
});
try {area.value = localStorage.getItem(storageKey) || '';} catch {}
count();
setEngine('edge');
checkBackend();
window.addEventListener('pagehide', () => {if (audioURL) URL.revokeObjectURL(audioURL);});
