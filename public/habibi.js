import {splitScript} from './chunker.mjs';
const get = id => document.getElementById(id);
const input = get('script');
const list = get('habibi-parts');
let parts = [];
let active = false;
let connected = false;
let finalUrl = null;
function message(s,error=false){
  const e=get('habibi-msg');e.hidden=!s;e.textContent=s;e.style.color=error?'#ffb9b9':'#a8d9c9';
}
function release(part){if(part?.url) URL.revokeObjectURL(part.url);}
function releaseMerged(){if(finalUrl){URL.revokeObjectURL(finalUrl);finalUrl=null;}get('habibi-result').hidden=true;}
function setAvailability(){
  get('habibi-generate').disabled = active || !connected || !parts.length;
  get('habibi-generate').textContent = active?'جارِ توليد المقاطع...':'توليد المقاطع العراقية';
  get('habibi-merge').disabled = active || !parts.length || parts.some(p=>!p.blob);
}
async function check(){
  try{
    const r=await fetch('/api/habibi/status',{cache:'no-store'});
    if(!r.ok || !(r.headers.get('content-type')||'').includes('application/json'))throw Error('API غير متوفر');
    const data=await r.json();connected=Boolean(data.configured);
    get('habibi-state').textContent=connected?'● Habibi جاهز لإرسال المقاطع':'● Habibi يحتاج ربط خادم Python';
    get('habibi-state').classList.toggle('error',!connected);
    if(!connected)message('تقدر تقسم النص وتشوف المقاطع، بس التوليد الحقيقي يحتاج تشغيل النموذج على خادم Python وربطه عبر HABIBI_URL وHABIBI_API_KEY. ماكو صوت وهمي.',true);
  }catch{
    connected=false;get('habibi-state').textContent='● خادم Habibi غير متصل';
    message('خادم Node ما يحتوي واجهة Habibi الجديدة، حدّث التطبيق وأعد تشغيله.',true);
  }
  setAvailability();
}
function render(){
  list.replaceChildren();
  get('habibi-total').textContent=`${parts.length} مقطع`;
  parts.forEach((p,i)=>{
    const item=document.createElement('article');item.className='habibi-part';
    const heading=document.createElement('div');heading.className='habibi-part-head';
    const label=document.createElement('strong');label.textContent=`المقطع ${i+1} • ${p.text.length} حرف`;
    const status=document.createElement('span');status.textContent=p.blob?'✓ تم التوليد':p.error?'⚠ فشل':'بانتظار التوليد';
    heading.append(label,status);
    const detail=document.createElement('p');detail.textContent=p.text;detail.dir='rtl';
    const tools=document.createElement('div');tools.className='habibi-part-tools';
    if(p.url){const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=p.url;tools.append(audio);}
    const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent=p.blob?'إعادة توليد هذا المقطع':'توليد هذا المقطع';
    button.disabled=active||!connected;
    button.addEventListener('click',()=>produce(i));tools.append(button);
    item.append(heading,detail,tools);list.append(item);
  });
  setAvailability();
}
function segment(){
  if(active)return;
  parts.forEach(release);parts=[];releaseMerged();
  try{
    const cleaned=input.value.replace(/\s+/gu,' ').trim();
    if(cleaned.length>6500)throw Error('حالياً الحد 6500 حرف للسكريبت الكامل حتى ما يصير ثقيل على الموبايل.');
    const items=splitScript(cleaned,170,65);
    if(items.length>42)throw Error('السكريبت يحتاج أكثر من 42 مقطع. قلل النص وجرب على دفعتين.');
    parts=items.map(text=>({text,blob:null,url:null,error:false}));
    message(parts.length?`تقسّم السكربت إلى ${parts.length} مقطع؛ تگدر تولّد كل واحد أو الكل بالتسلسل.`:'اكتب السكربت بالأعلى أولاً.',!parts.length);
  }catch(error){message(error.message,true);}
  render();
}
async function parseRemoteFailure(response){
  const mime=(response.headers.get('content-type')||'').toLowerCase();
  if(mime.includes('application/json')){try{const j=await response.json();return j.error||`HTTP ${response.status}`;}catch{}}
  if(mime.includes('text/html'))return 'خادم النشر رجّع HTML بدل الصوت. تحقق من مسارات API.';
  return `خادم الصوت رجّع ${mime||'استجابة غير معروفة'} (${response.status})`;
}
async function synth(index){
  const part=parts[index];
  const response=await fetch('/api/habibi/generate',{
    method:'POST',headers:{'Content-Type':'application/json','Accept':'audio/*,application/json'},
    body:JSON.stringify({text:part.text,speed:1})
  });
  if(!response.ok)throw Error(await parseRemoteFailure(response));
  const mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(!['audio/mpeg','audio/wav'].includes(mime))throw Error(await parseRemoteFailure(response));
  const blob=await response.blob();
  const head=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  const mp3=head[0]===73&&head[1]===68&&head[2]===51 || (head[0]===255&&(head[1]&224)===224);
  const wav=head[0]===82&&head[1]===73&&head[2]===70&&head[3]===70&&head[8]===87&&head[9]===65;
  if(blob.size<128||(!mp3&&!wav))throw Error('الناتج مو تسجيل WAV/MP3 صالح.');
  release(part);part.blob=blob;part.url=URL.createObjectURL(blob);part.error=false;
}
async function produce(index){
  if(active||!connected)return;
  active=true;releaseMerged();setAvailability();
  const isSingle=Number.isInteger(index);
  const numbers=isSingle?[index]:parts.map((_,i)=>i);
  for(const i of numbers){
    message(`جارِ توليد المقطع ${i+1} من ${parts.length}...`);
    try{await synth(i);}catch(error){parts[i].error=true;message(`المقطع ${i+1}: ${error.message}. تگدر تعيد توليده وحده.`,true);render();break;}
    render();
  }
  active=false;render();
  if(parts.every(p=>p.blob))message('اكتملت المقاطع. اضغط دمج وتحميل WAV أو أعد توليد مقطع ما عجبك.');
}
function writeWav(audioBuffers,sampleRate){
  const silence=Math.round(sampleRate*0.12);
  const length=audioBuffers.reduce((n,b)=>n+b.length,0)+Math.max(0,audioBuffers.length-1)*silence;
  if(length>sampleRate*900)throw Error('التسجيل أطول من 15 دقيقة، قلّل السكربت.');
  const bytes=new ArrayBuffer(44+length*2),view=new DataView(bytes);
  const string=(offset,s)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
  string(0,'RIFF');view.setUint32(4,36+length*2,true);string(8,'WAVE');string(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);string(36,'data');view.setUint32(40,length*2,true);
  let idx=44;
  for(let j=0;j<audioBuffers.length;j++){
    const buffer=audioBuffers[j];
    for(let i=0;i<buffer.length;i++){
      let v=0;for(let c=0;c<buffer.numberOfChannels;c++)v+=buffer.getChannelData(c)[i]/buffer.numberOfChannels;
      v=Math.max(-1,Math.min(1,v));view.setInt16(idx,v<0?v*32768:v*32767,true);idx+=2;
    }
    if(j<audioBuffers.length-1){idx+=silence*2;}
  }
  return new Blob([bytes],{type:'audio/wav'});
}
async function merge(){
  if(active||parts.length===0||parts.some(p=>!p.blob))return;
  active=true;releaseMerged();setAvailability();message('جارِ دمج التسجيلات على موبايلك...');
  let context;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)throw Error('متصفحك ما يدعم دمج الصوت. استخدم Chrome حديث.');
    context=new Ctx({sampleRate:24000});
    const buffers=[];
    for(const p of parts){const source=await p.blob.arrayBuffer();buffers.push(await context.decodeAudioData(source.slice(0)));}
    const output=writeWav(buffers,context.sampleRate);
    finalUrl=URL.createObjectURL(output);
    get('habibi-player').src=finalUrl;
    get('habibi-download').href=finalUrl;
    get('habibi-download').download=`sawtak_habibi_iraqi_${new Date().toISOString().slice(0,10)}.wav`;
    get('habibi-size').textContent=`WAV • ${(output.size/1048576).toFixed(2)} MB`;
    get('habibi-result').hidden=false;
    message('تم الدمج بدون إرسال المقاطع لخدمة إضافية. الملف النهائي WAV.');
  }catch(error){message('فشل دمج الصوت: '+error.message,true);}
  finally{if(context)await context.close().catch(()=>{});active=false;render();}
}
get('habibi-split').addEventListener('click',segment);
get('habibi-generate').addEventListener('click',()=>produce());
get('habibi-merge').addEventListener('click',merge);
window.addEventListener('pagehide',()=>{parts.forEach(release);releaseMerged();});
setAvailability();check();
