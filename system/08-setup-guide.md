# دليل الإعداد — خطوة بخطوة

هذا الدليل لصاحب المشروع: كل ما تحتاج إنشاءه وربطه حتى يعمل «سعي».
اتبع الترتيب. كل خطوة فيها ✅ تحققت منها بنفسك.

> 🔐 **قاعدة ذهبية**: المفاتيح السرية (service_role، Gemini، R2) **لا تُكتب أبداً** في الكود أو في GitHub أو في التطبيق.
> مكانها فقط: أسرار GitHub (Settings ← Secrets) التي تنقلها تلقائياً لأسرار Supabase. المفتاح الوحيد المسموح في التطبيق ولوحة التحكم هو `anon key` (عام بطبيعته ومحمي بـ RLS).

## قائمة سريعة
| # | الخطوة | الوقت | مطلوب لـ |
|---|---|---|---|
| ١ | مشروع Supabase + قاعدة البيانات | ١٥ د | كل شيء |
| ٢ | تسجيل الدخول بـ Google | ١٥ د | كل شيء |
| ٣ | جعل نفسك أدمن | ٢ د | لوحة التحكم |
| ٤ | مفتاح Gemini | ٣ د | المساعد الذكي، تصوير الأسئلة، الاختبارات |
| ٥ | التخزين (Supabase Storage — تلقائي) | ٠ د | الملازم، الصور، تصوير الأسئلة |
| ٦ | أسرار GitHub + رفع الدوال (من المتصفح) | ٥ د | كل ما سبق |
| ٧ | الموقع ولوحة التحكم (Firebase Hosting) | ٢ د | إدارة التطبيق + صفحة التنزيل |
| ٨ | بناء ملف APK | ٢٠ د | الطلاب |
| ٩ | الإشعارات (Firebase) | ١٠ د | الإشعارات والتطبيق مغلق |
| ١٠ | إبقاء Supabase نشطاً | ٣ د | منع توقف المشروع المجاني |

---

## ١. Supabase — قاعدة البيانات
1. ادخل https://supabase.com وأنشئ حساباً (يمكن بحساب GitHub).
2. **New project**:
   - Name: `saey`
   - Database password: كلمة سر قوية **واحفظها**.
   - Region: **Central EU (Frankfurt)** — الأقرب للعراق.
   - Plan: Free.
3. بعد الإنشاء: **SQL Editor**. نفّذ ١١ ملفاً **بالترتيب**، لكل ملف:
   - افتح الملف على GitHub ← اضغط زر **Raw** (يعرض النص الخام فقط).
   - اضغط **Ctrl+A** ثم **Ctrl+C** (حتى يُنسخ الملف كاملاً).
   - في Supabase: **New query** (صفحة فارغة) ← **Ctrl+V** ← تأكد أن آخر سطر في الملف ظاهر ← **Run**.
   - يجب أن تظهر **Success**. ⚠️ لا تحدد جزءاً من النص قبل Run (Supabase ينفّذ المحدد فقط).

   | # | الملف (في `supabase/migrations/`) |
   |---|---|
   | ١ | `20261005000001_types_users.sql` |
   | ٢ | `20261005000002_content.sql` |
   | ٣ | `20261005000003_student_data.sql` |
   | ٤ | `20261005000004_chat_ai.sql` |
   | ٥ | `20261005000005_logic_users.sql` |
   | ٦ | `20261005000006_logic_events.sql` |
   | ٧ | `20261005000007_rpc.sql` |
   | ٨ | `20261005000008_rls_core.sql` |
   | ٩ | `20261005000009_rls_activity.sql` |
   | ١٠ | `20261005000010_storage.sql` |
   | ١١ | `supabase/seed.sql` (المدرسة، الشعب، المواد، الإعدادات) |

   > كل الملفات **آمنة لإعادة التشغيل**: إذا فشل ملف أو شككت أنه نُسخ ناقصاً، أعد تشغيله ولن يتكرر أو يتلف شيء.
   > بديل أسهل بلا نسخ (إذا جهّزت الحاسوب في الخطوة ٦): `npx supabase db push` ينفّذ ١–١٠ تلقائياً، ثم شغّل `seed.sql` فقط.
