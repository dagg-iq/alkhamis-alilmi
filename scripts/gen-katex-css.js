// يولّد apps/mobile/src/lib/katex-css.ts: أنماط KaTeX مع الخطوط مضمّنة (woff2 بصيغة data URI) لتظهر المعادلات بلا إنترنت.
// الاستخدام: node scripts/gen-katex-css.js
const fs = require('fs');
const path = require('path');
const dist = path.join(__dirname, '..', 'node_modules', 'katex', 'dist');
let css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8');
// كل @font-face: نبقي woff2 فقط ونحوّله إلى data URI
css = css.replace(/src:url\(fonts\/([^)]+?)\.woff2\) format\("woff2"\)[^;}]*/g, (_, name) => {
  const b64 = fs.readFileSync(path.join(dist, 'fonts', `${name}.woff2`)).toString('base64');
  return `src:url(data:font/woff2;base64,${b64}) format("woff2")`;
});
if (/url\(fonts\//.test(css)) throw new Error('بقي مسار خط خارجي');
const ver = require(path.join(dist, '..', 'package.json')).version;
fs.writeFileSync(path.join(__dirname, '..', 'apps', 'mobile', 'src', 'lib', 'katex-css.ts'),
  `// مولَّد بـ scripts/gen-katex-css.js (katex ${ver}) — لا تعدّله يدوياً\nexport const KATEX_INLINE_CSS = ${JSON.stringify(css)};\n`);
console.log('✓', (css.length / 1024).toFixed(0), 'KB');
