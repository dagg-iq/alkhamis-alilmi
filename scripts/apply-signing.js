// يضبط توقيع نسخة الإصدار على مفتاح سعي الخاص بدل مفتاح Expo العام (debug).
// يُشغَّل بعد expo prebuild، ويقرأ المفتاح من متغيرات البيئة التي يجهزها build-apk.yml:
//   SAEY_KEYSTORE (مسار الملف)، SAEY_STORE_PASSWORD، SAEY_KEY_ALIAS، SAEY_KEY_PASSWORD
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'apps', 'mobile', 'android', 'app', 'build.gradle');
let g = fs.readFileSync(file, 'utf8');
for (const v of ['SAEY_KEYSTORE', 'SAEY_STORE_PASSWORD', 'SAEY_KEY_ALIAS', 'SAEY_KEY_PASSWORD']) {
  if (!process.env[v]) throw new Error(`المتغير ${v} غير موجود`);
}
if (!fs.existsSync(process.env.SAEY_KEYSTORE)) throw new Error('ملف المفتاح غير موجود');

const releaseCfg = `    signingConfigs {
        release {
            storeFile file(System.getenv('SAEY_KEYSTORE'))
            storePassword System.getenv('SAEY_STORE_PASSWORD')
            keyAlias System.getenv('SAEY_KEY_ALIAS')
            keyPassword System.getenv('SAEY_KEY_PASSWORD')
        }
`;
if (!g.includes('    signingConfigs {\n')) throw new Error('لم أجد signingConfigs في build.gradle (تغيّر قالب Expo؟)');
g = g.replace('    signingConfigs {\n', releaseCfg);

// داخل buildTypes.release فقط: نستبدل توقيع debug بتوقيع release
const i = g.indexOf('        release {', g.indexOf('buildTypes {'));
if (i < 0) throw new Error('لم أجد buildTypes.release');
const j = g.indexOf('signingConfig signingConfigs.debug', i);
if (j < 0 || j - i > 600) throw new Error('لم أجد signingConfig داخل release');
g = g.slice(0, j) + 'signingConfig signingConfigs.release' + g.slice(j + 'signingConfig signingConfigs.debug'.length);

fs.writeFileSync(file, g);
console.log('✓ نسخة الإصدار ستُوقَّع بمفتاح سعي الخاص');
