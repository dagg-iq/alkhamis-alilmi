#!/usr/bin/env bash
# يجمع موقع سعي التعريفي + لوحة التحكم + صفحة العرض في مجلد hosting/ لنشره على Firebase Hosting
#   saeyiq.web.app/                 ← الموقع التعريفي (apps/site)
#   saeyiq.web.app/saey-dashboard/  ← لوحة التحكم (apps/admin)
#   saeyiq.web.app/showcase/        ← صفحة عرض التطبيق (showcase)
# متغيرات اختيارية لزر التنزيل: DOWNLOAD_URL و DOWNLOAD_VERSION و DOWNLOAD_SIZE_MB
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf hosting
mkdir -p hosting
cp -r apps/site/. hosting/
rm -f hosting/download-config.json
# كل نشر يجبر المتصفح على أخذ ملفات الموقع الجديدة (لا يعرض نسخة قديمة محفوظة)
V=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
sed -i "s#href=\"style.css\"#href=\"style.css?v=$V\"#; s#src=\"main.js\"#src=\"main.js?v=$V\"#" hosting/index.html
cp -r apps/admin/public/fonts hosting/fonts
cp apps/admin/public/favicon.png hosting/favicon.png
# الصورة التعريفية للمطوّر (من رابط يحدده صاحب المشروع)؛ إن فشل التنزيل يبقى الحرف
DEV_PHOTO_URL="${DEV_PHOTO_URL:-https://e.top4top.io/p_3665za6ix1.jpg}"
curl -fsSL --max-time 30 -o hosting/developer.jpg "$DEV_PHOTO_URL" && echo "✓ صورة المطوّر" || { rm -f hosting/developer.jpg; echo "⚠ لم تُنزّل صورة المطوّر"; }
ADMIN_BASE=/saey-dashboard/ npm run build -w apps/admin >/dev/null
cp -r apps/admin/dist hosting/saey-dashboard
mkdir -p hosting/showcase && cp -r showcase/. hosting/showcase/ && rm -f hosting/showcase/README.md
node -e '
// رابط التنزيل: متغير DOWNLOAD_URL إن وُجد، وإلا رابط Dropbox (أو Drive) من apps/site/download-config.json
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("apps/site/download-config.json", "utf8"));
let url = process.env.DOWNLOAD_URL || "";
const link = cfg.link || cfg.drive_link || "";
if (!url && /dropbox\.com/.test(link)) {
  // Dropbox: dl=1 ← تنزيل مباشر بلا صفحة وسيطة
  const u = new URL(link);
  u.searchParams.set("dl", "1");
  url = u.toString();
} else if (!url && link) {
  // Google Drive (يعرض صفحة تحذير للملفات الكبيرة — Dropbox أفضل)
  const id = (link.match(/\/d\/([\w-]+)/) || link.match(/[?&]id=([\w-]+)/) || [])[1];
  if (id) url = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  // رابط مباشر (مثل GitHub Releases) يُستخدم كما هو
  else if (/^https:\/\//.test(link)) url = link;
}
const d = { url, version: process.env.DOWNLOAD_VERSION || cfg.version || "", size_mb: process.env.DOWNLOAD_SIZE_MB || cfg.size_mb || "", date: new Date().toISOString() };
fs.writeFileSync("hosting/download.json", JSON.stringify(d));
console.log("download.json:", JSON.stringify(d));
'
echo "✓ hosting/ جاهز"
