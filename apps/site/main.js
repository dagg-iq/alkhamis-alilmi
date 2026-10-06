// زر التنزيل: الرابط والإصدار من download.json (يكتبه سير عمل النشر عند كل نسخة جديدة)
const ar = (s) => String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]).replace('.', '٫');

fetch('download.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((d) => {
    const buttons = document.querySelectorAll('a[data-download]');
    if (!d || !d.url) {
      buttons.forEach((b) => {
        if (b.classList.contains('btn-sm')) return;
        b.setAttribute('aria-disabled', 'true');
        const label = b.querySelector('span');
        if (label) label.textContent = 'التنزيل متاح قريباً';
      });
      return;
    }
    buttons.forEach((b) => {
      b.href = d.url;
      b.setAttribute('download', 'saey.apk');
    });
    const meta = document.querySelector('[data-download-meta]');
    if (meta) {
      const parts = ['ملف APK لأندرويد'];
      if (d.version) parts.push(`النسخة ${ar(d.version)}`);
      if (d.size_mb) parts.push(`${ar(d.size_mb)} ميغا`);
      meta.textContent = parts.join(' · ');
    }
  });

document.querySelectorAll('[data-year]').forEach((e) => { e.textContent = ar(new Date().getFullYear()); });
