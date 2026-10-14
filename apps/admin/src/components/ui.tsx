import { isSafeUrl, sanitizeHtml } from '@saey/shared';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Marked } from 'marked';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export function Logo({ size = 32, ink = 'var(--ink)', dot = 'var(--accent)' }: { size?: number; ink?: string; dot?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <rect x="80" y="62" width="20" height="42" rx="10" fill={ink} />
      <rect x="50" y="44" width="20" height="60" rx="10" fill={ink} />
      <rect x="20" y="30" width="20" height="74" rx="10" fill={ink} />
      <rect x="20" y="84" width="80" height="20" rx="10" fill={ink} />
      <circle cx="30" cy="12" r="10" fill={dot} />
    </svg>
  );
}

export function Verified({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="موثّق" role="img" style={{ flexShrink: 0 }}>
      <path d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z" fill="var(--accent)" />
      <path d="M8 12.3l2.7 2.7L16 9.7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  return url
    ? <img className="avatar" src={url} alt="" style={{ width: size, height: size }} />
    : <span className="avatar" style={{ width: size, height: size }}>{name.trim().charAt(0) || '؟'}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Esc يغلق النافذة (إلا إن كانت نافذة تأكيد مفتوحة فوقها — تلك تعالج Esc بنفسها)
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.dlg-back')) close.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-bg" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="إغلاق">إغلاق</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Tabs<K extends string>({ options, value, onChange }: { options: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.key} role="tab" aria-selected={o.key === value} className={o.key === value ? 'on' : ''} onClick={() => onChange(o.key)}>
          {o.label}{o.count ? ` (${o.count})` : ''}
        </button>
      ))}
    </div>
  );
}

/** Markdown آمن: لا HTML خام إلا وسوم التنسيق، والروابط والصور بمخطط ويب فقط */
const md = new Marked({
  breaks: true,
  async: false,
  renderer: {
    html: (html) => sanitizeHtml(html),
    link: (href, _title, text) => (isSafeUrl(href) ? false : text),
    image: (href, _title, text) => (isSafeUrl(href) ? false : text.replace(/</g, '&lt;')),
  },
});

/** Markdown + LaTeX */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const maths: string[] = [];
    const src = text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (m) => {
      maths.push(m);
      return `@@M${maths.length - 1}@@`;
    });
    let out = md.parse(src) as string;
    out = out.replace(/@@M(\d+)@@/g, (_, i) => {
      const m = maths[Number(i)];
      const display = m.startsWith('$$');
      try {
        return katex.renderToString(m.slice(display ? 2 : 1, display ? -2 : -1), { displayMode: display, throwOnError: false });
      } catch {
        return m;
      }
    });
    return out;
  }, [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------- تنبيهات
const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  // مؤقت واحد: تنبيه جديد يلغي مؤقت السابق (وإلا يُخفي مؤقتُ الأول الثاني مبكراً)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string, err?: boolean) => {
    setToast({ msg, err });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), err ? 5000 : 2500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast ? <div className={`toast${toast.err ? ' err' : ''}`} role="status">{toast.msg}</div> : null}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** ينفّذ عملية ويعرض نجاحها أو خطأها */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast(success);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'حدث خطأ', true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** يرمي خطأ Supabase إن وُجد */
export async function check(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(error.message);
}
