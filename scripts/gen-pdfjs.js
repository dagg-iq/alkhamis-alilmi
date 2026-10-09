// يولّد apps/mobile/src/lib/pdfjs-source.ts من حزمة pdfjs-dist (نسخة ثابتة) ليعمل عارض PDF بلا إنترنت.
// الاستخدام: mkdir /tmp/pj && cd /tmp/pj && npm i pdfjs-dist@3.11.174 && node <repo>/scripts/gen-pdfjs.js /tmp/pj/node_modules/pdfjs-dist
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) throw new Error('مرّر مسار pdfjs-dist');
const read = (f) => fs.readFileSync(path.join(dir, 'build', f), 'utf8').replace(/<\/script/gi, '<\\/script');
const out = `// ملف مولَّد بـ scripts/gen-pdfjs.js (pdfjs-dist ${require(path.join(dir, 'package.json')).version}) — لا تعدّله يدوياً
export const PDFJS_MAIN = ${JSON.stringify(read('pdf.min.js'))};
export const PDFJS_WORKER = ${JSON.stringify(read('pdf.worker.min.js'))};
`;
fs.writeFileSync(path.join(__dirname, '..', 'apps', 'mobile', 'src', 'lib', 'pdfjs-source.ts'), out);
console.log('✓', (out.length / 1048576).toFixed(2), 'MB');
