import { useEffect, useRef, useState } from 'react';

/**
 * نوافذ التأكيد والإدخال بتصميم سعي بدل نوافذ المتصفح الرمادية.
 * askConfirm(...) و askText(...) تعيدان Promise (استعملهما مع await).
 */
type Req =
  | { kind: 'confirm'; message: string; ok: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'text'; message: string; value: string; resolve: (v: string | null) => void };

let setReq: ((r: Req | null) => void) | null = null;
const queue: Req[] = [];

function push(r: Req) {
  if (setReq) setReq(r); else queue.push(r);
}

export const askConfirm = (message: string, opts: { ok?: string; danger?: boolean } = {}) =>
  new Promise<boolean>((resolve) => push({ kind: 'confirm', message, ok: opts.ok ?? 'نعم', danger: opts.danger ?? /حذف|حظر/.test(message), resolve }));

export const askText = (message: string, value = '') =>
  new Promise<string | null>((resolve) => push({ kind: 'text', message, value, resolve }));

export function DialogHost() {
  const [req, set] = useState<Req | null>(null);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setReq = (r) => { set(r); if (r?.kind === 'text') setText(r.value); };
    const next = queue.shift();
    if (next) setReq(next);
    return () => { setReq = null; };
  }, []);
  useEffect(() => { if (req?.kind === 'text') setTimeout(() => input.current?.select(), 30); }, [req]);

  if (!req) return null;
  const close = (v: boolean | string | null) => {
    if (req.kind === 'confirm') req.resolve(v === true); else req.resolve(typeof v === 'string' ? v : null);
    set(null);
    const next = queue.shift();
    if (next) setTimeout(() => setReq?.(next), 0);
  };
  return (
    <div className="dlg-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(req.kind === 'confirm' ? false : null); }}
      onKeyDown={(e) => { if (e.key === 'Escape') close(req.kind === 'confirm' ? false : null); }}>
      <div className="dlg" role="dialog" aria-modal="true">
        <h3>{req.message}</h3>
        {req.kind === 'text' ? (
          <input ref={input} className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') close(text); }} />
        ) : null}
        <div className="dlg-actions">
          {req.kind === 'confirm'
            ? <button className={`btn ${req.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>{req.ok}</button>
            : <button className="btn primary" onClick={() => close(text)}>موافق</button>}
          <button className="btn" onClick={() => close(req.kind === 'confirm' ? false : null)}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
