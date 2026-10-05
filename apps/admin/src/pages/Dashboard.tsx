import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { must, supabase } from '../lib/supabase';

interface Stats { students: number; pending: number; lectures: number; documents: number; question_sets: number; drafts: number; messages_today: number; ai_today: number; study_minutes_week: number }
interface Audit { id: number; action: string; target_type: string; meta: Record<string, string> | null; created_at: string; profiles: { full_name: string } | null }

const ACTION: Record<string, string> = { insert: 'أضاف', update: 'عدّل', delete: 'حذف' };
export const TABLE_LABEL: Record<string, string> = {
  profiles: 'طالب', sections: 'شعبة', subjects: 'مادة', books: 'جزء', chapters: 'فصل', teachers: 'أستاذ', lectures: 'محاضرة',
  documents: 'ملزمة', question_sets: 'أسئلة', posts: 'خبر', app_settings: 'إعداد', messages: 'رسالة',
};

export default function Dashboard() {
  const stats = useLoad(async () => must(supabase.rpc('admin_stats')) as Promise<Stats>);
  const audit = useLoad(async () => must(supabase.from('audit_log').select('id, action, target_type, meta, created_at, profiles(full_name)').order('created_at', { ascending: false }).limit(10)) as unknown as Promise<Audit[]>);
  const s = stats.data;
  const cards = s ? [
    { label: 'طالب معتمد', value: s.students },
    { label: 'طلب بانتظار الموافقة', value: s.pending, to: '/students', hot: s.pending > 0 },
    { label: 'محاضرة', value: s.lectures, to: '/lectures' },
    { label: 'ملزمة', value: s.documents, to: '/documents' },
    { label: 'مجموعة أسئلة منشورة', value: s.question_sets, to: '/questions' },
    { label: 'مسودة تنتظر المراجعة', value: s.drafts, to: '/questions', hot: s.drafts > 0 },
    { label: 'رسالة اليوم', value: s.messages_today, to: '/chat' },
    { label: 'سؤال للمساعد اليوم', value: s.ai_today },
    { label: 'ساعة دراسة هذا الأسبوع', value: Math.round(s.study_minutes_week / 60) },
  ] : [];

  return (
    <>
      <div className="head"><h1>نظرة عامة</h1></div>
      {stats.error ? <Empty>{stats.error}</Empty> : (
        <div className="grid">
          {cards.map((c) => {
            const body = (
              <div className={`card stat${c.hot ? ' hero' : ''}`}>
                <b className="num">{c.value.toLocaleString('ar-IQ')}</b>
                <span className={c.hot ? '' : 'dim'}>{c.label}</span>
              </div>
            );
            return c.to ? <Link key={c.label} to={c.to} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link> : <div key={c.label}>{body}</div>;
          })}
        </div>
      )}
      <h2>آخر العمليات</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            {(audit.data ?? []).map((a) => (
              <tr key={a.id}>
                <td>{a.profiles?.full_name ?? '—'}</td>
                <td>{ACTION[a.action] ?? a.action} {TABLE_LABEL[a.target_type] ?? a.target_type}</td>
                <td>{a.meta?.title ?? ''}{a.meta?.status ? <span className="pill">{a.meta.status}</span> : null}</td>
                <td className="dim small">{new Date(a.created_at).toLocaleString('ar-IQ')}</td>
              </tr>
            ))}
            {audit.data?.length === 0 ? <tr><td><Empty>لا توجد عمليات بعد</Empty></td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
