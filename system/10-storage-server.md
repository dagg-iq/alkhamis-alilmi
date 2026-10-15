<div dir="rtl">

# خادم التخزين (سيرفر Oracle) — حتى لا يتوقف أبداً

الملفات (الكتب، الملازم، مرفقات الدردشة) على خادم S3 في جهاز Oracle: `storage.130-61-171-185.sslip.io`.
توقف أكثر من مرة (١٤ و١٥ تشرين الأول): الجهاز لا يرد على أي منفذ = **الجهاز نفسه متوقف**، لا البرنامج فقط.

## لماذا يتوقف؟
السبب الأرجح: **Oracle توقف أجهزة Always Free «الخاملة»** — إذا بقي استهلاك المعالج والشبكة (والذاكرة لأجهزة Ampere) أقل من ٢٠٪ خلال ٧ أيام،
توقفه Oracle تلقائياً (Idle reclamation). خادم ملفات لمدرسة واحدة خامل أغلب الوقت، فيقع في هذا تماماً.
تأكد: Oracle ترسل بريداً عند إيقاف الجهاز، وفي Compute ← Instances ← الجهاز ← Work requests / Audit تجد من أوقفه.

## الحل الدائم (ثلاث طبقات)

### ١) الحارس التلقائي (مبني في المشروع — يحتاج مفاتيح Oracle منك)
دالة `storage-watchdog` كل ٥ دقائق (pg_cron `saey-storage-watchdog`):
- الخادم لا يرد والجهاز **STOPPED** ← ترسل **START** فوراً (يعود خلال ٢–٣ دقائق).
- الجهاز **RUNNING** لكنه لا يرد ١٥ دقيقة ← **إعادة تشغيل** (مرة كل ٣٠ دقيقة كحد أقصى).
- كل فحص في جدول `storage_watchdog_log`، ويظهر في سير العمل **Health check**.

**الإعداد (مرة واحدة، ١٠ دقائق):**
1. في Oracle: الصورة أعلى اليمين ← **My profile** ← **API keys** (أو Tokens and keys) ← **Add API key** ← **Generate API key pair** ← **Download private key** ← **Add**.
   تظهر نافذة «Configuration file preview» فيها: `user` و `fingerprint` و `tenancy` و `region` — انسخها.
2. **Compute ← Instances ←** جهاز التخزين ← انسخ **OCID**.
3. في GitHub: المستودع ← Settings ← Secrets and variables ← Actions ← New repository secret، ستة أسرار:
   | الاسم | القيمة |
   |---|---|
   | `OCI_TENANCY` | قيمة tenancy (تبدأ ocid1.tenancy…) |
   | `OCI_USER` | قيمة user (تبدأ ocid1.user…) |
   | `OCI_FINGERPRINT` | قيمة fingerprint (مثل 12:ab:…) |
   | `OCI_REGION` | قيمة region (مثل eu-frankfurt-1) |
   | `OCI_INSTANCE_ID` | OCID الجهاز (يبدأ ocid1.instance…) |
   | `OCI_PRIVATE_KEY` | محتوى ملف المفتاح الخاص كاملاً (افتحه بمحرر نصوص وانسخ كل شيء من BEGIN إلى END) |
4. شغّل **Deploy Supabase** (Actions ← Deploy Supabase ← Run workflow).
5. شغّل **Health check**: يجب أن يظهر في سجل الحارس «يرد» أو «أُرسل أمر التشغيل».

> المفتاح يعطي صلاحية على حسابك في Oracle: لا ترسله لأحد ولا تضعه في الكود، فقط في أسرار GitHub.

### ٢) منع Oracle من إيقافه أصلاً (الأفضل)
- **ترقية الحساب إلى Pay As You Go** (Billing ← Upgrade): الأجهزة المجانية تبقى مجانية، وOracle **لا توقف** أجهزة الحسابات المرقّاة لخمولها.
  يحتاج بطاقة، ولا يُخصم شيء ما دمت ضمن حدود Always Free. ضع تنبيه ميزانية (Budgets) بـ ١ دولار للاطمئنان.
- بلا ترقية: الحارس أعلاه يعيده خلال دقائق كلما أوقفته Oracle.

### ٣) داخل الجهاز: كل شيء يعمل وحده بعد أي إعادة تشغيل
بعد أن يعمل الجهاز، ادخل عليه (SSH أو Cloud Shell) ونفّذ ما يناسب ما ثبّتّه:
```bash
# إن كان التخزين في Docker (MinIO وغيره): يعود مع كل تشغيل
sudo systemctl enable docker
sudo docker update --restart unless-stopped $(sudo docker ps -aq)

# إن كان خدمة systemd (minio / caddy / nginx …):
sudo systemctl enable minio caddy 2>/dev/null; systemctl list-units --type=service --state=running | head -30

# جدار Ubuntu في Oracle يمسح القواعد بعد إعادة التشغيل إن لم تُحفظ: المنافذ 80 و443 مسموحة دائماً
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# المساحة: امتلاء القرص يوقف الخادم
df -h /
```
وجرّب: `sudo reboot` ثم بعد دقيقتين افتح `https://storage.130-61-171-185.sslip.io` — يجب أن يرد (حتى لو بخطأ 403).

## الاحتياط في التطبيق
إن توقف الخادم رغم كل هذا: الدوال تقرأ من Supabase Storage كل ملف موجود فيه (الكتب القديمة)، وترفع إليه مؤقتاً (`_shared/storage.ts`)،
فلا يتعطل التطبيق كله. هذا مؤقت فقط (Supabase المجاني ١ غيغا) — الخادم هو التخزين الأساسي.
</div>