4. ✅ تحقق: **Table Editor** ← جدول `subjects` فيه ٨ مواد.
5. احفظ من **Project Settings ← API**:
   - `Project URL` (مثل `https://abcd.supabase.co`)
   - `anon public` key
   - `Project ref` (الجزء `abcd` من الرابط)

## ٢. تسجيل الدخول بحساب Google
### أ) في Google Cloud
1. ادخل https://console.cloud.google.com ← أنشئ مشروعاً اسمه `saey`.
2. **APIs & Services ← OAuth consent screen**: نوع External، اسم التطبيق «سعي»، بريدك. احفظ. ثم **Publish app** (حتى يدخل أي طالب).
3. **Credentials ← Create credentials ← OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `https://<Project ref>.supabase.co/auth/v1/callback`
4. انسخ **Client ID** و **Client secret**.

### ب) في Supabase
1. **Authentication ← Sign In / Providers ← Google**: فعّله والصق Client ID و Client secret. احفظ.
2. **Authentication ← URL Configuration**:
   - **Site URL**: `https://saeyiq.web.app/saey-dashboard/`
   - **Redirect URLs** أضف:
     - `saey://auth-callback` (التطبيق)
     - `exp://**` (للتجربة عبر Expo Go)
     - `http://localhost:5173` (لوحة التحكم محلياً)
     - `https://saeyiq.web.app/saey-dashboard/`

## ٣. اجعل نفسك أدمن
1. سجّل الدخول مرة واحدة (من التطبيق أو لوحة التحكم) — سيقول إنك بانتظار الموافقة، هذا طبيعي.
2. في **SQL Editor** شغّل (ضع بريدك واسمك):
   ```sql
   update public.profiles
   set role = 'admin', status = 'approved', is_verified = true, onboarded = true,
       full_name = 'اسمك الثلاثي',
       section_id = (select id from public.sections where name = 'أ')
   where id = (select id from auth.users where email = 'بريدك@gmail.com');
   ```
3. ✅ الآن لك شارة التوثيق وكل الصلاحيات. بعدها كل الطلاب تقبلهم من لوحة التحكم.

## ٤. مفتاح Gemini (مجاني)
1. ادخل https://aistudio.google.com/apikey بحسابك.
2. **Create API key** ← في مشروع جديد. انسخه.
3. ⚠️ مفتاح واحد فقط. الحد المجاني لكل مشروع؛ لا تنشئ حسابات متعددة لتجاوزه (مخالف للشروط).

## ٥. التخزين — Supabase Storage (تلقائي، بلا بطاقة)
الملازم والصور تُحفظ في Supabase Storage (حاوية `files` خاصة، تُنشأ تلقائياً). المجاني: ١ جيجا، وأقصى ملف ٥٠ ميغا.
عندما تكبر المساحة: أنشئ حساباً في Backblaze B2 أو Cloudflare R2 وأضف الأسرار
`R2_ACCESS_KEY_ID` و `R2_SECRET_ACCESS_KEY` و `R2_BUCKET` و (`R2_ACCOUNT_ID` لـ R2، أو `S3_ENDPOINT` و `S3_REGION` لـ B2)
ثم شغّل Deploy Supabase — الملفات الجديدة تذهب إليه تلقائياً بلا تغيير في التطبيق.

## ٦. رفع دوال الخادم وإضافة الأسرار — من موقع GitHub فقط (بلا حاسوب ولا طرفية)
ملف `.github/workflows/deploy-supabase.yml` يرفع كل الدوال، ويضع أسرارها، ويربط الإشعارات بقاعدة البيانات تلقائياً.
كل ما عليك: تضيف الأسرار في GitHub مرة واحدة.

**أ) مفتاح الوصول من Supabase**
1. https://supabase.com/dashboard/account/tokens ← **Generate new token** ← الاسم `github` ← انسخه (يظهر مرة واحدة).

**ب) أضف الأسرار في GitHub**
المستودع ← **Settings ← Secrets and variables ← Actions ← New repository secret** — أضف كل واحد باسمه الدقيق:

