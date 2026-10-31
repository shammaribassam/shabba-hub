# شبّة أبو البسم — الموقع الموحّد

مستودع مستقل يجمع الديوان الشعري وتحديات أبو البسم تحت رابط واحد. نسختا GitHub الأصليتان وخدمتا Render القديمتان لا تتغيران.

بعد رفع هذه الملفات، ينسخ GitHub Actions مشروعي:
- `shammaribassam/diwan-abu-albasm` → `games/diwan`
- `shammaribassam/shabba-abu-albasm` → `games/quiz`

وذلك يشمل أسئلة الديوان والتحديات والصور والأصوات.

## التشغيل على Render
أنشئ **Web Service** جديدًا واختَر هذا المستودع والفرع `main`.
Build Command: `npm install`، Start Command: `npm start`.
لا تعدل خدمات Render القديمة.

المسارات:
- `/`: صفحة اختيار المجلس.
- `/diwan/streamer.html` و `/diwan/viewer.html`: الديوان.
- `/quiz/streamer.html` و `/quiz/viewer.html`: التحديات.

أثناء النشر، قد تحتاج إعادة إعداد متغيرات البيئة وربط Kick webhook للدومين الجديد. لا تضع Client Secret في المستودع. يجب تجربة ربط Twitch وKick وTikTok بعد النشر.
