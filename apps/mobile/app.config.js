// إعدادات ديناميكية فوق app.json: نربط Firebase (الإشعارات) فقط إذا وُجد ملفه.
// الملف يُكتب أثناء بناء APK من سر GitHub باسم GOOGLE_SERVICES_JSON (انظر build-apk.yml).
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  if (fs.existsSync(path.join(__dirname, 'google-services.json'))) {
    config.android = { ...config.android, googleServicesFile: './google-services.json' };
  }
  return config;
};