| الاسم | القيمة | مطلوب لـ |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | المفتاح من (أ) | **ضروري** لكل شيء |
| `PUSH_WEBHOOK_SECRET` | أي كلمة عشوائية طويلة تخترعها (حروف وأرقام إنكليزية، ٣٠ حرفاً مثلاً) | الإشعارات |
| `GEMINI_API_KEY` | من الخطوة ٤ | المساعد، تصوير الأسئلة، الاختبارات |
| `FCM_SERVICE_ACCOUNT` | محتوى ملف JSON من Firebase (الخطوة ٩-٤) — افتحه بالمفكرة وانسخ كل النص | الإشعارات |
| `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET` | من الخطوة ٥ | الملازم والصور |

تقدر تضيف الأسرار على مراحل: كل سر غير موجود يُتخطى بلا أخطاء.

**ج) شغّل الرفع**
المستودع ← **Actions ← Deploy Supabase ← Run workflow** (اختر الفرع `claude/repository-name-arabic-iegosv`) ← **Run workflow**.
بعد دقيقتين تقريباً تظهر علامة ✅ خضراء. (يعمل تلقائياً أيضاً كلما تغيّر كود الدوال.)

✅ تحقق: في Supabase ← **Edge Functions** تظهر ٧ دوال: `files` `ai-chat` `ocr` `ingest` `quiz` `push` `youtube-meta`.

> ⚠️ **لا تنشئ Database Webhooks يدوياً** من لوحة Supabase: الربط صار تلقائياً (migration رقم ١١)، والاثنان معاً يكرران كل إشعار.
> إذا كنت أنشأتها سابقاً: Supabase ← Database ← Webhooks ← احذف `push-notifications` و `push-messages`.

## ٧. الموقع ولوحة التحكم على Firebase Hosting (تلقائي)
- الموقع التعريفي: **https://saeyiq.web.app**
- لوحة التحكم: **https://saeyiq.web.app/saey-dashboard**
- يُنشران تلقائياً من سير عمل `deploy-site.yml` عند أي تعديل في `apps/site` أو `apps/admin` (أو Actions ← Deploy Site ← Run workflow).
- يستخدم نفس السر `FCM_SERVICE_ACCOUNT`. إذا فشل النشر بخطأ صلاحيات: Google Cloud ← IAM ← حساب `firebase-adminsdk-…` ← أضف دور **Firebase Hosting Admin**.
- **مرة واحدة**: Supabase ← Authentication ← URL Configuration ← Redirect URLs ← أضف `https://saeyiq.web.app/saey-dashboard/` (حتى يعمل تسجيل الدخول بـ Google في اللوحة).
- رابط زر التنزيل: GitHub ← Settings ← Secrets and variables ← Actions ← تبويب **Variables**: `DOWNLOAD_URL` (و`DOWNLOAD_VERSION` و`DOWNLOAD_SIZE_MB` اختيارياً).

## ٨. تطبيق الهاتف (ملف APK)
### تجربة سريعة بدون بناء (Expo Go)
```bash
cp apps/mobile/.env.example apps/mobile/.env   # واملأ القيمتين
npm run mobile:start
```
ثبّت تطبيق **Expo Go** على هاتفك وامسح رمز QR. (كل شيء يعمل عدا الإشعارات الفورية.)

### بناء APK حقيقي للطلاب
1. أنشئ حساباً مجانياً في https://expo.dev
2. ```bash
   cd apps/mobile
   npx eas-cli login
   npx eas-cli init          # يربط المشروع ويضيف projectId تلقائياً
   ```
3. أضف المفتاحين العامّين لبيئة البناء: افتح `apps/mobile/eas.json` وداخل `"preview"` أضف:
   ```json
   "env": {
     "EXPO_PUBLIC_SUPABASE_URL": "https://xxxx.supabase.co",
     "EXPO_PUBLIC_SUPABASE_ANON_KEY": "eyJ..."
   }
   ```
   (هذان المفتاحان عامّان ومحميّان بـ RLS، فلا بأس بوجودهما في الملف.)
4. ```bash
   npx eas-cli build -p android --profile preview
   ```
5. بعد ~١٥ دقيقة يعطيك رابط تحميل **APK** — شاركه مع الطلاب (يحتاجون السماح بـ «تثبيت من مصادر غير معروفة»).

## ٩. الإشعارات الفورية (Firebase) — بلا حساب Expo
التطبيق يتصل بـ Firebase مباشرة. بدون هذه الخطوة لا تصل الإشعارات والتطبيق مغلق
(داخل التطبيق تظهر بطاقة الرسالة الجديدة دائماً).
1. https://console.firebase.google.com ← **Create a project** ← الاسم `saey` ← (Google Analytics: غير ضروري) ← Create.
2. في صفحة المشروع اضغط أيقونة **Android** (Add app):
   - Android package name: `com.saey.app` (بالضبط)
   - **Register app** ← حمّل الملف `google-services.json`.
