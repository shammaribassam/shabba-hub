تحديث TikTok لشبّة أبو البسم

ارفع الملفات الأربعة التالية إلى جذر المستودع على GitHub:
package.json و server.js و tiktok-server.js و tiktok-client.js
ثم افتح streamer.html في GitHub وأضف قبل </body> السطر:
<script src="tiktok-client.js"></script>

مهم: في streamer.js يوجد كود قديم يجعل زر TikTok وهميًا. لا يلزم حذفه لأن tiktok-client.js يحمل بعده ويستبدل سلوك الزرين.

تأكد من ضبط ADMIN_KEY في Render وأنك أدخلته في لوحة الستريمر.
قد تفشل المكتبة غير الرسمية في الاتصال بسبب تغييرات TikTok أو قيود الشبكة، ويجب اختبار بث فعلي.
