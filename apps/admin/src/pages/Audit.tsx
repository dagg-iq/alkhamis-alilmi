import { Empty } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { must, supabase } from '../lib/supabase';
import { TABLE_LABEL } from './Dashboard';

interface Row { id: number; action: string; target_type: string; meta: Record<string, string> | null; created_at: string; profiles: { full_name: string } | null }
const ACTION: Record<string, string> = { insert: 'إضافة', update: 'تعديل', delete: 'حذف' };

export default function Audit() {
  const q = useLoad(async () => must(supabase.from('audit_log').select('id, action, target_type, meta, created_at, profiles(full_name)').order('created_at', { ascending: false }).limit(300)) as unknown as Promise<Row[]>);
  return (
    <>
      <div className="head"><h1>سجل العمليات</h1></div>
      <p className="small dim">كل ما فعله الأدمن والمشرفون: إضافة، تعديل، حذف، قبول طلاب، تغيير أدوار.</p>
      {!q.data?.length ? <Empty>{q.loading ? 'جارٍ التحميل…' : 'لا توجد عمليات'}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>من</th><th>العملية</th><th>على</th><th>التفاصيل</th><th>الوقت</th></tr></thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.profiles?.full_name ?? '—'}</td>
                  <td><span className={`pill ${r.action === 'delete' ? 'bad' : r.action === 'insert' ? 'ok' : 'accent'}`}>{ACTION[r.action] ?? r.action}</span></td>
                  <td>{TABLE_LABEL[r.target_type] ?? r.target_type}</td>
                  <td>{r.meta?.title ?? ''} {r.meta?.status ? <span className="pill">{r.meta.status}</span> : null} {r.meta?.role ? <span className="pill">{r.meta.role}</span> : null}</td>
                  <td className="small dim">{new Date(r.created_at).toLocaleString('ar-IQ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
