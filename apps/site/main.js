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

// ظهور العناصر عند الوصول إليها، مع تتابع خفيف داخل كل مجموعة
const groups = ['.strip > div', '.section-head', '.feature', '.grades-text > *', '.grades-phones .phone', '.gallery', '.steps li', '.faq details', '.dev-card', '.cta-center'];
const items = [];
groups.forEach((sel) => document.querySelectorAll(sel).forEach((el, i) => {
  el.classList.add('reveal');
  el.style.setProperty('--d', `${Math.min(i, 6) * 0.07}s`);
  items.push(el);
}));
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
} else items.forEach((el) => el.classList.add('in'));

// بعد دخول الهواتف تبدأ بالطفو
setTimeout(() => document.querySelector('.hero-phones')?.classList.add('ready'), 2300);

// صورة المطوّر (إن وُجدت)؛ وإلا يبقى الحرف
const img = new Image();
img.onload = () => {
  const av = document.querySelector('.dev-avatar');
  if (av) { av.textContent = ''; img.alt = 'محمد حازم احمد'; av.appendChild(img); }
};
img.src = 'developer.jpg';

// مشهد الختام: يُشغَّل عند الوصول إليه، والضغط على الشعار يعيده
const finale = document.querySelector('.finale-stage');
if (finale) {
  const play = () => {
    finale.classList.remove('play');
    void finale.offsetWidth; // إعادة تشغيل الحركات من البداية
    finale.classList.add('play');
  };
  if ('IntersectionObserver' in window) {
    const fio = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { play(); fio.disconnect(); }
    }, { threshold: 0.45 });
    fio.observe(finale);
  } else play();
  finale.querySelector('.finale-inner')?.addEventListener('click', play);
}
