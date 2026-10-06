// إعدادات ديناميكية فوق app.json:
// - نربط Firebase (الإشعارات) فقط إذا وُجد ملفه (يُكتب أثناء البناء من سر GOOGLE_SERVICES_JSON).
// - رقم النسخة = رقم بناء APK في GitHub (APK_BUILD)، والتطبيق يقارنه بآخر نسخة على الموقع ليعرض «تحديث متاح».
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const build = Number(process.env.APK_BUILD) || 0;
  config.extra = { ...config.extra, buildNumber: build };
  if (build) {
    config.version = `1.0.${build}`;
    config.android = { ...config.android, versionCode: build };
  }
  if (fs.existsSync(path.join(__dirname, 'google-services.json'))) {
    config.android = { ...config.android, googleServicesFile: './google-services.json' };
  }
  return config;
};
