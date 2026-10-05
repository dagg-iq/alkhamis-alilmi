# دليل الإعداد — خطوة بخطوة

هذا الدليل لصاحب المشروع: كل ما تحتاج إنشاءه وربطه حتى يعمل «سعي».
اتبع الترتيب. كل خطوة فيها ✅ تحققت منها بنفسك.

> 🔐 **قاعدة ذهبية**: المفاتيح السرية (service_role، Gemini، R2) **لا تُكتب أبداً** في الكود أو في GitHub أو في التطبيق.
> مكانها فقط: أسرار Supabase (`supabase secrets set`). المفتاح الوحيد المسموح في التطبيق ولوحة التحكم هو `anon key` (عام بطبيعته ومحمي بـ RLS).

## قائمة سريعة
| # | الخطوة | الوقت | مطلوب لـ |
|---|---|---|---|
| ١ | مشروع Supabase + قاعدة البيانات | ١٥ د | كل شيء |
| ٢ | تسجيل الدخول بـ Google | ١٥ د | كل شيء |
| ٣ | جعل نفسك أدمن | ٢ د | لوحة التحكم |
| ٤ | مفتاح Gemini | ٣ د | المساعد الذكي، تصوير الأسئلة، الاختبارات |
| ٥ | Cloudflare R2 | ١٠ د | الملازم، الصور في الدردشة، تصوير الأسئلة |
| ٦ | رفع دوال الخادم + الأسرار | ١٠ د | كل ما سبق |
| ٧ | لوحة التحكم على Netlify | ١٠ د | إدارة التطبيق |
| ٨ | بناء ملف APK | ٢٠ د | الطلاب |
| ٩ | الإشعارات (Firebase) | ١٥ د | الإشعارات الفورية (اختياري في البداية) |
| ١٠ | إبقاء Supabase نشطاً | ٣ د | منع توقف المشروع المجاني |

---

## ١. Supabase — قاعدة البيانات
1. ادخل https://supabase.com وأنشئ حساباً (يمكن بحساب GitHub).
2. **New project**:
   - Name: `saey`
   - Database password: كلمة سر قوية **واحفظها**.
   - Region: **Central EU (Frankfurt)** — الأقرب للعراق.
   - Plan: Free.
3. بعد الإنشاء: **SQL Editor** ← **New query**، وانسخ والصق محتوى كل ملف واضغط **Run**، **بهذا الترتيب**:
   1. `supabase/migrations/20261005000001_core.sql`
   2. `supabase/migrations/20261005000002_logic.sql`
   3. `supabase/migrations/20261005000003_rls.sql`
   4. `supabase/migrations/20261005000004_storage.sql`
   5. `supabase/seed.sql` (المدرسة، الشعب أ–هـ، المواد الثمانية، الإعدادات)
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
   - **Site URL**: رابط لوحة التحكم (مؤقتاً `http://localhost:5173`، وبعد Netlify ضع رابطه).
   - **Redirect URLs** أضف:
     - `saey://auth-callback` (التطبيق)
     - `exp://**` (للتجربة عبر Expo Go)
     - `http://localhost:5173` (لوحة التحكم محلياً)
     - رابط Netlify لاحقاً، مثل `https://saey-admin.netlify.app`

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

## ٥. Cloudflare R2 (تخزين الملازم والصور — ١٠GB مجاناً)
1. أنشئ حساباً في https://dash.cloudflare.com
2. من القائمة **R2 Object Storage** ← فعّله.
   > ⚠️ قد يطلب Cloudflare إضافة وسيلة دفع لتفعيل R2 حتى مع الخطة المجانية. لن تُخصم أي مبالغ ما دمت تحت ١٠GB. إذا لم تستطع إضافة بطاقة، أخبر المساعد لنستخدم بديلاً.
3. **Create bucket**: الاسم `saey`، الموقع Automatic.
4. داخل الـ bucket ← **Settings ← CORS Policy** ← Edit، والصق (غيّر رابط Netlify):
   ```json
   [
     {
       "AllowedOrigins": ["https://saey-admin.netlify.app", "http://localhost:5173"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
5. ارجع لصفحة R2 ← **Manage API tokens** ← **Create API token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: `saey`
   - انسخ **Access Key ID** و **Secret Access Key**.
6. انسخ **Account ID** (يظهر في صفحة R2 على اليمين).

## ٦. رفع دوال الخادم وإضافة الأسرار
تحتاج حاسوباً عليه **Node.js 22** و **Git**.
```bash
git clone https://github.com/dagg-iq/alkhamis-alilmi.git
cd alkhamis-alilmi
git checkout claude/repository-name-arabic-iegosv   # أو main بعد الدمج
npm install

