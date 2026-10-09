// ينسخ منطق الفهرس المشترك إلى دوال Supabase (النشر لا يرى مجلد packages)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'packages/shared/src/outline.ts'), 'utf8');
fs.writeFileSync(path.join(root, 'supabase/functions/_shared/outline.ts'),
  `// نسخة من packages/shared/src/outline.ts للدوال (لا تعدّلها هنا؛ انسخ الأصل: node scripts/sync-outline.js — اختبار يتأكد من تطابقهما)\n${src}`);
console.log('✓ synced');
