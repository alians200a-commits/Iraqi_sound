'use strict';
const $ = id => document.getElementById(id);
const area = $('script');
const player = $('player');
let voice = 'ar-IQ-BasselNeural';
let audioURL = null;
let working = false;
let serverStatus = null;
const storageKey = 'sawtak.web.v4.text';

function notify(message, error = true) {
  const m = $('message');
  m.hidden = !message;
  m.textContent = message;
  m.style.background = error ? '#3a2530' : '#173b34';
  m.style.borderColor = error ? '#7c4559' : '#387969';
  if (message) m.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function updateCount() {
  const text = area.value;
  const trimmed = text.trim();
  const charCount = text.length;
  const wordCount = trimmed ? trimmed.split(/\s+/u).length : 0;
  
  // Estimate reading time at ~130 words per minute (Arabic spoken pace)
  const estMinutes = Math.ceil(wordCount / 130);
  const timeStr = wordCount > 0 ? (estMinutes === 1 ? 'دقيقة واحدة تقريباً' : `${estMinutes.toLocaleString('ar-IQ')} دقائق تقريباً`) : '0 دقيقة';
  
  // Estimate chunks (each chunk ~1200 characters)
  const estChunks = Math.max(1, Math.ceil(charCount / 1200));
  const chunkStr = charCount > 1200 ? ` • ${estChunks.toLocaleString('ar-IQ')} مقاطع مدمجة` : '';

  $('counter').textContent = `${charCount.toLocaleString('ar-IQ')} حرف • ${wordCount.toLocaleString('ar-IQ')} كلمة • استماع: ${timeStr}${chunkStr}`;
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
  area.value = '';
  area.dispatchEvent(new Event('input'));
  area.focus();
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(area.value);
    notify('تم نسخ النص إلى الحافظة.', false);
  } catch {
    notify('حدد النص وانسخه بصورة يدوية.');
  }
});

// Short script sample
$('example').addEventListener('click', () => {
  area.value = 'هلا والله طلاب، شلونكم؟ اليوم راح نتعلم موضوع مهم بالكيمياء، وهو شلون نفرّق بين الحرارة ودرجة الحرارة. خلّونا نبدي خطوة بخطوة!';
  area.dispatchEvent(new Event('input'));
});

// Long script sample
const longSample = `هلا والله ومرحباً بيكم في هذا الدليل الصوتي الشامل عن تاريخ بغداد وتراثها المعماري الأصيل.

بغداد مو مجرد مدينة عادية، هاي عاصمة التاريخ والحضارة اللي أسسها الخليفة أبو جعفر المنصور سنة سبعمية واثنين وستين ميلادية، وبناها بشكل دائري هندسي فريد كان يسموه المدينة المدورة.

من تبدي تتمشى بشارع الرشيد من الصبح، راح تشم ريحة الچاي العراقي المهيل بكل دربونة، وتشوف الشناشيل الخشبية البغدادية اللي مزينة البيوت القديمة والمطلة على دجلة الخير. هاي الشناشيل مو بس زينة، جانت تعزل حرارة الصيف القاسية عن داخل البيت، وتوفر خصوصية تامة للعوائل البغدادية وتهوية طبيعية للمكان.

ومن تعبر للجسر القديم، يوصلك الدرب لسوق المتنبي، ملتقى الأدباء والشعراء والمثقفين من كل محافظات العراق. هنا تلقى آلاف الكتب والمخطوطات النادرة، وتسمع السوالف الحلوة بالقشلة والمقاهي العريقة مثل مقهى الشابندر.

اليوم مع التطور التقني والذكاء الاصطناعي، نكدر نوثق هاي القصص والروايات التراثية بصوت عراقي أصيل وبلهجة أهلنا، حتى تبقى الذاكرة حية وتوصل لكل جيل قادم بكل فخر واعتزاز.`;

