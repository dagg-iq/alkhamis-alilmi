import type { Message, Profile } from '@saey/shared';
import { useEffect, useState } from 'react';
import { askConfirm } from '../components/dialog';
import { Avatar, Empty, Field, Modal, Verified, check, useAction } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';
import { must, supabase } from '../lib/supabase';

interface Conv { id: string; type: string; title: string | null; only_staff_can_post: boolean; last_message_at: string | null }
const TYPE_LABEL: Record<string, string> = { school: 'المدرسة', section: 'شعبة', group: 'مجموعة', direct: 'خاصة' };

export default function Chat() {
  const { profile, isAdmin } = useAuth();
  const { run, busy } = useAction();
  const [active, setActive] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [group, setGroup] = useState<{ title: string; members: string[]; staffOnly: boolean } | null>(null);

  const convs = useLoad(async () => {
    const [list, mine, people] = await Promise.all([
      must(supabase.from('conversations').select('id, type, title, only_staff_can_post, last_message_at').neq('type', 'direct').order('last_message_at', { ascending: false, nullsFirst: false })),
      must(supabase.from('conversation_members').select('conversation_id').eq('user_id', profile!.id)),
      must(supabase.from('profiles').select('id, full_name, avatar_url, is_verified').eq('status', 'approved').order('full_name')),
    ]);
    return {
      list: list as Conv[],
      mine: new Set((mine as { conversation_id: string }[]).map((m) => m.conversation_id)),
      people: people as Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'is_verified'>[],
    };
  });

  const msgs = useLoad(async () => {
    if (!active) return [] as Message[];
    return must(supabase.from('messages').select('*').eq('conversation_id', active).order('created_at', { ascending: false }).limit(100)) as Promise<Message[]>;
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const ch = supabase.channel(`admin-conv:${active}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${active}` }, () => msgs.reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const person = (id: string) => convs.data?.people.find((p) => p.id === id);
  const conv = convs.data?.list.find((c) => c.id === active);
  const isMember = !!active && convs.data?.mine.has(active);

  const send = () => run(async () => {
    if (!text.trim()) return;
    await check(supabase.from('messages').insert({ conversation_id: active, sender_id: profile!.id, body: text.trim() }));
    setText('');
  });

  const createGroup = () => run(async () => {
    if (!group?.title.trim()) throw new Error('اكتب اسم المجموعة');
    const { data, error } = await supabase.rpc('create_group', { p_title: group.title.trim(), p_members: group.members, p_staff_only: group.staffOnly });
    if (error) throw new Error(error.message);
    setGroup(null);
    await convs.reload();
    setActive(data as string);
  }, 'أُنشئت المجموعة');

  return (
    <>
      <div className="head">
        <h1>الدردشة</h1>
        <button className="btn primary" onClick={() => setGroup({ title: '', members: [], staffOnly: false })}>+ مجموعة أو قناة إعلانات</button>
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="card" style={{ flex: '1 1 240px', maxWidth: 320, padding: 8 }}>
          {(convs.data?.list ?? []).map((c) => (
            <button key={c.id} onClick={() => setActive(c.id)} className="btn" style={{ width: '100%', justifyContent: 'space-between', border: 0, background: c.id === active ? 'var(--bg)' : 'transparent', height: 48 }}>
              <span>{c.title ?? TYPE_LABEL[c.type]}</span>
              <span className="pill">{TYPE_LABEL[c.type]}{c.only_staff_can_post ? ' · إعلانات' : ''}</span>
            </button>
          ))}
          {convs.data?.list.length === 0 ? <Empty>لا توجد محادثات</Empty> : null}
        </div>
        <div className="card" style={{ flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!active ? <Empty>اختر محادثة لعرض رسائلها وإدارتها</Empty> : (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>{conv?.title ?? TYPE_LABEL[conv?.type ?? '']}</h2>
                {isAdmin && conv?.type === 'group' ? (
                  <button className="btn danger sm" onClick={async () => (await askConfirm('حذف المجموعة وكل رسائلها؟')) && run(async () => { await check(supabase.from('conversations').delete().eq('id', active)); setActive(null); await convs.reload(); }, 'حُذفت')}>حذف المجموعة</button>
                ) : null}
              </div>
              {isMember ? (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالة…" onKeyDown={(e) => e.key === 'Enter' && send()} />
                  <button className="btn primary" onClick={send} disabled={busy}>إرسال</button>
                </div>
              ) : <p className="small dim">لست عضواً في هذه المحادثة — يمكنك القراءة والحذف فقط.</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh', overflow: 'auto' }}>
                {(msgs.data ?? []).map((m) => {
                  const p = person(m.sender_id);
                  return (
                    <div key={m.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', opacity: m.deleted_at ? 0.5 : 1 }}>
                      <Avatar name={p?.full_name ?? '؟'} url={p?.avatar_url} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row" style={{ gap: 4 }}>
                          <b className="small">{p?.full_name ?? 'مستخدم'}</b>{p?.is_verified ? <Verified size={14} /> : null}
                          <span className="small dim">{new Date(m.created_at).toLocaleString('ar-IQ')}</span>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {m.deleted_at ? 'رسالة محذوفة' : m.body ?? (m.attachment?.type === 'image' ? '[صورة]' : `[${m.attachment && 'title' in m.attachment ? m.attachment.title : 'مرفق'}]`)}
                        </div>
                      </div>
                      {!m.deleted_at ? (
                        <button className="btn danger sm" onClick={() => run(async () => { await check(supabase.from('messages').update({ deleted_at: new Date().toISOString(), body: null }).eq('id', m.id)); }, 'حُذفت الرسالة')}>حذف</button>
                      ) : null}
                    </div>
                  );
                })}
                {msgs.data?.length === 0 ? <Empty>لا توجد رسائل</Empty> : null}
              </div>
            </>
          )}
        </div>
      </div>

      {group ? (
        <Modal title="مجموعة جديدة" onClose={() => setGroup(null)}>
          <Field label="الاسم"><input className="input" value={group.title} onChange={(e) => setGroup({ ...group, title: e.target.value })} placeholder="مثلاً: مجموعة الفيزياء" /></Field>
          <label className="check"><input type="checkbox" checked={group.staffOnly} onChange={(e) => setGroup({ ...group, staffOnly: e.target.checked })} /> قناة إعلانات (النشر للأدمن والمشرفين فقط)</label>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>الأعضاء ({group.members.length})</b>
            <button className="btn ghost sm" onClick={() => setGroup({ ...group, members: (convs.data?.people ?? []).map((p) => p.id) })}>اختيار الكل</button>
          </div>
          <div style={{ maxHeight: 300, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(convs.data?.people ?? []).filter((p) => p.id !== profile!.id).map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={group.members.includes(p.id)}
                  onChange={(e) => setGroup({ ...group, members: e.target.checked ? [...group.members, p.id] : group.members.filter((x) => x !== p.id) })} />
                <Avatar name={p.full_name} url={p.avatar_url} size={28} /> {p.full_name}
              </label>
            ))}
          </div>
          <button className="btn primary" onClick={createGroup} disabled={busy}>إنشاء</button>
        </Modal>
      ) : null}
    </>
  );
}
