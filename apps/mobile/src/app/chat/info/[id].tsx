import { GROUP_ROLE_LABELS, ROLE_LABELS, arDigits, countOf, lastSeenLabel, type GroupRole, type Profile } from '@saey/shared';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, Switch, View } from 'react-native';
import { ConversationMark } from '@/components/group-mark';
import { Sheet, SheetItem } from '@/components/sheet';
import { Avatar, Button, Card, Divider, ErrorBox, Field, Header, ListItem, Loading, NameLine, Row, Screen, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { canManage, conversationTitle, fetchConversations, inviteLink } from '@/lib/chat';
import { Alert } from '@/lib/dialog';
import { usePresence } from '@/lib/presence';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type Member = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'is_verified' | 'role'>;
interface Row_ { user_id: string; role?: GroupRole; joined_at: string; profiles: Member | null }

const RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };
const APP_RANK: Record<string, number> = { admin: 0, moderator: 1, student: 2 };

/** معلومات المحادثة: الأعضاء، الكتم، وإدارة المجموعة (الاسم، الوصف، الرابط، المشرفون، الإزالة، المغادرة) */
export default function ConversationInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const me = useMe();
  const { isStaff, isAdmin } = useAuth();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [memberFor, setMemberFor] = useState<(Row_ & { profiles: Member }) | null>(null);

  const q = useLoad(async () => {
    const [convs, rows] = await Promise.all([
      fetchConversations(),
      supabase.from('conversation_members').select('user_id, role, joined_at, profiles(id, full_name, avatar_url, is_verified, role)').eq('conversation_id', id)
        .then(async (r) => (r.error
          ? must(supabase.from('conversation_members').select('user_id, joined_at, profiles(id, full_name, avatar_url, is_verified, role)').eq('conversation_id', id))
          : r.data)),
    ]);
    return { conv: convs.find((x) => x.id === id) ?? null, rows: rows as unknown as Row_[] };
  }, [id], { key: `chat-info:${id}` });

  const conv = q.data?.conv ?? null;
  const isGroup = conv?.type === 'group';
  const manager = canManage(conv, isStaff);
  const owner = conv?.my_role === 'owner';
  const canInvite = isGroup && (manager || !!conv?.members_can_add);
  const rows = (q.data?.rows ?? []).filter((r): r is Row_ & { profiles: Member } => !!r.profiles)
    .sort((a, b) => (isGroup ? (RANK[a.role ?? 'member'] - RANK[b.role ?? 'member']) : (APP_RANK[a.profiles.role] - APP_RANK[b.profiles.role]))
      || Number(b.user_id === me.id) - Number(a.user_id === me.id)
      || a.profiles.full_name.localeCompare(b.profiles.full_name, 'ar'));
  const presence = usePresence(isGroup || conv?.type === 'direct' ? rows.map((r) => r.user_id).filter((u) => u !== me.id) : []);
  const online = Object.values(presence).filter((p) => p.online).length;

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error) return <Screen><Header /><ErrorBox message={q.error} onRetry={q.reload} /></Screen>;
  if (!conv) return <Screen><Header /><T dim center>لم تعد عضواً في هذه المحادثة.</T></Screen>;
  const name = conversationTitle(conv);

  const call = async (fn: string, args: Record<string, unknown>, failTitle: string) => {
    setBusy(true);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { Alert.alert(failTitle, error.message); return undefined; }
    return data ?? true;
  };

  const saveInfo = async () => {
    const ok = await call('group_update', { p_conversation: id, p_title: title.trim(), p_description: description.trim() }, 'تعذّر الحفظ');
    if (ok) { setEditing(false); q.reload(); }
  };
  const setFlag = async (key: 'p_admins_only' | 'p_members_can_add', value: boolean) => {
    if (await call('group_update', { p_conversation: id, [key]: value }, 'تعذّر الحفظ')) q.reload();
  };
  const toggleMute = async (muted: boolean) => {
    const { error } = await supabase.from('conversation_members').update({ muted }).eq('conversation_id', id).eq('user_id', me.id);
    if (error) Alert.alert('تعذّر الحفظ', error.message); else q.reload();
  };
  const loadInvite = async (reset = false) => {
    const code = await call('group_invite_code', { p_conversation: id, p_reset: reset }, 'تعذّر جلب الرابط');
    if (typeof code === 'string') setInvite(code);
  };
  const shareInvite = () => {
    if (!invite) return;
    Share.share({ message: `انضم إلى مجموعة «${name}» في تطبيق سعي:\n${inviteLink(invite)}\n\nأو من التطبيق: الدردشة ← رسالة جديدة ← الانضمام برمز: ${invite}` }).catch(() => {});
  };
  const leave = () => Alert.alert('مغادرة المجموعة', owner ? 'أنت المالك: تنتقل الملكية لأقدم مشرف (أو أقدم عضو).' : 'لن تصلك رسائلها بعد الآن.', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'مغادرة', style: 'destructive', onPress: async () => {
      if (await call('group_leave', { p_conversation: id }, 'تعذّرت المغادرة')) router.dismissTo('/chat');
    } },
  ]);
  const remove = () => Alert.alert('حذف المجموعة', 'تُحذف المجموعة وكل رسائلها عند كل الأعضاء. لا يمكن التراجع.', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'حذف', style: 'destructive', onPress: async () => {
      if (await call('group_delete', { p_conversation: id }, 'تعذّر الحذف')) router.dismissTo('/chat');
    } },
  ]);

  const memberActions = memberFor ? (() => {
    const target = memberFor.role ?? 'member';
    const self = memberFor.user_id === me.id;
    const canPromote = manager && !self && target === 'member';
    const canDemote = !self && target === 'admin' && (owner || isStaff);
    const canRemove = manager && !self && target !== 'owner' && (target !== 'admin' || owner || isStaff);
    return { canPromote, canDemote, canRemove, self };
  })() : null;

  return (
    <Screen>
      <Header />
      <View style={{ alignItems: 'center', gap: 8 }}>
        {conv.type === 'direct'
          ? <Avatar name={conv.peer_name ?? '؟'} url={conv.peer_avatar} size={96} verified={!!conv.peer_verified} />
          : <ConversationMark type={conv.type} title={name} size={96} />}
        <T display size={26} center>{name}</T>
        <T dim size={14}>
          {conv.type === 'group' ? 'مجموعة خاصة، ' : conv.type === 'school' ? 'دردشة المدرسة، ' : conv.type === 'section' ? 'دردشة الشعبة، ' : ''}
          {countOf(rows.length, 'عضو', 'عضوان', 'أعضاء', 'عضو واحد')}{online ? `، ${arDigits(online)} متصل` : ''}
        </T>
        {conv.description && !editing ? <T center size={15} style={{ marginTop: 4 }}>{conv.description}</T> : null}
      </View>

      {manager && editing ? (
        <Card style={{ gap: 10 }}>
          <Field label="اسم المجموعة" value={title} onChangeText={setTitle} maxLength={60} />
          <Field label="الوصف" value={description} onChangeText={setDescription} multiline maxLength={500} style={{ minHeight: 80 }} placeholder="عن ماذا هذه المجموعة؟" />
          <Row>
            <Button title="حفظ" onPress={saveInfo} loading={busy} disabled={!title.trim()} style={{ flex: 1 }} />
            <Button title="إلغاء" variant="secondary" onPress={() => setEditing(false)} style={{ flex: 1 }} />
          </Row>
        </Card>
      ) : manager ? (
        <Button title="تعديل الاسم والوصف" icon="edit" variant="secondary" onPress={() => { setTitle(conv.title ?? ''); setDescription(conv.description ?? ''); setEditing(true); }} />
      ) : null}

      <Card style={{ paddingVertical: 4 }}>
        <Row style={{ justifyContent: 'space-between', paddingVertical: 12 }}>
          <View style={{ flex: 1 }}>
            <T weight="bold" size={16}>كتم الإشعارات</T>
            <T dim size={13}>لا يصلك إشعار برسائلها (الإشارة إليك @ تصل)</T>
          </View>
          <Switch value={conv.muted} onValueChange={toggleMute} trackColor={{ true: c.accent, false: c.line }} accessibilityLabel="كتم الإشعارات" />
        </Row>
        {isGroup && manager ? (
          <>
            <Divider />
            <Row style={{ justifyContent: 'space-between', paddingVertical: 12 }}>
              <View style={{ flex: 1 }}>
                <T weight="bold" size={16}>النشر للمشرفين فقط</T>
                <T dim size={13}>الأعضاء يقرؤون ولا يكتبون</T>
              </View>
              <Switch value={!!conv.admins_only} onValueChange={(v) => setFlag('p_admins_only', v)} disabled={busy} trackColor={{ true: c.accent, false: c.line }} accessibilityLabel="النشر للمشرفين فقط" />
            </Row>
            <Divider />
            <Row style={{ justifyContent: 'space-between', paddingVertical: 12 }}>
              <View style={{ flex: 1 }}>
                <T weight="bold" size={16}>الأعضاء يضيفون غيرهم</T>
                <T dim size={13}>ويشاركون رابط الدعوة</T>
              </View>
              <Switch value={!!conv.members_can_add} onValueChange={(v) => setFlag('p_members_can_add', v)} disabled={busy} trackColor={{ true: c.accent, false: c.line }} accessibilityLabel="الأعضاء يضيفون غيرهم" />
            </Row>
          </>
        ) : null}
      </Card>

      {canInvite ? (
        <Card style={{ gap: 10 }}>
          <T weight="bold" size={16}>رابط الدعوة</T>
          {invite ? (
            <>
              <Pressable onPress={() => { Clipboard.setStringAsync(inviteLink(invite)); Alert.alert('نُسخ الرابط'); }} accessibilityLabel="نسخ الرابط"
                style={{ padding: 12, borderRadius: 14, backgroundColor: c.bg }}>
                <T size={14} color={c.accent} selectable style={{ writingDirection: 'ltr', textAlign: 'left' }}>{inviteLink(invite)}</T>
                <T dim size={12}>الرمز: {invite}</T>
              </Pressable>
              <Row>
                <Button title="مشاركة" icon="share" onPress={shareInvite} style={{ flex: 1 }} small />
                {manager ? <Button title="رابط جديد" icon="refresh" variant="secondary" small style={{ flex: 1 }} onPress={() => Alert.alert('رابط جديد', 'الرابط القديم يتوقف عن العمل.', [
                  { text: 'إلغاء', style: 'cancel' }, { text: 'تغيير', onPress: () => loadInvite(true) },
                ])} /> : null}
              </Row>
            </>
          ) : (
            <>
              <T dim size={13}>من يفتح الرابط ينضم للمجموعة مباشرة. شاركه مع من تريد فقط.</T>
              <Button title="إظهار الرابط" icon="link" variant="secondary" onPress={() => loadInvite()} loading={busy} small />
            </>
          )}
        </Card>
      ) : null}

      <View style={{ gap: 2 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T weight="bold" size={15}>الأعضاء ({arDigits(rows.length)})</T>
          {canInvite ? <Button title="إضافة" icon="user-plus" small variant="ghost" onPress={() => router.push({ pathname: '/chat/new-group', params: { add: id } })} /> : null}
        </Row>
        {rows.map((r) => {
          const p = presence[r.user_id];
          const seen = p ? lastSeenLabel(p.online, p.last_seen_at) : null;
          const tag = isGroup ? (r.role && r.role !== 'member' ? GROUP_ROLE_LABELS[r.role] : null) : (r.profiles.role !== 'student' ? ROLE_LABELS[r.profiles.role] : null);
          return (
            <Pressable key={r.user_id} onPress={() => setMemberFor(r)} accessibilityRole="button" accessibilityLabel={r.profiles.full_name}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
              <View>
                <Avatar name={r.profiles.full_name} url={r.profiles.avatar_url} size={44} verified={r.profiles.is_verified} />
                {p?.online ? <View style={{ position: 'absolute', bottom: 0, left: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: c.accent, borderWidth: 2, borderColor: c.bg }} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <NameLine name={r.user_id === me.id ? `${r.profiles.full_name} (أنت)` : r.profiles.full_name} verified={r.profiles.is_verified} />
                {seen && r.user_id !== me.id ? <T dim size={12}>{seen}</T> : null}
              </View>
              {tag ? (
                <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, backgroundColor: c.soft }}>
                  <T size={11} weight="bold" color={c.accent}>{tag}</T>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {isGroup ? (
        <Card style={{ paddingVertical: 2 }}>
          <ListItem icon="logout" title="مغادرة المجموعة" danger onPress={leave} />
          {owner || isAdmin ? (
            <>
              <Divider />
              <ListItem icon="trash" title="حذف المجموعة" danger onPress={remove} />
            </>
          ) : null}
        </Card>
      ) : null}

      <Sheet visible={!!memberFor} onClose={() => setMemberFor(null)}>
        {memberFor && memberActions ? (
          <View style={{ gap: 4 }}>
            <Row gap={12} style={{ paddingBottom: 8 }}>
              <Avatar name={memberFor.profiles.full_name} url={memberFor.profiles.avatar_url} size={48} />
              <View style={{ flex: 1 }}>
                <NameLine name={memberFor.profiles.full_name} verified={memberFor.profiles.is_verified} size={17} />
                {isGroup ? <T dim size={13}>{GROUP_ROLE_LABELS[memberFor.role ?? 'member']}</T> : null}
              </View>
            </Row>
            <SheetItem icon="user" label="الملف الشخصي" onPress={() => { setMemberFor(null); router.push(`/profile/${memberFor.user_id}`); }} />
            {!memberActions.self ? <SheetItem icon="chat" label="مراسلة" onPress={async () => {
              setMemberFor(null);
              const cid = await call('start_direct', { p_other: memberFor.user_id }, 'تعذّر بدء المحادثة');
              if (typeof cid === 'string') router.push(`/chat/${cid}`);
            }} /> : null}
            {memberActions.canPromote ? <SheetItem icon="check" label="تعيينه مشرفاً للمجموعة" onPress={async () => {
              setMemberFor(null);
              if (await call('group_set_admin', { p_conversation: id, p_user: memberFor.user_id, p_admin: true }, 'تعذّر التعيين')) q.reload();
            }} /> : null}
            {memberActions.canDemote ? <SheetItem icon="minus" label="إعادته عضواً" onPress={async () => {
              setMemberFor(null);
              if (await call('group_set_admin', { p_conversation: id, p_user: memberFor.user_id, p_admin: false }, 'تعذّر التغيير')) q.reload();
            }} /> : null}
            {memberActions.canRemove ? <SheetItem icon="trash" label="إزالة من المجموعة" danger onPress={() => {
              const target = memberFor;
              setMemberFor(null);
              Alert.alert('إزالة عضو', `إزالة ${target.profiles.full_name} من «${name}»؟`, [
                { text: 'إلغاء', style: 'cancel' },
                { text: 'إزالة', style: 'destructive', onPress: async () => {
                  if (await call('group_remove_member', { p_conversation: id, p_user: target.user_id }, 'تعذّرت الإزالة')) q.reload();
                } },
              ]);
            }} /> : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

