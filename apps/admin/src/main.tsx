import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { DialogHost } from './components/dialog';
import { ToastProvider } from './components/ui';
import { AuthProvider } from './lib/auth';
import './styles.css';

/**
 * الجداول على الهاتف تتحول لبطاقات: نضع اسم العمود على كل خلية (data-label)
 * تلقائياً من رأس الجدول، فيظهر فوق قيمتها — بلا تعديل كل صفحة.
 */
function labelTables(root: ParentNode) {
  root.querySelectorAll('table').forEach((table) => {
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
    if (!heads.length) return;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        const label = heads[i] ?? '';
        if (td.getAttribute('data-label') !== label) td.setAttribute('data-label', label);
      });
    });
  });
}
// التغييرات المتتابعة (كتابة، تحديث تلقائي) تُجمع في إطار رسم واحد بدل فحص كل الجداول مع كل تغيير
let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; labelTables(document); });
}).observe(document.documentElement, { childList: true, subtree: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthProvider>
        <ToastProvider>
          <App />
          <DialogHost />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