npx supabase login
npx supabase link --project-ref <Project ref>

# الأسرار (سطر واحد)
npx supabase secrets set GEMINI_API_KEY=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=saey PUSH_WEBHOOK_SECRET=اكتب-كلمة-عشوائية-طويلة

# رفع كل الدوال
npx supabase functions deploy
```
✅ تحقق: في Supabase ← **Edge Functions** تظهر ٧ دوال: `files` `ai-chat` `ocr` `ingest` `quiz` `push` `youtube-meta`.

> بديل للخطوة ١-٣ عبر الطرفية: `npx supabase db push` ثم شغّل `seed.sql` من SQL Editor.

### Webhooks للإشعارات
في Supabase ← **Database ← Webhooks ← Create a new hook** — أنشئ اثنين:
| الاسم | الجدول | الحدث | الرابط | Header |
|---|---|---|---|---|
| push-notifications | `notifications` | Insert | `https://<ref>.supabase.co/functions/v1/push` | `x-webhook-secret`: نفس `PUSH_WEBHOOK_SECRET` |
| push-messages | `messages` | Insert | نفس الرابط | نفس الـ header |

النوع: **HTTP Request**، الطريقة **POST**.

## ٧. لوحة التحكم على Netlify
1. ادخل https://app.netlify.com ← **Add new site ← Import from Git** ← GitHub ← اختر `alkhamis-alilmi`.
2. الإعدادات تُقرأ تلقائياً من `netlify.toml` (لا تغيّر شيئاً). اختر الفرع المطلوب (`main` بعد الدمج).
3. **Environment variables**:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon key
4. **Deploy**. ✅ افتح الرابط وسجّل الدخول بحسابك (الأدمن).
5. أضف رابط Netlify في: Supabase Site URL + Redirect URLs (خطوة ٢-ب) + CORS في R2 (خطوة ٥).
6. لاحقاً: **Domain management** لربط دومينك.

للتجربة محلياً:
```bash
cp apps/admin/.env.example apps/admin/.env.local   # واملأ القيمتين
npm run admin:dev    # http://localhost:5173
```

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

## ٩. الإشعارات الفورية (Firebase) — اختياري في البداية
التطبيق يعمل بدونها، لكن الأخبار والرسائل لن تصل كإشعار والتطبيق مغلق.
1. https://console.firebase.google.com ← **Add project** (`saey`).
2. **Add app ← Android**: Package name = `com.saey.app` ← حمّل `google-services.json`.
3. ضع الملف في `apps/mobile/google-services.json`، وأضف في `apps/mobile/app.json` داخل `"android"`:
   `"googleServicesFile": "./google-services.json"`
4. Firebase ← **Project settings ← Service accounts ← Generate new private key** (ملف JSON).
5. ```bash
   cd apps/mobile
   npx eas-cli credentials
   ```
   اختر Android ← preview ← **Google Service Account** ← **FCM V1** ← ارفع ملف JSON من الخطوة ٤.
6. أعد بناء APK (خطوة ٨-٤).

## ١٠. إبقاء Supabase نشطاً
المشروع المجاني يتوقف بعد ٧ أيام بلا نشاط (مثلاً في العطلة). يوجد ملف GitHub Action جاهز يزوره كل ٣ أيام:
- GitHub ← المستودع ← **Settings ← Secrets and variables ← Actions ← New repository secret**:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

---

## بعد الإعداد: أول محتوى
من لوحة التحكم:
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
| فشل رفع الملزمة في لوحة التحكم | إعداد CORS في R2 (خطوة ٥-٤) لا يتضمن رابط الموقع |
| «المساعد مشغول» كثيراً | انتهى الحد المجاني لـ Gemini اليوم — خفّض الحد اليومي من الإعدادات |
| الإشعارات لا تصل | خطوة ٩ + الـ Webhooks في خطوة ٦ |
