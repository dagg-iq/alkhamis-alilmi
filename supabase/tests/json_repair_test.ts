// اختبار إصلاح JSON من النماذج الخفيفة (فهرسة المحاضرات كانت تفشل بسببه). التشغيل من supabase/functions:
//   deno run -A --node-modules-dir=none --config deno.json ../tests/json_repair_test.ts
Deno.env.set('SUPABASE_URL', 'http://x.local'); Deno.env.set('SUPABASE_ANON_KEY', 'a'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 's');
const { parseJson } = await import('../functions/_shared/gemini.ts');

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };

// سطر جديد خام داخل النص + فاصلة زائدة + \sqrt بلا تهريب صحيح (\s ليس تهريباً في JSON)
const a = parseJson<{ topics: { title: string; details: string }[]; ended: boolean }>(
  '```json\n{"topics": [{"start": 0, "title": "سطر\nثانٍ", "details": "$\\sqrt{x} + 2$"},], "ended": false}\n```');
check('سطر جديد داخل النص', a.topics[0].title === 'سطر\nثانٍ');
check('شرطة مائلة غير صالحة تبقى كما هي', a.topics[0].details === '$\\sqrt{x} + 2$');
check('فاصلة زائدة', a.ended === false && a.topics.length === 1);

// تبويب خام و\u صالح يبقيان
const b = parseJson<{ a: string; b: string }>('{"a": "x\ty", "b": "\\u00e9 \\q"}');
check('تبويب خام', b.a === 'x\ty');
check('\\u صالح + \\q', b.b === 'é \\q');

// JSON سليم لا يتغير
check('السليم كما هو', parseJson<{ n: number }>('{"n": 1}').n === 1);

if (failed) { console.error(`${failed} فشل`); Deno.exit(1); }
console.log('كل اختبارات إصلاح JSON نجحت');