3. افتح `google-services.json` بالمفكرة، انسخ كل النص، وأضفه سراً في GitHub باسم **`GOOGLE_SERVICES_JSON`**
   (نفس مكان أسرار الخطوة ٦-ب). بناء APK القادم سيضمّه تلقائياً.
4. Firebase ← ⚙️ **Project settings ← Service accounts ← Generate new private key** ← يُحمّل ملف JSON ثانٍ.
   افتحه بالمفكرة، انسخ كل النص، وأضفه سراً في GitHub باسم **`FCM_SERVICE_ACCOUNT`**.
5. تأكد أن السر `PUSH_WEBHOOK_SECRET` موجود (الخطوة ٦-ب)، ثم شغّل **Actions ← Deploy Supabase ← Run workflow**.
6. شغّل بناء APK جديد: **Actions ← Build APK ← Run workflow**، وثبّت النسخة الجديدة.
7. في التطبيق: **الإعدادات ← الإشعارات** شغّلها (إن كانت مطفأة) واسمح بالإشعارات.

✅ تحقق: أرسل رسالة من حساب آخر وهاتفك مقفل ← يصل إشعار «سعي».

## ١٠. إبقاء Supabase نشطاً
المشروع المجاني يتوقف بعد ٧ أيام بلا نشاط (مثلاً في العطلة). يوجد ملف GitHub Action جاهز يزوره كل ٣ أيام:
- GitHub ← المستودع ← **Settings ← Secrets and variables ← Actions ← New repository secret**:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

## ١١. إصدار نسخة جديدة للطلاب — تلقائي (مرة واحدة فقط)
بعد هذا الإعداد: كل بناء APK يُنشر وحده في مستودع عام، والموقع يتحدث وحده، والتطبيق (من apk-19 فما بعد) يعرض «تحديث جديد متاح».
**أ) مستودع عام للنسخ:**
1. GitHub ← زر **+** أعلى اليمين ← **New repository**.
2. Repository name: `saey-releases` ← اختر **Public** ← ضع علامة على **Add a README file** ← **Create repository**.

**ب) مفتاح يسمح بالنشر فيه:**
1. صورتك أعلى اليمين ← **Settings** ← أسفل القائمة اليسرى **Developer settings** ← **Personal access tokens ← Fine-grained tokens** ← **Generate new token**.
2. Token name: `saey-releases` · Expiration: **No expiration** (أو أطول مدة متاحة).
3. Repository access: **Only select repositories** ← اختر `saey-releases` فقط.
4. Permissions ← Repository permissions ← **Contents** ← **Read and write** ← **Generate token** ← انسخه (يظهر مرة واحدة).
5. مستودع المشروع (الخاص) ← **Settings ← Secrets and variables ← Actions ← New repository secret**:
   الاسم `RELEASES_TOKEN` والقيمة المفتاح.

**ج) جرّب:** Actions ← **Build APK** ← Run workflow. بعد انتهائه (~٢٥ دقيقة):
- `saey-releases` ← Releases فيه `apk-<رقم>`.
- الموقع يعرض الرقم الجديد بعد دقائق، والتطبيق يعرض «تحديث جديد متاح».
> إن اسم المستودع غير `saey-releases` أو صاحبه غير `dagg-iq`: أضف متغيراً (Variables لا Secrets) باسم `RELEASES_REPO` قيمته `اسمك/اسم-المستودع`.
> إن كان عندك متغير `DOWNLOAD_URL` في Variables احذفه، فهو يغطي على الرابط التلقائي.
> Dropbox لم يعد مطلوباً.

---

## ١٢. مفاتيح Gemini الإضافية ومفتاح YouTube
**أ) مفاتيح Gemini للطلاب (حتى ٤):** كل مفتاح من **حساب Google مختلف** (مشروع منفصل بحصته الخاصة).
1. افتح https://aistudio.google.com/apikey بحساب Google الثاني ← **Create API key** ← (مشروع جديد) ← انسخ المفتاح.
2. GitHub ← Settings ← Secrets and variables ← Actions ← **New repository secret**:
   الاسم `GEMINI_API_KEY_2` والقيمة المفتاح. كرر للحساب الثالث `GEMINI_API_KEY_3` والرابع `GEMINI_API_KEY_4`.
   (`GEMINI_API_KEY` الأصلي هو الأول، و `GEMINI_ADMIN_API_KEY` للوحة التحكم.)
