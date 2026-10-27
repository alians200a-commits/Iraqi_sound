// Sawtak Arabi module: the user enters the app PASSCODE, never the provider API key.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const status = $('sawtak-status');
  const passcode = $('sawtak-passcode');
  const voices = $('sawtak-voices');
  const load = $('sawtak-load');
  const go = $('sawtak-generate');
  const info = $('sawtak-notice');
  const result = $('sawtak-result');
  let maxChars = 900;
  let audioUrl;
  let busy = false;
  let configured = false;
  // Keep buttons clickable so users see a real explanation instead of silence.
  load.disabled = false;
  go.disabled = false;
  function message(s, bad = false) {
    info.textContent = s;
    info.style.color = bad ? '#ffb6b9' : '#90e2cb';
  }
  function auth() {
    const secret = passcode.value.trim();
    if (!secret) throw new Error('أدخل رمز دخول التطبيق أولاً. هذا مو مفتاح Sawtak Arabi.');
    return {'X-Sawtak-Access': secret};
  }
  async function expectJson(response) {
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    return json;
  }
  async function check() {
    try {
      const r = await fetch('/api/sawtak/status', { cache: 'no-store' });
      const json = await expectJson(r);
      maxChars = json.maxChars || 900;
      configured = json.configured === true;
      if (!configured) {
        status.textContent = 'غير مفعّل: الخادم ما قرأ كل الأسرار المطلوبة';
        status.style.color = '#ffd59b';
        message(json.detail || 'تحقق من SAWTAK_API_KEY ومن رمز دخول 12 حرفاً أو أكثر، ثم أعد تشغيل الخادم.', true);
      } else {
        status.textContent = 'الخادم مهيأ — اضغط جلب الأصوات';
        status.style.color = '#90e2cb';
      }
      return configured;
    } catch (error) {
      configured = false;
      status.textContent = 'الخادم غير متصل';
      message('الخادم لا يرجع حالة Sawtak الصحيحة. افتح نسخة الخادم المحدثة وأعد نشر التطبيق. ' + String(error.message || ''), true);
      return false;
    }
  }
  load.addEventListener('click', async () => {
    try {
      load.disabled = true;
      if (!await check()) return;
      message('جارِ جلب الأصوات العراقية من Sawtak Arabi...');
      const response = await fetch('/api/sawtak/voices', {headers: auth(), cache:'no-store'});
      const data = await expectJson(response);
      voices.replaceChildren();
      if (!data.voices.length) throw new Error('ما لگينا أصوات عراقية جاهزة في صفحات المكتبة الحالية. راجع الأصوات في موقع الخدمة أو تأكد من صلاحية الحساب.');
      for (const voice of data.voices) {
        const el = document.createElement('option');
        el.value = voice.id;
        el.textContent = `${voice.name} — ${voice.dialect || 'عراقي'}${voice.gender ? ' • ' + voice.gender : ''}`;
        voices.append(el);
      }
      voices.disabled = false;
      go.disabled = false;
      message(`لقينا ${data.voices.length} صوتاً عراقياً جاهزاً. اختار واحد وجرّب نص قصير.`);
    } catch (e) { message(e.message || String(e), true); }
    finally { load.disabled = false; }
  });
  go.addEventListener('click', async () => {
    if (busy) return;
    if (!await check()) return;
    const text = $('script').value.trim();
    if (!text) return message('اكتب السكربت في خانة الكتابة الرئيسية أولاً.', true);
    if (text.length > maxChars) return message(`الحد لحماية الرصيد ${maxChars} حرف. جرّب نصاً أقصر.`, true);
    if (!voices.value) return message('حمّل الأصوات واختار صوتاً أولاً.', true);
    if (!window.confirm(`هذا الطلب قد يخصم من رصيد Sawtak Arabi. هل تريد توليد ${text.length} حرفاً الآن؟`)) return;
    busy = true; go.disabled = true;
    message('جارِ توليد الملف والتحقق من اكتماله...');
    result.hidden = true;
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    try {
      const response = await fetch('/api/sawtak/generate', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({text, voice: voices.value, enhancePronunciation: $('sawtak-enhance').checked})
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `فشل التوليد (HTTP ${response.status}).`);
      }
      const type = response.headers.get('content-type') || '';
      if (!type.includes('audio/wav')) throw new Error('الخادم ما رجّع ملف WAV.');
      const blob = await response.blob();
      const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      if (blob.size < 48 || String.fromCharCode(...header.slice(0, 4)) !== 'RIFF') throw new Error('التسجيل المستلم غير صالح.');
      audioUrl = URL.createObjectURL(blob);
      $('sawtak-player').src = audioUrl;
      const a = $('sawtak-download');
      a.href = audioUrl;
      a.download = `sawtak_arabi_${new Date().toISOString().slice(0,10)}.wav`;
      result.hidden = false;
      message(`✅ تم توليد WAV كامل (${(blob.size / 1048576).toFixed(2)} MB). اسمعه قبل التحميل.`);
      result.scrollIntoView({ behavior:'smooth', block:'nearest' });
    } catch (e) { message(e.message || String(e), true); }
    finally { busy = false; go.disabled = false; }
  });
  window.addEventListener('pagehide', () => {if(audioUrl) URL.revokeObjectURL(audioUrl);});
  check();
})();
