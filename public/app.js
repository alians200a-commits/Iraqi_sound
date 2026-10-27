'use strict';
const $ = id => document.getElementById(id);
const script=$('script'),passcode=$('passcode'),voice=$('voice'),generate=$('generate'),notice=$('notice');
const refreshVoices=$('refresh-voices'),refreshBalance=$('refresh-balance'),player=$('player');
let activeURL=null,configured=false,maxChars=900,busy=false,pending=null,hasVoices=false;
const $money=x => x===null||x===undefined||!Number.isFinite(Number(x)) ? '—' : '$'+Number(x).toFixed(3);
const count=x => Number.isFinite(Number(x)) && x!==null ? Number(x).toLocaleString('en-US') : '—';
function show(message,isError=false){notice.hidden=!message;notice.textContent=message;notice.classList.toggle('error',isError);if(message)notice.scrollIntoView({block:'nearest',behavior:'smooth'});}
function resetConfirm(){pending=null;if(!busy)generate.textContent='توليد التسجيل العراقي WAV';}
function headers(){const code=passcode.value.trim();if(!code)throw Error('اكتب رمز دخول تطبيق صَوْتَك أولاً (مو مفتاح API).');return {'X-Sawtak-Access':code};}
async function jsonResponse(r){let data={};try{data=await r.json();}catch{throw Error('الخادم ما رجع JSON صحيح. حدّث مشروع Google AI Studio.');}if(!r.ok)throw Error(data.error||'HTTP '+r.status);return data;}
async function statusCheck(){
  const r=await fetch('/api/sawtak/status',{cache:'no-store'});const data=await jsonResponse(r);
  maxChars=data.maxChars||900;configured=data.configured===true;
  $('server-state').textContent=configured?'الخادم متصل':'الإعداد ناقص';
  if(!configured)show(data.detail||'المفتاح أو رمز الدخول ما وصل للخادم.',true);
  return configured;
}
function updateDraft(){
  $('counter').textContent=count(script.value.length)+' حرف';
  const amount=script.value.trim().length*0.05/1000;
  $('estimate').textContent='الكلفة التقريبية: '+$money(amount);
  try{localStorage.setItem('sawtak-v6-draft',script.value);}catch{}
  resetConfirm();
}
script.addEventListener('input',updateDraft);
$('clear').addEventListener('click',()=>{script.value='';updateDraft();script.focus();});
$('example').addEventListener('click',()=>{script.value='هلا والله شباب، شلونكم؟ اليوم عدنا موضوع مهم، وراح نشرحه بطريقة سهلة وبسيطة. خليكم ويانه للنهاية.';updateDraft();});
passcode.addEventListener('input',resetConfirm);
voice.addEventListener('change',resetConfirm);
$('enhance').addEventListener('change',resetConfirm);
$('speed').addEventListener('input',()=>{$('speed-label').textContent=Number($('speed').value).toFixed(2)+'×';resetConfirm();});
async function loadVoices(){
  if(!await statusCheck())return;
  try{
    refreshVoices.disabled=true;show('جارِ جلب الأصوات العراقية...');
    const r=await fetch('/api/sawtak/voices',{headers:headers(),cache:'no-store'});
    const data=await jsonResponse(r);
    if(!Array.isArray(data.voices)||!data.voices.length)throw Error('ما لگينا أصوات عراقية متاحة لحسابك.');
    const prev=voice.value;
    voice.replaceChildren();
    for(const v of data.voices){
      const option=document.createElement('option');option.value=v.id;
      option.textContent=v.name+' — '+(v.dialect||'عراقي')+(v.gender?' • '+v.gender:'');
      voice.append(option);
    }
    if([...voice.options].some(x=>x.value===prev))voice.value=prev;
    else {try{const saved=localStorage.getItem('sawtak-v6-voice');if([...voice.options].some(x=>x.value===saved))voice.value=saved;}catch{}}
    hasVoices=true;show('لقينا '+data.voices.length+' صوت عراقي. اختار الصوت واضبط السرعة.',false);
    try{localStorage.setItem('sawtak-v6-voice',voice.value);}catch{}
  }catch(e){show(String(e.message||e),true);}finally{refreshVoices.disabled=false;}
}
refreshVoices.addEventListener('click',loadVoices);
voice.addEventListener('change',()=>{try{localStorage.setItem('sawtak-v6-voice',voice.value);}catch{}});
function putStat(id,val){$(id).textContent=val;}
async function updateBalance(){
  if(!await statusCheck())return;
  try{
    refreshBalance.disabled=true;
    $('balance-info').textContent='جارِ قراءة الرصيد والاستهلاك...';
    const r=await fetch('/api/sawtak/account',{headers:headers(),cache:'no-store'});
    const data=await jsonResponse(r);
    putStat('balance',$money(data.balanceUsd));
    putStat('used-month',$money(data.spent30dUsd));
    putStat('used-total',$money(data.spent730dUsd));
    putStat('used-month-chars',count(data.used30dCharacters)+' حرف');
    putStat('used-total-chars',count(data.used730dCharacters)+' حرف');
    putStat('remaining',count(data.estimatedRemainingCharacters));
    const time=new Date(data.updatedAt).toLocaleString('ar-IQ');
    $('balance-info').textContent=(data.usageError?'تعذر قراءة سجل الاستهلاك: '+data.usageError+'. ':'')+'آخر تحديث: '+time+'. الرصيد فعلي، والحروف المتبقية تقديرية.';
  }catch(e){$('balance-info').textContent='تعذر جلب الرصيد: '+String(e.message||e);}
  finally{refreshBalance.disabled=false;}
}
refreshBalance.addEventListener('click',updateBalance);
generate.addEventListener('click',async()=>{
  if(busy)return;
  try{
    if(!await statusCheck())return;
    const text=script.value.trim();
    if(!text)throw Error('اكتب سكربت أولاً.');
    if(text.length>maxChars)throw Error('الحد لحماية الرصيد '+maxChars+' حرف بالمحاولة.');
    if(!hasVoices||!voice.value)throw Error('اضغط جلب الأصوات العراقية، وبعدها اختار صوت.');
    const auth=headers(),speed=Number($('speed').value);
    const signature=JSON.stringify([text,voice.value,passcode.value,$('enhance').checked,speed]);
    if(!pending||pending.signature!==signature||Date.now()>pending.expires){
      pending={signature,expires:Date.now()+120000};
      generate.textContent='تأكيد التوليد واستهلاك الرصيد';
      show('للتأكيد: راح نولّد '+text.length+' حرفاً، بكلفة تقريبية '+$money(text.length*0.05/1000)+'. اضغط الزر مرة ثانية؛ ما انرسل طلب مدفوع لحد الآن.');
      return;
    }
    pending=null;busy=true;generate.disabled=true;generate.textContent='جارِ إنشاء التسجيل...';
    show('انرسل الطلب. لا تعيد الضغط حتى تظهر النتيجة؛ الطلب قد يستهلك من رصيدك.');
    $('result').hidden=true;
    const r=await fetch('/api/sawtak/generate',{
      method:'POST',headers:{...auth,'Content-Type':'application/json'},
      body:JSON.stringify({text,voice:voice.value,enhancePronunciation:$('enhance').checked,speed})
    });
    if(!r.ok){const data=await r.json().catch(()=>({}));throw Error(data.error||'فشل التوليد HTTP '+r.status);}
    const mime=r.headers.get('content-type')||'';
    if(!mime.includes('audio/wav'))throw Error('الاستجابة مو ملف WAV.');
    const applied=r.headers.get('x-sawtak-speed-applied')==='true';
    const blob=await r.blob(),head=new Uint8Array(await blob.slice(0,12).arrayBuffer());
    if(blob.size<48||String.fromCharCode(...head.slice(0,4))!=='RIFF'||String.fromCharCode(...head.slice(8,12))!=='WAVE')throw Error('الملف المستلم مو WAV كامل.');
    if(activeURL)URL.revokeObjectURL(activeURL);
    activeURL=URL.createObjectURL(blob);
    player.src=activeURL;player.playbackRate=applied?1:speed;
    if('preservesPitch' in player)player.preservesPitch=true;
    $('download').href=activeURL;
    $('download').download='sawtak_iraqi_'+new Date().toISOString().slice(0,10)+'.wav';
    $('format').textContent='WAV • '+(blob.size/1048576).toFixed(2)+' MB';
    $('result').hidden=false;
    $('speed-info').textContent=applied?
      'تم حفظ التسجيل بسرعة '+speed.toFixed(2)+'× مع الحفاظ على النبرة.' :
      'خادم الاستضافة ما وفّر معالجة السرعة: الاستماع هنا أبطأ، لكن الملف المحمّل يبقى بسرعته الأصلية. للناتج الأبطأ فعّل FFmpeg على الخادم.';
    show('تم توليد الملف بنجاح. تگدر تسمعه وتحمله أدناه.',false);
    $('result').scrollIntoView({behavior:'smooth',block:'nearest'});
    void updateBalance();
  }catch(e){show(String(e.message||e),true);}
  finally{busy=false;generate.disabled=false;generate.textContent=pending?'تأكيد التوليد واستهلاك الرصيد':'توليد التسجيل العراقي WAV';}
});
window.addEventListener('pagehide',()=>{if(activeURL)URL.revokeObjectURL(activeURL);});
try{script.value=localStorage.getItem('sawtak-v6-draft')||localStorage.getItem('sawtak.web.v3.text')||'';}catch{}
updateDraft();
statusCheck().catch(e=>{ $('server-state').textContent='الخادم غير متصل';show(String(e.message||e),true);});
