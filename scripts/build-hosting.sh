#!/usr/bin/env bash
# يجمع موقع سعي التعريفي + لوحة التحكم في مجلد hosting/ لنشره على Firebase Hosting
#   saeyiq.web.app/                 ← الموقع التعريفي (apps/site)
#   saeyiq.web.app/saey-dashboard/  ← لوحة التحكم (apps/admin)
# متغيرات اختيارية لزر التنزيل: DOWNLOAD_URL و DOWNLOAD_VERSION و DOWNLOAD_SIZE_MB
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf hosting
mkdir -p hosting
cp -r apps/site/. hosting/
cp -r apps/admin/public/fonts hosting/fonts
cp apps/admin/public/favicon.png hosting/favicon.png
# الصورة التعريفية للمطوّر (من رابط يحدده صاحب المشروع)؛ إن فشل التنزيل يبقى الحرف
DEV_PHOTO_URL="${DEV_PHOTO_URL:-https://e.top4top.io/p_3665za6ix1.jpg}"
curl -fsSL --max-time 30 -o hosting/developer.jpg "$DEV_PHOTO_URL" && echo "✓ صورة المطوّر" || { rm -f hosting/developer.jpg; echo "⚠ لم تُنزّل صورة المطوّر"; }
ADMIN_BASE=/saey-dashboard/ npm run build -w apps/admin >/dev/null
cp -r apps/admin/dist hosting/saey-dashboard
node -e '
const d = { url: process.env.DOWNLOAD_URL || "", version: process.env.DOWNLOAD_VERSION || "", size_mb: process.env.DOWNLOAD_SIZE_MB || "", date: new Date().toISOString() };
require("fs").writeFileSync("hosting/download.json", JSON.stringify(d));
console.log("download.json:", JSON.stringify(d));
'
echo "✓ hosting/ جاهز"
