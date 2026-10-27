'use strict';
const $ = id => document.getElementById(id);
const area = $('script');
let voice = 'ar-IQ-BasselNeural';
let audioURL = null;
let working = false;
const storageKey = 'sawtak.web.v3.text';

function notify(message, error = true) {
  const m = $('message');
  m.hidden = !message;
  m.textContent = message;
  m.style.background = error ? '#3a2530' : '#173b34';
  m.style.borderColor = error ? '#7c4559' : '#387969';
  if (message) m.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function updateCount() {
  const trimmed = area.value.trim();
  $('counter').textContent = `${area.value.length.toLocaleString('ar-IQ')} حرف • ${(trimmed ? trimmed.split(/\s+/u).length : 0).toLocaleString('ar-IQ')} كلمة`;
}
function forgetOldAudio() {
  if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
  $('result').hidden = true;
}
area.addEventListener('input', () => {
  updateCount();
  try { localStorage.setItem(storageKey, area.value); } catch {}
});
$('clear').addEventListener('click', () => {
  area.value = ''; area.dispatchEvent(new Event('input')); area.focus();
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(area.value); notify('تم نسخ النص.', false); }
  catch { notify('حدد النص وانسخه بصورة يدوية.'); }
});
$('example').addEventListener('click', () => {
  area.value = 'هلا والله طلاب، شلونكم؟ اليوم راح نتعلم موضوع مهم بالكيمياء، وهو شلون نفرّق بين الحرارة ودرجة الحرارة. خلّونا نبدي خطوة بخطوة!';
  area.dispatchEvent(new Event('input'));
});
for (const b of document.querySelectorAll('.voice-option')) {
  b.addEventListener('click', () => {
    voice = b.dataset.voice;
    for (const c of document.querySelectorAll('.voice-option')) {
      c.classList.toggle('active', c === b);
      c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
    }
  });
}
$('speed').addEventListener('input', () => $('speed-value').textContent = Number($('speed').value).toFixed(2) + '×');
$('pitch').addEventListener('input', () => $('pitch-value').textContent = $('pitch').value + ' Hz');

$('generate').addEventListener('click', async () => {
  if (working) return;
  if (!area.value.trim()) { notify('اكتب النص أولاً.'); area.focus(); return; }
  if (area.value.trim().length > 4500) { notify('قسّم السكربت إلى مقاطع لا تزيد عن 4500 حرف لكل مقطع.'); return; }
  working = true;
  $('generate').disabled = true;
  $('generate-label').textContent = 'جارِ إنشاء MP3...';
  notify('');
  forgetOldAudio();
  try {
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text: area.value, voice, speed: $('speed').value, pitch: $('pitch').value})
    });
    if (!r.ok) {
      let msg = 'تعذّر توليد التسجيل.';
      try { const error = await r.json(); msg = error.error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await r.blob();
    if (blob.type && !blob.type.includes('audio')) throw new Error('الاستجابة مو ملف صوتي.');
    audioURL = URL.createObjectURL(blob);
    $('player').src = audioURL;
    $('download').href = audioURL;
    $('download').download = `sawtak_${new Date().toISOString().slice(0,10)}.mp3`;
    $('format').textContent = `MP3 • ${(blob.size/1048576).toFixed(2)} MB`;
    $('result').hidden = false;
    $('result').scrollIntoView({behavior:'smooth',block:'nearest'});
  } catch(e) {
    notify(String(e.message || e));
  } finally {
    $('generate').disabled = false;
    $('generate-label').textContent = 'توليد التعليق الصوتي';
    working = false;
  }
});
try { area.value = localStorage.getItem(storageKey) || ''; } catch {}
updateCount();
fetch('/api/status', {cache:'no-store'}).then(r => {if (!r.ok) throw Error(); return r.json();}).then(() => {
  $('connection').textContent = '● المحرك متصل';
  $('connection').classList.remove('error');
}).catch(() => {
  $('connection').textContent = '● المحرك غير متصل';
  $('connection').classList.add('error');
  notify('الخادم الصوتي مو متصل. افتح رابط التطبيق المنشور، مو ملف HTML وحده.');
});
window.addEventListener('pagehide', () => {if (audioURL) URL.revokeObjectURL(audioURL);});
