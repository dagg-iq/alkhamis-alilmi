import { describe, expect, it } from 'vitest';
import { escapeHtml, isSafeUrl, sanitizeHtml } from './safe-html';

describe('حماية HTML في Markdown', () => {
  it('يبقي وسوم التنسيق المسموحة', () => {
    expect(sanitizeHtml('<mark>')).toBe('<mark>');
    expect(sanitizeHtml('</mark>')).toBe('</mark>');
    expect(sanitizeHtml('<br/>')).toBe('<br/>');
    expect(sanitizeHtml('<SUP>')).toBe('<sup>');
  });

  it('يعرض أي وسم آخر نصاً (لا تنفيذ)', () => {
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(sanitizeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeHtml('<iframe src="https://x">')).toBe('&lt;iframe src=&quot;https://x&quot;&gt;');
  });

  it('الوسم المسموح بخصائص يُرفض (onclick مثلاً)', () => {
    expect(sanitizeHtml('<b onclick="x()">')).toBe('&lt;b onclick=&quot;x()&quot;&gt;');
    expect(sanitizeHtml('<mark style="background:url(javascript:x)">')).not.toContain('<mark');
  });

  it('كتلة مختلطة: المسموح يبقى والباقي نص', () => {
    expect(sanitizeHtml('<div><mark>مهم</mark><svg onload=x></svg></div>'))
      .toBe('&lt;div&gt;<mark>مهم</mark>&lt;svg onload=x&gt;&lt;/svg&gt;&lt;/div&gt;');
  });

  it('النص العادي والرموز تُهرَّب', () => {
    expect(escapeHtml(`a < b & "c" 'd'`)).toBe('a &lt; b &amp; &quot;c&quot; &#39;d&#39;');
    expect(sanitizeHtml('x < 5')).toBe('x &lt; 5');
  });
});

describe('الروابط الآمنة', () => {
  it('يقبل روابط الويب والبريد', () => {
    expect(isSafeUrl('https://saeyiq.web.app')).toBe(true);
    expect(isSafeUrl('http://example.com/a?b=1')).toBe(true);
    expect(isSafeUrl('mailto:a@b.c')).toBe(true);
    expect(isSafeUrl('  https://x.y  ')).toBe(true);
  });

  it('يرفض المخططات الخطرة وروابط التطبيق', () => {
    for (const u of ['javascript:alert(1)', ' JavaScript:alert(1)', 'intent://scan#Intent;end', 'saey://chat/1', 'file:///sdcard/a', 'data:text/html,<b>', 'tel:123', '', null, undefined, 'https://a b']) {
      expect(isSafeUrl(u)).toBe(false);
    }
  });
});