const exampleLongBtn = $('example-long');
if (exampleLongBtn) {
  exampleLongBtn.addEventListener('click', () => {
    area.value = longSample;
    area.dispatchEvent(new Event('input'));
    notify('تم إدراج مقال عراقي طويل لتجربة تقسيم ودمج المقاطع الصوتية.', false);
  });
}

// Voice selection
for (const b of document.querySelectorAll('.voice-option')) {
  b.addEventListener('click', () => {
    voice = b.dataset.voice;
    for (const c of document.querySelectorAll('.voice-option')) {
      c.classList.toggle('active', c === b);
      c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
    }
    if (voice === 'habibi-irq' && (!serverStatus || !serverStatus.habibiConfigured)) {
      notify('تنبيه: نموذج "حبيبي IRQ" غير مفعّل حالياً؛ يتطلب ربط خدمة Python عبر المتغيرين البيئيين HABIBI_URL و HABIBI_API_KEY. يمكنك اختيار باسل أو رنا للتوليد المباشر للنصوص الطويلة.', true);
    } else {
      notify('');
    }
  });
}

// Preset tone buttons
for (const p of document.querySelectorAll('.preset-btn')) {
  p.addEventListener('click', () => {
    for (const c of document.querySelectorAll('.preset-btn')) c.classList.remove('active');
    p.classList.add('active');
    if (p.dataset.speed) {
      $('speed').value = p.dataset.speed;
      $('speed-value').textContent = Number(p.dataset.speed).toFixed(2) + '×';
    }
    if (p.dataset.pitch) {
      $('pitch').value = p.dataset.pitch;
      $('pitch-value').textContent = p.dataset.pitch + ' Hz';
    }
  });
}

$('speed').addEventListener('input', () => {
  $('speed-value').textContent = Number($('speed').value).toFixed(2) + '×';
  for (const c of document.querySelectorAll('.preset-btn')) c.classList.remove('active');
});

$('pitch').addEventListener('input', () => {
  $('pitch-value').textContent = $('pitch').value + ' Hz';
  for (const c of document.querySelectorAll('.preset-btn')) c.classList.remove('active');
});

// Audio player enhancements for long audio
const skipBack = $('skip-back');
if (skipBack) {
  skipBack.addEventListener('click', () => {
    if (player.src) player.currentTime = Math.max(0, player.currentTime - 10);
  });
}

const skipForward = $('skip-forward');
if (skipForward) {
  skipForward.addEventListener('click', () => {
    if (player.src) player.currentTime = Math.min(player.duration || 0, player.currentTime + 10);
  });
}

for (const s of document.querySelectorAll('.speed-btn')) {
  s.addEventListener('click', () => {
    for (const c of document.querySelectorAll('.speed-btn')) c.classList.remove('active');
    s.classList.add('active');
    const rate = Number(s.dataset.rate || 1);
    player.playbackRate = rate;
  });
}

