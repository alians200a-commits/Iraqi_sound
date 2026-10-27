# صَوْتَك v4 — إصلاح إخراج الصوت + Habibi-TTS IRQ

مشروع واجهة ويب RTL للموبايل والحاسبة، متصل بخادم **Node.js**. يعرض محركين:

- **Edge-TTS**: باسل العراقي `ar-IQ-BasselNeural` ورنا العراقية `ar-IQ-RanaNeural` بصيغة MP3 من خدمة Microsoft الخارجية (توافر الخدمة وقيود الاستخدام غير مضمونين).
- **Habibi-TTS**: نموذج `Specialized/IRQ` الحقيقي مفتوح المصدر **Apache 2.0**. خيار الواجهة مُدمج، لكن يستلزم خدمة Python مستقلة باستضافة مناسبة. يعطي WAV، أو MP3 إذا توفر ffmpeg. النموذج نفسه غير مرفوع على GitHub بسبب الحجم.

## حل الخطأ «الاستجابة مو ملف صوتي»

في v3 كانت الواجهة تفحص رد `/api/generate` بعد `HTTP 200` فقط، وقد تستقبل HTML من معاينة Google AI Studio بدل MP3. في v4:

1. يتم التحقق أن `GET /api/status` يُعيد **JSON** خاص بخادم صوتك، مو صفحة HTML.
2. يتم فحص نوع الملف **ومحتواه الصوتي**. الخطأ الآن يوضح إن كانت المعاينة ترجع HTML أو خدمة خارجية معطلة.
3. تُولد نتائج Edge من محرك مستقل لكل طلب، مع رسالة عن قيود خدمة Edge.
4. زر Habibi يوضح أنه غير مفعّل إذا لم يتصل بخادمه، بدلاً من الادعاء بتوليد وهمي.

**مهم:** نجاح فحص حالة `/api/status` ما يثبت إمكانية توليد الصوت من خدمة خارجية؛ تحتاج تجربة توليد فعلية.

## التشغيل على Node.js

```bash
npm install
npm start
```

افتح `http://localhost:8080`. الخادم يستمع إلى متغير `PORT` المخصص للاستضافة.

### ربط Habibi الحقيقي

شغّل `habibi_service/` على خادم Python مستقل؛ تعليماته في [`habibi_service/README.md`](habibi_service/README.md). أضف متغيرات سرية **للخادم Node.js فقط**:

- `HABIBI_URL=https://your-habibi-python-server`
- `HABIBI_API_KEY=long-private-secret`

وبنفس المفتاح على خادم Python. لا تضعها في واجهة العميل. يمكن تشغيل الخدمة على سيرفر فيه GPU؛ Google AI Studio Preview ما يشغّل نموذج PyTorch بنفسه.

## Google AI Studio Build

1. افتح المشروع المستورد من GitHub في Google AI Studio Build.
2. تأكد أنه يشغّل **الخادم `server.mjs`** (`npm start`) مع واجهته، وأن `/api/status` يُعيد JSON `{ "app": "sawtak", "version": "4.0.0" }`. مجرد ظهور الصفحة داخل Preview مو كافي.
3. إذا `/api/status` رجع HTML فمعناه مسار API رايح إلى خادم المعاينة بدل Node. اطلب من Build ضبط توجيه المسارات أو انشر التطبيق على استضافة Node مثل Cloud Run، ثم جرّب من رابط النشر.
4. لمحرّك Habibi، أنشئ خادم Python منفصلاً واربط عنوانه ومفتاحه ضمن **server-side environment variables** قبل تفعيل الزر.
5. المشروع الموجود في GitHub **كود وليس استضافة منشورة**. لا نضمن إن Google AI Studio Preview يسمح بالاتصال الخارجي بـ Edge أو بخدمة Python.

## الاختبار

`npm run check` يفحص صياغة JS. `python -m py_compile habibi_service/server.py` يفحص Python. الاختبار الفعلي للصوت يتطلب وصولاً حقيقياً إلى المحركات/تثبيتاً على خوادم مناسبة.

الترخيص: كود واجهة صوتك من تطويرنا. كود Habibi upstream MIT، وأوزان `Specialized/IRQ` برخصة Apache 2.0، مع احترام الرخص والمصدر الأصلي: https://github.com/SWivid/Habibi-TTS.