> ⚠️ Google تمنع في شروطها «توزيع الحصة على عدة مشاريع». الخطر: إيقاف بعض المفاتيح. لذلك:
> لا تستخدم حساب Gmail الأساسي لك في المفاتيح الإضافية، والتطبيق يتجاوز أي مفتاح موقوف تلقائياً.

**ب) مفتاح YouTube (مجاني) — لسحب قوائم التشغيل في «مساعد المحتوى»:**
1. https://console.cloud.google.com ← اختر أي مشروع (أو أنشئ واحداً) ← في البحث أعلى الصفحة اكتب **YouTube Data API v3** ← **Enable**.
2. القائمة ← **APIs & Services ← Credentials ← Create credentials ← API key** ← انسخه.
3. GitHub Secret باسم `YOUTUBE_API_KEY`.

**ج) بعد إضافة أي سر:** GitHub ← Actions ← **Deploy Supabase** ← Run workflow (ينقل الأسرار ويطبّق تحديثات قاعدة البيانات).

## بعد الإعداد: أول محتوى
**الأسهل: «مساعد المحتوى»** في لوحة التحكم:
- **محاضرات يوتيوب**: الصق رابط قائمة التشغيل أو قناة الأستاذ ← «اسحب ورتّب» ← راجع الجدول (المادة، الفصل، الأستاذ، الرقم) ← «إضافة». مع خيار «فهرسة بالدقيقة» يشاهد الذكاء الاصطناعي كل فيديو ويستخرج مواضيعه ووقتها.
- **ملازم وكتب PDF**: اسحب عدة ملفات معاً ← يقرأ أول صفحاتها ويقترح كل شيء ← «حفظ» ← تُفهرس للمساعد (حتى المصوّرة).
> حدود مجانية: يوتيوب في Gemini حوالي ٨ ساعات فيديو يومياً. إن ظهر «انتهى الرصيد» أكمل غداً من زر «فهرسة» في صفحة المحاضرات.

أو يدوياً من لوحة التحكم:
1. **المواد والفصول**: أضف فصول كل مادة (العربي له جزءان جاهزان).
2. **الأساتذة**: أضف أساتذة اليوتيوب.
3. **المحاضرات**: الصق روابط يوتيوب (عدة روابط دفعة واحدة).
4. **الملازم**: ارفع PDF ← ثم اضغط **فهرسة** ليعرفها المساعد الذكي.
5. **الواجبات والامتحانات**: أضف مواعيد امتحانات الشهر الأول ← تظهر عند كل طالب مع العدّاد.
6. **الطلاب**: اقبل طلبات زملائك.

## حل المشاكل الشائعة
| المشكلة | الحل |
|---|---|
| بعد الدخول بـ Google لا يرجع للتطبيق | تأكد من `saey://auth-callback` في Redirect URLs |
| «إعداد غير مكتمل» | ملف `.env` ناقص أو لم تُعِد تشغيل التطبيق/البناء |
| فشل رفع الملزمة في لوحة التحكم | الملف أكبر من ٥٠ ميغا (اضغطه)، أو سير عمل Deploy Supabase فشل في «Storage self-test» |
| التحديث داخل التطبيق لا يظهر | رقم النسخة في `apps/site/download-config.json` لم يُحدَّث بعد رفع الملف على Dropbox |
| المنبّه لا يرنّ والتطبيق مغلق | شاشة المؤقت ← «لم يرنّ؟» ← سعي ← «بلا قيود» للبطارية (شاومي، هواوي…) |
| «المساعد مشغول» كثيراً | انتهى الحد المجاني لـ Gemini اليوم — خفّض الحد اليومي من الإعدادات |
| الإشعارات لا تصل | خطوة ٩ كاملة، ثم Actions ← Deploy Supabase يجب أن يكون ✅، ثم ثبّت APK بُني بعد إضافة GOOGLE_SERVICES_JSON |