// Generate action
$('generate').addEventListener('click', async () => {
  if (working) return;
  const script = area.value.trim();
  if (!script) {
    notify('اكتب النص أولاً.');
    area.focus();
    return;
  }
  if (script.length > 35000) {
    notify('الحد الأقصى هو 35,000 حرف (ما يعادل مقالاً طويلاً جداً). يرجى تقليص النص قليلاً.');
    return;
  }
  if (voice === 'habibi-irq' && (!serverStatus || !serverStatus.habibiConfigured)) {
    notify('خيار "حبيبي IRQ" غير مفعّل حالياً: يتطلب ربط خدمة Python عبر HABIBI_URL و HABIBI_API_KEY. يرجى اختيار صوت باسل أو رنا للمتابعة.', true);
    return;
  }

  working = true;
  $('generate').disabled = true;
  
  const isLong = script.length > 1200;
  $('generate-label').textContent = isLong ? 'جارِ معالجة ودمج المقاطع الصوتية...' : 'جارِ إنشاء MP3...';
  notify(isLong ? 'نص طويل: يقوم المحرك بتقسيم النص ذكياً وتوليد مقاطع باسل/رنا ودمجها معاً...' : '', false);
  forgetOldAudio();

  try {
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text: script, voice, speed: $('speed').value, pitch: $('pitch').value})
    });

    if (!r.ok) {
      let msg = `تعذّر توليد التسجيل (رمز الخطأ: ${r.status})`;
      try {
        const error = await r.json();
        if (error && error.error) msg = error.error;
      } catch {
        const txt = await r.text().catch(() => '');
        if (txt) msg = `${msg}: ${txt.slice(0, 150)}`;
      }
      throw new Error(msg);
    }

    const contentType = r.headers.get('content-type') || '';
    if (!contentType.includes('audio') && !contentType.includes('octet-stream')) {
      let preview = '';
      try { const errObj = await r.json(); preview = errObj.error || ''; } catch { preview = await r.text().catch(() => ''); }
      throw new Error(`رد الخادم ليس ملفاً صوتياً (نوع المحتوى: ${contentType || 'غير محدد'}). ${preview ? 'الرسالة: ' + preview.slice(0, 150) : ''}`);
    }

    const chunksHeader = r.headers.get('X-Audio-Chunks');
    const chunksCount = chunksHeader ? Number(chunksHeader) : 1;

    const blob = await r.blob();
    if (!blob || blob.size < 100) {
      throw new Error('الملف الصوتي المستلم فارغ أو تالف (الحجم أقل من 100 بايت).');
    }

    audioURL = URL.createObjectURL(blob);
    player.src = audioURL;
    player.playbackRate = 1.0;
    
    // Reset active speed buttons
    for (const c of document.querySelectorAll('.speed-btn')) c.classList.remove('active');
    const defaultSpeedBtn = document.querySelector('.speed-btn[data-rate="1"]');
    if (defaultSpeedBtn) defaultSpeedBtn.classList.add('active');

    $('download').href = audioURL;
    $('download').download = `sawtak_${new Date().toISOString().slice(0,10)}.mp3`;
    
    const sizeMb = (blob.size / 1048576).toFixed(2);
    const chunkNote = chunksCount > 1 ? ` • ${chunksCount.toLocaleString('ar-IQ')} مقاطع مدمجة` : '';
    $('format').textContent = `MP3 • ${sizeMb} MB${chunkNote}`;
    
    $('result').hidden = false;
    $('result').scrollIntoView({behavior:'smooth',block:'nearest'});
    notify(chunksCount > 1 ? `تم توليد الصوت بنجاح ودمج ${chunksCount} مقاطع في ملف صوتي واحد متصل!` : '', false);
  } catch(e) {
    notify(String(e.message || e));
  } finally {
    $('generate').disabled = false;
    $('generate-label').textContent = 'توليد التعليق الصوتي';
    working = false;
  }
});

// Restore saved text
try { area.value = localStorage.getItem(storageKey) || localStorage.getItem('sawtak.web.v3.text') || ''; } catch {}
updateCount();

// Check server status
fetch('/api/status', {cache:'no-store'})
  .then(r => {
    if (!r.ok) throw new Error(`Status HTTP ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('استجابة الحالة ليست بصيغة JSON');
    return r.json();
  })
  .then(data => {
    serverStatus = data;
    const versionStr = data.version ? ` (v${data.version})` : '';
    $('connection').textContent = `● المحرك متصل${versionStr}`;
    $('connection').classList.remove('error');

    const habibiBadge = $('habibi-status-text');
    if (habibiBadge) {
      if (data.habibiConfigured) {
        habibiBadge.textContent = 'نموذج Python (متصل)';
        habibiBadge.style.color = '#72d6bb';
      } else {
        habibiBadge.textContent = 'نموذج Python (معلق)';
        habibiBadge.style.color = '#c68e9a';
      }
    }
  })
  .catch(err => {
    $('connection').textContent = '● المحرك غير متصل';
    $('connection').classList.add('error');
    notify(`تعذر الاتصال بخادم الصوت: ${err.message}. تأكد من تشغيل الخادم.`);
  });

window.addEventListener('pagehide', () => { if (audioURL) URL.revokeObjectURL(audioURL); });
