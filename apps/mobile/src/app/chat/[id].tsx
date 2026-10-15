import {
  PERIOD_LABELS, arDigits, countOf, formatTime, lastSeenLabel, messageReaders, messageStatus, toMs, typingLabel,
  type Attachment, type Message, type MessageStatus, type Profile, type Receipt,
} from '@saey/shared';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, I18nManager, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttachmentCard } from '@/components/attachment-card';
import { ImageViewer } from '@/components/image-viewer';
import { KeyboardView } from '@/components/motion';
import { Icon } from '@/components/icon';
import { ConversationMark } from '@/components/group-mark';
import { ForwardSheet } from '@/components/forward-sheet';
import { tap } from '@/components/motion';
import { Ticks } from '@/components/receipt';
import { Sheet, SheetItem } from '@/components/sheet';
import { Avatar, Field, IconButton, NameLine, Row, T, MAX_WIDTH } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import {
  ATTACHMENT_LABELS, REACTIONS, canManage, canPostIn, conversationTitle, fetchConversations,
  type ConversationRow, type CurriculumAttachment,
} from '@/lib/chat';
import { compressImage, signedUrls, uploadFile } from '@/lib/files';
import { readSnapshot, writeSnapshot } from '@/lib/offline';
import { cancel as cancelQueued, enqueue, flushOutbox, isOfflineError, onOutbox, pendingFor, uuid, type OutboxItem } from '@/lib/outbox';
import { usePresence } from '@/lib/presence';
import { must, supabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';
import { sendTyping, subscribeTyping, type Typist } from '@/lib/typing';

type Member = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'is_verified' | 'role'>;
interface ChatSnap { conv: ConversationRow | null; members: Record<string, Member>; messages: Message[]; receipts?: Receipt[] }
type MemberRow = Receipt & { role?: string; profiles: Member | null };

/** الأعضاء مع آخر قراءة ووصول (وإن كان الخادم أقدم: بلا «وصلت») */
async function fetchMembers(id: string): Promise<MemberRow[]> {
  const full = await supabase.from('conversation_members')
    .select('user_id, role, last_read_at, last_delivered_at, joined_at, profiles(id, full_name, avatar_url, is_verified, role)').eq('conversation_id', id);
  if (!full.error) return full.data as unknown as MemberRow[];
  const basic = await must(supabase.from('conversation_members')
    .select('user_id, last_read_at, joined_at, profiles(id, full_name, avatar_url, is_verified, role)').eq('conversation_id', id));
  return (basic as unknown as MemberRow[]).map((r) => ({ ...r, last_delivered_at: null }));
}
const toReceipts = (rows: MemberRow[]): Receipt[] =>
  rows.map((r) => ({ user_id: r.user_id, last_read_at: r.last_read_at, last_delivered_at: r.last_delivered_at ?? null, joined_at: r.joined_at }));
const isSystem = (m: Message) => m.kind === 'system';

/** رسالة من صندوق الصادر بشكل رسالة عادية (تظهر في المحادثة بانتظار الإنترنت) */
const fromOutbox = (x: OutboxItem): Message => ({
  id: x.id, conversation_id: x.conversation_id, sender_id: x.sender_id, body: x.body, attachment: null,
  reply_to_id: x.reply_to_id, mentions: x.mentions, created_at: x.created_at, edited_at: null, deleted_at: null, forwarded: !!x.forwarded,
} as unknown as Message);
const byNewest = (a: Message, b: Message) => (a.created_at < b.created_at ? 1 : -1);
interface Reaction { message_id: string; user_id: string; emoji: string }
const PAGE = 40;

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const me = useMe();
  const { isStaff } = useAuth();

  const [conv, setConv] = useState<ConversationRow | null>(null);
  const [members, setMembers] = useState<Record<string, Member>>({});
  // آخر قراءة ووصول لكل عضو ← علامات ✓ ✓✓
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  // لم يعد عضواً (أُزيل من المجموعة أو غادرها)
  const [removed, setRemoved] = useState(false);
  const [typists, setTypists] = useState<Typist[]>([]);
  // أول رسالة غير مقروءة عند الفتح ← فاصل «رسائل غير مقروءة»
  const [unreadFrom, setUnreadFrom] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [infoFor, setInfoFor] = useState<Message | null>(null);
  const [showDown, setShowDown] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Member[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [actionFor, setActionFor] = useState<Message | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // رسائل كُتبت بلا إنترنت وتنتظر في صندوق الصادر
  const [queued, setQueued] = useState<Set<string>>(() => new Set());
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  const fromSnap = useRef(false);
  const [forwardOf, setForwardOf] = useState<Message | null>(null);
  // الرسالة الأصلية بعد الضغط على اقتباس الرد: تومض لحظة
  const [highlight, setHighlight] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const hasMoreRef = useRef(true);
  hasMoreRef.current = hasMore;
  const inputRef = useRef<TextInput>(null);
  // الرسالة المؤقتة والمحفوظة تحملان نفس المفتاح حتى لا تومض الفقاعة عند الاستبدال
  const keyOf = useRef<Record<string, string>>({});

  const markRead = useCallback(() => {
    supabase.rpc('mark_read', { p_conversation: id }).then(() => {});
  }, [id]);

  const applyMembers = useCallback((rows: MemberRow[]) => {
    const map: Record<string, Member> = {};
    for (const row of rows) if (row.profiles) map[row.profiles.id] = row.profiles;
    setMembers(map);
    setReceipts(toReceipts(rows));
  }, []);

  // بعد رسالة نظام (إضافة، إزالة، تغيير الاسم أو الإعدادات): نعيد الأعضاء وبيانات المحادثة
  const reloadMeta = useCallback(async () => {
    try {
      const [convs, rows] = await Promise.all([fetchConversations(), fetchMembers(id)]);
      const found = convs.find((x) => x.id === id) ?? null;
      setConv(found);
      setRemoved(!found);
      applyMembers(rows);
    } catch {
      // يبقى الحال كما هو
    }
  }, [id, applyMembers]);

  const loadImages = useCallback(async (list: Message[]) => {
    const keys = list.filter((m) => m.attachment?.type === 'image' && !m.deleted_at)
      .map((m) => (m.attachment as { key: string }).key);
    if (!keys.length) return;
    try {
      const urls = await signedUrls(keys);
      setImages((prev) => ({ ...prev, ...urls }));
    } catch {
      // الصور تبقى بدون معاينة
    }
  }, []);

  const loadReactions = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const { data } = await supabase.from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids);
    setReactions((prev) => [...prev.filter((r) => !ids.includes(r.message_id)), ...((data ?? []) as Reaction[])]);
  }, []);

  // التحميل الأول: آخر ما ظهر (فوراً وبلا إنترنت) ثم الخادم
  useEffect(() => {
    let alive = true;
    (async () => {
      const [snap, waiting] = await Promise.all([readSnapshot<ChatSnap>(`chat:${id}`), pendingFor(id)]);
      if (!alive) return;
      const queuedMsgs = waiting.map(fromOutbox);
      if (queuedMsgs.length) setQueued(new Set(waiting.map((x) => x.id)));
      if (snap) {
        fromSnap.current = true;
        setConv(snap.conv);
        setMembers(snap.members);
        if (snap.receipts) setReceipts(snap.receipts);
        setMessages([...queuedMsgs, ...snap.messages.filter((m) => !waiting.some((x) => x.id === m.id))].sort(byNewest));
        setLoading(false);
      } else if (queuedMsgs.length) {
        setMessages(queuedMsgs);
      }
      try {
        const [convs, mem, msgs] = await Promise.all([
          fetchConversations(),
          fetchMembers(id),
          must(supabase.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: false }).limit(PAGE)),
        ]);
        const found = convs.find((x) => x.id === id) ?? null;
        setConv(found);
        setRemoved(!found);
        applyMembers(mem);
        const list = msgs as Message[];
        if (!alive) return;
        // فاصل «غير مقروءة»: من آخر قراءة قبل الفتح (قبل mark_read)
        const mine = mem.find((r) => r.user_id === me.id);
        if (mine) {
          const since = toMs(mine.last_read_at);
          const firstUnread = [...list].reverse().find((m) => m.sender_id !== me.id && !isSystem(m) && toMs(m.created_at) > since);
          setUnreadFrom(firstUnread?.id ?? null);
        }
        // المنتظر في صندوق الصادر يبقى ظاهراً فوق ما جاء من الخادم
        const still = await pendingFor(id);
        setMessages([...still.map(fromOutbox).filter((m) => !list.some((x) => x.id === m.id)), ...list].sort(byNewest));
        setHasMore(list.length === PAGE);
        loadImages(list);
        loadReactions(list.map((m) => m.id));
        markRead();
      } catch (e) {
        // بلا إنترنت ومعنا نسخة محفوظة: نعرضها بصمت (شريط «بدون إنترنت» يوضح الحال)
        if (alive && !fromSnap.current) Alert.alert('تعذّر فتح المحادثة', e instanceof Error ? e.message : '');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadImages, loadReactions, markRead, applyMembers]);

  // حفظ آخر ما ظهر (بدون المنتظر في الصادر — له مخزنه)
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      writeSnapshot(`chat:${id}`, {
        conv, members, receipts,
        messages: messages.filter((m) => !queuedRef.current.has(m.id) && !pendingRef.current.has(m.id)).slice(0, PAGE),
      } satisfies ChatSnap);
    }, 800);
    return () => clearTimeout(t);
  }, [id, conv, members, receipts, messages, loading]);

  // صندوق الصادر: رسالة منتظرة وصلت للخادم أو رُفضت
  useEffect(() => onOutbox((e) => {
    if (e.item.conversation_id !== id) return;
    setQueued((q) => { const n = new Set(q); n.delete(e.item.id); return n; });
    if (e.type === 'sent') {
      setMessages((prev) => prev.map((x) => (x.id === e.item.id ? e.message : x)));
    } else {
      setMessages((prev) => prev.filter((x) => x.id !== e.item.id));
      Alert.alert('لم تُرسل رسالة منتظرة', `«${e.item.body.slice(0, 60)}»\n${e.error}`);
    }
  }), [id]);

  // اللحظي
  const firstSub = useRef(false);
  useEffect(() => {
    const channel = supabase.channel(`conv:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, (p) => {
        const m = p.new as Message;
        // رسالتي التي أرسلها الآن: يضيفها رد الخادم (حتى لا تتكرر مؤقتاً)
        if (m.sender_id === me.id && pendingRef.current.size > 0) return;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [m, ...prev]));
        loadImages([m]);
        markRead();
        // رسالته وصلت ← توقف عن «يكتب…» فوراً
        setTypists((t) => t.filter((x) => x.user_id !== m.sender_id));
        if (isSystem(m)) reloadMeta();
        else if (!members[m.sender_id]) {
          supabase.from('profiles').select('id, full_name, avatar_url, is_verified, role').eq('id', m.sender_id).single()
            .then(({ data }) => data && setMembers((prev) => ({ ...prev, [data.id]: data as Member })));
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, (p) => {
        const m = p.new as Message;
        setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => {
        const old = p.old as { id: string };
        setMessages((prev) => prev.filter((x) => x.id !== old.id));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (p) => {
        const r = (p.new && 'message_id' in p.new ? p.new : p.old) as Reaction;
        if (r?.message_id) loadReactions([r.message_id]);
      })
      // الاسم والوصف والرسالة المثبّتة و«للمشرفين فقط»
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${id}` }, (p) => {
        const n = p.new as Partial<ConversationRow>;
        setConv((cur) => (cur ? {
          ...cur, title: n.title ?? cur.title, description: n.description ?? null, admins_only: n.admins_only ?? cur.admins_only,
          members_can_add: n.members_can_add ?? cur.members_can_add, pinned_message_id: n.pinned_message_id ?? null,
          only_staff_can_post: n.only_staff_can_post ?? cur.only_staff_can_post,
        } : cur));
      })
      // الحذف لا يُفلتر في Realtime: نفحص المحادثة بأنفسنا
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversation_members' }, (p) => {
        const old = p.old as { conversation_id?: string; user_id?: string };
        if (old.conversation_id !== id) return;
        if (old.user_id === me.id) { setRemoved(true); return; }
        setReceipts((prev) => prev.filter((r) => r.user_id !== old.user_id));
      })
      .subscribe((status) => {
        // بعد انقطاع (الهاتف نام أو التطبيق في الخلفية) يعود الاتصال لكن الرسائل التي وصلت أثناءه لا تُرسل؛ نجلبها
        if (status !== 'SUBSCRIBED') return;
        if (!firstSub.current) { firstSub.current = true; return; }
        supabase.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: false }).limit(PAGE)
          .then(({ data }) => {
            const fresh = (data ?? []) as Message[];
            if (!fresh.length) return;
            setMessages((prev) => {
              const byId = new Map(prev.filter((x) => !String(x.id).startsWith('tmp-')).map((x) => [x.id, x]));
              for (const m of fresh) byId.set(m.id, m);
              const pend = prev.filter((x) => String(x.id).startsWith('tmp-'));
              return [...pend, ...[...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))];
            });
            loadImages(fresh);
            markRead();
          });
        reloadMeta();
      });
    return () => {
      firstSub.current = false;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // «وصلت» و«قُرئت» لحظياً: الخاصة والمجموعات فقط (في المدرسة والشعب كل قراءة من مئات الطلاب ستصل للجميع)
  const liveReceipts = conv?.type === 'direct' || conv?.type === 'group';
  useEffect(() => {
    if (!liveReceipts) return;
    const ch = supabase.channel(`receipts:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${id}` }, (p) => {
        const r = p.new as Partial<Receipt> | undefined;
        if (!r?.user_id || !r.last_read_at || !r.joined_at) return;
        const next: Receipt = { user_id: r.user_id, last_read_at: r.last_read_at, last_delivered_at: r.last_delivered_at ?? null, joined_at: r.joined_at };
        setReceipts((prev) => (prev.some((x) => x.user_id === next.user_id) ? prev.map((x) => (x.user_id === next.user_id ? next : x)) : [...prev, next]));
        if (p.eventType === 'INSERT') reloadMeta();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, liveReceipts, reloadMeta]);

  // «يكتب…»
  useEffect(() => subscribeTyping(id, (list) => setTypists(list.filter((x) => x.user_id !== me.id))), [id, me.id]);
  const onType = (t: string) => {
    setText(t);
    if (!editing) sendTyping(id, { id: me.id, name: me.full_name }, t.trim().length > 0);
  };

  // الرسالة المثبّتة: من المحمّل أو من الخادم
  const pinnedId = conv?.pinned_message_id ?? null;
  useEffect(() => {
    if (!pinnedId) { setPinned(null); return; }
    const have = messagesRef.current.find((m) => m.id === pinnedId);
    if (have) { setPinned(have.deleted_at ? null : have); return; }
    supabase.from('messages').select('*').eq('id', pinnedId).maybeSingle()
      .then(({ data }) => setPinned(data && !(data as Message).deleted_at ? (data as Message) : null));
  }, [pinnedId]);

  // متصل الآن / آخر ظهور (الخاصة: الطرف الآخر · المجموعة: كم متصل)
  const presenceIds = useMemo(() => (conv?.type === 'direct' ? (conv.peer_id ? [conv.peer_id] : [])
    : conv?.type === 'group' ? receipts.map((r) => r.user_id).filter((u) => u !== me.id) : []), [conv?.type, conv?.peer_id, receipts, me.id]);
  const presence = usePresence(presenceIds);

  // onEndReached قد يُستدعى مرتين قبل وصول الرد: طلب واحد في الوقت نفسه، وبلا تكرار للرسائل
  const loadingOlder = useRef(false);
  const loadOlder = async () => {
    if (!hasMore || loading || !messages.length || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      const oldest = messages[messages.length - 1].created_at;
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', id)
        .lt('created_at', oldest).order('created_at', { ascending: false }).limit(PAGE);
      if (error) return;
      const list = (data ?? []) as Message[];
      setMessages((prev) => {
        const have = new Set(prev.map((x) => x.id));
        return [...prev, ...list.filter((x) => !have.has(x.id))];
      });
      setHasMore(list.length === PAGE);
      loadImages(list);
      loadReactions(list.map((m) => m.id));
    } finally {
      loadingOlder.current = false;
    }
  };

  // الضغط على اقتباس الرد: ننتقل للرسالة الأصلية (نجلب الأقدم إن لم تكن محمّلة) ونومّضها
  const jumpTo = async (target: string) => {
    let list = messagesRef.current;
    let more = hasMoreRef.current;
    for (let i = 0; i < 10 && more && !list.some((m) => m.id === target); i++) {
      const oldest = list[list.length - 1]?.created_at;
      if (!oldest) break;
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', id)
        .lt('created_at', oldest).order('created_at', { ascending: false }).limit(PAGE);
      if (error) break;
      const older = (data ?? []) as Message[];
      more = older.length === PAGE;
      list = [...list, ...older.filter((m) => !list.some((x) => x.id === m.id))];
      setHasMore(more);
      setMessages((prev) => [...prev, ...older.filter((m) => !prev.some((x) => x.id === m.id))]);
      loadImages(older);
      loadReactions(older.map((m) => m.id));
      if (!older.length) break;
    }
    if (!list.some((m) => m.id === target)) {
      Alert.alert('الرسالة الأصلية غير متاحة', 'ربما حُذفت أو أنها قديمة جداً.');
      return;
    }
    setTimeout(() => {
      const index = messagesRef.current.findIndex((m) => m.id === target);
      if (index < 0) return;
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      setHighlight(target);
      setTimeout(() => setHighlight((h) => (h === target ? null : h)), 1600);
    }, 60);
  };

  // الإشارة @
  const mentionQuery = useMemo(() => {
    const m = text.match(/@([^\s@]*)$/);
    return m ? m[1] : null;
  }, [text]);
  const mentionOptions = mentionQuery === null ? [] : Object.values(members)
    .filter((p) => p.id !== me.id && p.full_name.includes(mentionQuery))
    .slice(0, 6);
  const pickMention = (p: Member) => {
    const short = p.full_name.split(' ').slice(0, 2).join('_');
    setText((t) => t.replace(/@([^\s@]*)$/, `@${short} `));
    setMentions((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
  };

  const send = async (attachment?: Attachment) => {
    const body = text.trim();
    if (!body && !attachment) return;
    if (editing) {
      setSending(true);
      const { error } = await supabase.from('messages').update({ body }).eq('id', editing.id);
      setSending(false);
      if (error) return Alert.alert('لم تُعدّل الرسالة', error.message);
      setMessages((prev) => prev.map((x) => (x.id === editing.id ? { ...x, body, edited_at: new Date().toISOString() } : x)));
      setEditing(null);
      setText('');
      return;
    }
    // الرسالة تظهر فوراً (قبل رد الخادم) ثم تُستبدل بالنسخة المحفوظة
    const mentionIds = mentions.filter((p) => body.includes(`@${p.full_name.split(' ').slice(0, 2).join('_')}`)).map((p) => p.id);
    // معرّف ثابت من الهاتف: نفس الرسالة إن أُعيد إرسالها لا تتكرر
    const tempId = uuid();
    const temp = {
      id: tempId, conversation_id: id, sender_id: me.id, body: body || null, attachment: attachment ?? null,
      reply_to_id: replyTo?.id ?? null, mentions: mentionIds, created_at: new Date().toISOString(), edited_at: null, deleted_at: null,
    } as unknown as Message;
    setMessages((prev) => [temp, ...prev]);
    setPending((p) => new Set(p).add(tempId));
    const savedText = text;
    setText('');
    sendTyping(id, { id: me.id, name: me.full_name }, false);
    setMentions([]);
    setReplyTo(null);
    const { data, error } = await supabase.from('messages').insert({
      id: tempId,
      conversation_id: id,
      sender_id: me.id,
      body: body || null,
      attachment: attachment ?? null,
      reply_to_id: temp.reply_to_id,
      mentions: mentionIds,
    }).select('*').single();
    setPending((p) => { const n = new Set(p); n.delete(tempId); return n; });
    if ((error || !data) && !attachment && body && isOfflineError(error)) {
      // بلا إنترنت: تبقى في المحادثة بانتظار الاتصال وتُرسل وحدها عند عودته
      await enqueue({ id: tempId, conversation_id: id, sender_id: me.id, body, reply_to_id: temp.reply_to_id, mentions: mentionIds, created_at: temp.created_at });
      setQueued((q) => new Set(q).add(tempId));
      flushOutbox().catch(() => {});
      return;
    }
    if (error || !data) {
      setMessages((prev) => prev.filter((x) => x.id !== tempId));
      setText((t) => t || savedText);
      Alert.alert('لم تُرسل الرسالة', error?.message ?? 'تحقق من الإنترنت وحاول مرة أخرى');
      return;
    }
    keyOf.current[data.id] = tempId;
    setMessages((prev) => {
      const rest = prev.filter((x) => x.id !== tempId);
      return rest.some((x) => x.id === data.id) ? rest : [data as Message, ...rest];
    });
    if (attachment) loadImages([data as Message]);
  };

  const sendImage = async (fromCamera: boolean) => {
    setAttachOpen(false);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9 };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return;
    setSending(true);
    try {
      const img = await compressImage(res.assets[0].uri);
      const key = await uploadFile(img.uri, 'chat', 'image/jpeg', id);
      await send({ type: 'image', key, width: img.width, height: img.height });
    } catch (e) {
      Alert.alert('تعذّر إرسال الصورة', e instanceof Error ? e.message : '');
    } finally {
      setSending(false);
    }
  };

  // ملف PDF من الهاتف (حتى ٢٥ ميغا)
  const sendPdf = async () => {
    setAttachOpen(false);
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const f = res.assets[0];
    if ((f.size ?? 0) > 25 * 1048576) return Alert.alert('الملف كبير', 'أقصى حجم لملف PDF في الدردشة ٢٥ ميغا.');
    setSending(true);
    try {
      const key = await uploadFile(f.uri, 'chat', 'application/pdf', id);
      await send({ type: 'file', key, title: (f.name || 'ملف').replace(/\.pdf$/i, ''), size: f.size ?? undefined });
    } catch (e) {
      Alert.alert('تعذّر إرسال الملف', e instanceof Error ? e.message : '');
    } finally {
      setSending(false);
    }
  };

  const react = async (m: Message, emoji: string) => {
    setActionFor(null);
    const mine = reactions.find((r) => r.message_id === m.id && r.user_id === me.id && r.emoji === emoji);
    if (mine) await supabase.from('message_reactions').delete().match({ message_id: m.id, user_id: me.id, emoji });
    else await supabase.from('message_reactions').insert({ message_id: m.id, user_id: me.id, emoji });
    loadReactions([m.id]);
  };

  const remove = async (m: Message) => {
    setActionFor(null);
    const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString(), body: null }).eq('id', m.id);
    if (error) Alert.alert('تعذّر الحذف', error.message);
  };

  const canPost = canPostIn(conv, isStaff) && !removed;
  const title = conv ? conversationTitle(conv) : '';
  const isGroup = conv?.type !== 'direct';
  const byId = useMemo(() => Object.fromEntries(messages.map((m) => [m.id, m])), [messages]);
  // التثبيت: الخاصة الطرفان، المجموعة مشرفوها، المدرسة والشعبة الإدارة
  const canPin = !removed && (conv?.type === 'direct' || canManage(conv, isStaff) || (isStaff && !!conv));
  const statusOf = (m: Message): MessageStatus => (liveReceipts ? messageStatus(m.created_at, me.id, receipts) : 'sent');
  const pin = async (m: Message | null) => {
    setActionFor(null);
    const { error } = await supabase.rpc('pin_message', { p_conversation: id, p_message: m?.id ?? null });
    if (error) return Alert.alert(m ? 'تعذّر التثبيت' : 'تعذّر إلغاء التثبيت', error.message);
    setConv((cur) => (cur ? { ...cur, pinned_message_id: m?.id ?? null } : cur));
  };

  const typing = typingLabel(typists.map((t) => members[t.user_id]?.full_name ?? t.name), isGroup);
  const onlineCount = conv?.type === 'group' ? Object.values(presence).filter((p) => p.online).length : 0;
  const peerSeen = conv?.type === 'direct' && conv.peer_id && presence[conv.peer_id]
    ? lastSeenLabel(presence[conv.peer_id].online, presence[conv.peer_id].last_seen_at) : null;
  const subtitle = typing ?? (isGroup
    ? `${countOf(conv?.member_count ?? Object.keys(members).length, 'عضو', 'عضوان', 'أعضاء', 'عضو واحد')}${onlineCount ? `، ${arDigits(onlineCount)} متصل` : ''}`
    : peerSeen ?? 'محادثة خاصة');

  return (
    <KeyboardView style={{ flex: 1, backgroundColor: c.bg }} bottomInset={insets.bottom}>
      {/* الرأس */}
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Row>
          <IconButton name="back" label="رجوع" onPress={() => router.back()} size={40} />
          <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
            accessibilityLabel={isGroup ? 'معلومات المحادثة' : 'الملف الشخصي'}
            onPress={() => {
              if (conv?.type === 'direct') { if (conv.peer_id) router.push(`/profile/${conv.peer_id}`); }
              else router.push({ pathname: '/chat/info/[id]', params: { id } });
            }}>
            {conv?.type === 'direct'
              ? <Avatar name={conv.peer_name ?? '؟'} url={conv.peer_avatar} size={38} />
              : <ConversationMark type={conv?.type ?? 'group'} title={title} size={38} />}
            <View style={{ flex: 1 }}>
              <NameLine name={title} verified={conv?.type === 'direct' && !!conv.peer_verified} size={16} />
              <T dim={!typing} size={12} lines={1} weight={typing ? 'bold' : undefined} color={typing ? c.accent : undefined}>{subtitle}</T>
            </View>
          </Pressable>
          <IconButton name="search" label="بحث في المحادثة" size={40} onPress={() => setSearchOpen(true)} />
        </Row>
      </View>

      {/* الرسالة المثبّتة */}
      {pinned ? (
        <Pressable onPress={() => jumpTo(pinned.id)} accessibilityRole="button" accessibilityLabel="الرسالة المثبّتة"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <Icon name="pin" size={18} color={c.accent} />
          <View style={{ flex: 1 }}>
            <T size={12} weight="bold" color={c.accent}>رسالة مثبّتة</T>
            <T size={13} lines={1}>{pinned.body ?? (pinned.attachment?.type === 'image' ? 'صورة' : pinned.attachment && 'title' in pinned.attachment ? pinned.attachment.title : 'مرفق')}</T>
          </View>
          {canPin ? <IconButton name="close" label="إلغاء التثبيت" size={32} onPress={() => pin(null)} /> : null}
        </Pressable>
      ) : null}

      {loading ? <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} /> : (
        <FlatList
          ref={listRef}
          inverted
          data={messages}
          onScrollToIndexFailed={(info) => {
            // العنصر لم يُرسم بعد: نقترب منه تقريبياً ثم نعيد المحاولة
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 120);
          }}
          keyExtractor={(m) => keyOf.current[m.id] ?? m.id}
          contentContainerStyle={{ padding: 12, gap: 4, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' }}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          onScroll={(e) => { const far = e.nativeEvent.contentOffset.y > 600; if (far !== showDown) setShowDown(far); }}
          scrollEventThrottle={100}
          renderItem={({ item, index }) => {
            const older = messages[index + 1];
            const showName = isGroup && item.sender_id !== me.id && (older?.sender_id !== item.sender_id || (older && isSystem(older)));
            const dayChanged = !older || new Date(older.created_at).toDateString() !== new Date(item.created_at).toDateString();
            const day = dayChanged ? (
              <View style={{ alignSelf: 'center', marginVertical: 10, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: c.card }}>
                <T dim size={12}>{new Date(item.created_at).toDateString() === new Date().toDateString() ? 'اليوم' : new Date(item.created_at).toLocaleDateString('ar-IQ')}</T>
              </View>
            ) : null;
            const unreadBar = unreadFrom === item.id ? (
              <View style={{ alignSelf: 'stretch', alignItems: 'center', marginVertical: 8, paddingVertical: 4, backgroundColor: c.soft, borderRadius: 999 }}>
                <T size={12} weight="bold" color={c.accent}>رسائل غير مقروءة</T>
              </View>
            ) : null;
            if (isSystem(item)) {
              return (
                <View>
                  {day}
                  <View style={{ alignSelf: 'center', maxWidth: '88%', marginVertical: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.line }}>
                    <T dim size={12} center>{item.body}</T>
                  </View>
                </View>
              );
            }
            return (
              <View style={{ borderRadius: 16, backgroundColor: highlight === item.id ? c.soft : 'transparent' }}>
                {day}
                {unreadBar}
                <Bubble
                  m={item}
                  mine={item.sender_id === me.id}
                  sender={members[item.sender_id]}
                  showName={showName}
                  reply={item.reply_to_id ? byId[item.reply_to_id] : undefined}
                  onReplyPress={item.reply_to_id ? () => jumpTo(item.reply_to_id!) : undefined}
                  onSwipeReply={item.deleted_at || queued.has(item.id) || pending.has(item.id) || !canPost ? undefined : () => {
                    setEditing(null);
                    setReplyTo(item);
                    inputRef.current?.focus();
                  }}
                  replySender={item.reply_to_id && byId[item.reply_to_id] ? members[byId[item.reply_to_id].sender_id]?.full_name : undefined}
                  imageUrl={item.attachment?.type === 'image' ? images[item.attachment.key] : undefined}
                  reactions={reactions.filter((r) => r.message_id === item.id)}
                  myId={me.id}
                  pending={pending.has(item.id)}
                  queued={queued.has(item.id)}
                  status={item.sender_id === me.id && !pending.has(item.id) && !queued.has(item.id) && !item.deleted_at ? statusOf(item) : undefined}
                  onImage={setViewing}
                  onLongPress={() => {
                    if (queued.has(item.id)) {
                      Alert.alert('رسالة بانتظار الإنترنت', 'تُرسل تلقائياً عند عودة الاتصال.', [
                        { text: 'إبقاء', style: 'cancel' },
                        { text: 'حذفها', style: 'destructive', onPress: () => {
                          cancelQueued(item.id).catch(() => {});
                          setQueued((q) => { const n = new Set(q); n.delete(item.id); return n; });
                          setMessages((prev) => prev.filter((x) => x.id !== item.id));
                        } },
                      ]);
                      return;
                    }
                    if (!item.deleted_at && !pending.has(item.id)) setActionFor(item);
                  }}
                  onReact={(e) => react(item, e)}
                />
              </View>
            );
          }}
        />
      )}

      {/* اقتراحات الإشارة */}
      {mentionOptions.length > 0 ? (
        <View style={{ backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line, maxHeight: 220 }}>
          <ScrollView keyboardShouldPersistTaps="always">
            {mentionOptions.map((p) => (
              <Pressable key={p.id} onPress={() => pickMention(p)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
                <Avatar name={p.full_name} url={p.avatar_url} size={32} />
                <NameLine name={p.full_name} verified={p.is_verified} size={14} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* شريط الرد/التعديل */}
      {replyTo || editing ? (
        <Row style={{ backgroundColor: c.card, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.line }}>
          <View style={{ width: 3, alignSelf: 'stretch', backgroundColor: c.accent, borderRadius: 2 }} />
          <View style={{ flex: 1 }}>
            <T size={12} weight="bold" color={c.accent}>{editing ? 'تعديل الرسالة' : `رد على ${members[replyTo!.sender_id]?.full_name ?? ''}`}</T>
            <T dim size={13} lines={1}>{(editing ?? replyTo)!.body ?? 'مرفق'}</T>
          </View>
          <IconButton name="close" label="إلغاء" size={32} onPress={() => { setReplyTo(null); if (editing) { setEditing(null); setText(''); } }} />
        </Row>
      ) : null}

      {/* مربع الكتابة */}
      {canPost ? (
        <Row gap={8} style={{ backgroundColor: c.card, paddingTop: 10, paddingBottom: insets.bottom + 10, borderTopWidth: replyTo || editing ? 0 : 1, borderTopColor: c.line, alignItems: 'flex-end', paddingHorizontal: Math.max(12, (width - MAX_WIDTH) / 2) }}>
          {!editing ? <IconButton name="paperclip" label="إرفاق" size={44} onPress={() => setAttachOpen(true)} /> : null}
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={onType}
            placeholder="اكتب رسالة…"
            placeholderTextColor={c.ink3}
            multiline
            style={{
              flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, backgroundColor: c.bg, paddingHorizontal: 16, paddingVertical: 10,
              fontFamily: fonts.regular, fontSize: 16, color: c.ink, writingDirection: 'rtl',
            }}
          />
          <Pressable onPress={() => send()} disabled={sending || !text.trim()} accessibilityLabel="إرسال"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? c.accent : c.line, alignItems: 'center', justifyContent: 'center' }}>
            {sending ? <ActivityIndicator color={c.accentInk} /> : <Icon name={editing ? 'check' : 'send'} size={20} color={text.trim() ? c.accentInk : c.ink3} strokeWidth={2} />}
          </Pressable>
        </Row>
      ) : (
        <View style={{ backgroundColor: c.card, padding: 16, paddingBottom: insets.bottom + 16, borderTopWidth: 1, borderTopColor: c.line }}>
          <T dim center size={13}>{removed ? 'لم تعد عضواً في هذه المحادثة'
            : conv?.only_staff_can_post ? 'هذه قناة إعلانات — النشر للأدمن والمشرفين فقط'
            : 'النشر في هذه المجموعة لمشرفيها فقط'}</T>
        </View>
      )}

      {/* قائمة الإجراءات */}
      <Sheet visible={!!actionFor} onClose={() => setActionFor(null)}>
        {actionFor ? (
          <View style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-around', paddingVertical: 6 }}>
              {REACTIONS.map((e) => (
                <Pressable key={e} onPress={() => react(actionFor, e)} style={{ padding: 8 }} accessibilityLabel={`تفاعل ${e}`}>
                  <T size={28} style={{ lineHeight: 36 }}>{e}</T>
                </Pressable>
              ))}
            </Row>
            {canPost ? <SheetItem icon="reply" label="رد" onPress={() => { setReplyTo(actionFor); setActionFor(null); inputRef.current?.focus(); }} /> : null}
            {actionFor.sender_id === me.id && !queued.has(actionFor.id) ? <SheetItem icon="info" label="معلومات الرسالة" onPress={() => { setInfoFor(actionFor); setActionFor(null); }} /> : null}
            {canPin ? (pinnedId === actionFor.id
              ? <SheetItem icon="pin" label="إلغاء التثبيت" onPress={() => pin(null)} />
              : <SheetItem icon="pin" label="تثبيت" onPress={() => pin(actionFor)} />) : null}
            <SheetItem icon="forward-msg" label="إعادة توجيه" onPress={() => { setForwardOf(actionFor); setActionFor(null); }} />
 {actionFor.body ? <SheetItem icon="sparkles" label="اسأل مساعد سعي عنها" onPress={() => { const b = actionFor.body ?? ''; setActionFor(null); router.push({ pathname: '/ai', params: { prompt: b } }); }} /> : null}
            {actionFor.body ? <SheetItem icon="copy" label="نسخ النص" onPress={() => { Clipboard.setStringAsync(actionFor.body ?? ''); setActionFor(null); }} /> : null}
            {actionFor.sender_id === me.id && actionFor.body && !actionFor.forwarded ? (
              <SheetItem icon="edit" label="تعديل" onPress={() => { setEditing(actionFor); setText(actionFor.body ?? ''); setActionFor(null); inputRef.current?.focus(); }} />
            ) : null}
            {actionFor.sender_id === me.id || isStaff ? <SheetItem icon="trash" label="حذف" danger onPress={() => remove(actionFor)} /> : null}
          </View>
        ) : null}
      </Sheet>

      {/* الإرفاق */}
      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)}>
        <SheetItem icon="camera" label="الكاميرا" onPress={() => sendImage(true)} />
        <SheetItem icon="image" label="صورة من المعرض" onPress={() => sendImage(false)} />
        <SheetItem icon="file" label="ملف PDF" onPress={sendPdf} />
        <SheetItem icon="book" label="من المنهج (محاضرة، ملزمة، أسئلة)" onPress={() => { setAttachOpen(false); setCurriculumOpen(true); }} />
        <SheetItem icon="sparkles" label={text.trim() ? 'اسأل مساعد سعي عمّا كتبته' : 'اسأل مساعد سعي'} onPress={() => {
          setAttachOpen(false);
          router.push({ pathname: '/ai', params: text.trim() ? { prompt: text.trim() } : {} });
        }} />
      </Sheet>
      <SearchSheet visible={searchOpen} conversationId={id} members={members} onClose={() => setSearchOpen(false)}
        onPick={(m) => { setSearchOpen(false); jumpTo(m.id); }} />
      <InfoSheet message={infoFor} receipts={receipts} members={members} myId={me.id} direct={conv?.type === 'direct'} onClose={() => setInfoFor(null)} />
      {showDown ? (
        <Pressable onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} accessibilityRole="button" accessibilityLabel="آخر الرسائل"
          style={{ position: 'absolute', left: 16, bottom: insets.bottom + 90, width: 44, height: 44, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow-down" size={20} color={c.ink} />
        </Pressable>
      ) : null}
      <CurriculumPicker visible={curriculumOpen} onClose={() => setCurriculumOpen(false)}
        onPick={(a) => { setCurriculumOpen(false); send(a); }} />
      <ImageViewer url={viewing} onClose={() => setViewing(null)} />
      <ForwardSheet message={forwardOf} fromConversation={id} onClose={() => setForwardOf(null)} />
    </KeyboardView>
  );
}

// ---------------------------------------------------------------- الفقاعة
const SWIPE = 64;
// التطبيق يقلب يسار/يمين في وضع RTL (swapLeftAndRightInRTL)، والسحب بالبكسل الفعلي: نحدد الجهة الفعلية
const FLIP = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL;
const PHYS_LEFT = FLIP ? { right: 0 } : { left: 0 };
const PHYS_RIGHT = FLIP ? { left: 0 } : { right: 0 };

function Bubble({ m, mine, sender, showName, reply, replySender, imageUrl, reactions, myId, pending, queued, status, onLongPress, onReact, onImage, onReplyPress, onSwipeReply }: {
  m: Message; mine: boolean; sender?: Member; showName: boolean; reply?: Message; replySender?: string; status?: MessageStatus;
  onReplyPress?: () => void; onSwipeReply?: () => void;
  imageUrl?: string; reactions: Reaction[]; myId: string; pending?: boolean; queued?: boolean; onLongPress: () => void; onReact: (e: string) => void;
  onImage: (url: string) => void;
}) {
  const { c } = useTheme();
  const bg = mine ? c.bubbleMine : c.bubbleOther;
  const fg = mine ? c.bubbleMineInk : c.ink;
  const sub = mine ? 'rgba(255,255,255,0.75)' : c.ink2;
  const grouped = Object.entries(reactions.reduce<Record<string, number>>((a, r) => ({ ...a, [r.emoji]: (a[r.emoji] ?? 0) + 1 }), {}));
  const a = m.attachment;
  // الرسائل الجديدة فقط تدخل بحركة (لا نحرّك السجل القديم عند الفتح أو التمرير)
  const [fresh] = useState(() => Date.now() - new Date(m.created_at).getTime() < 5000);

  // السحب الأفقي على الفقاعة = رد (مثل واتساب وتيليجرام)؛ الاهتزاز عند تجاوز الحد
  const tx = useSharedValue(0);
  const armed = useSharedValue(false);
  const swipe = Gesture.Pan()
    .enabled(!!onSwipeReply)
    .activeOffsetX([-18, 18])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      const d = e.translationX;
      // مقاومة بعد الحد
      tx.value = Math.sign(d) * (Math.abs(d) < SWIPE ? Math.abs(d) : SWIPE + (Math.abs(d) - SWIPE) * 0.25);
      const over = Math.abs(d) >= SWIPE;
      if (over !== armed.value) {
        armed.value = over;
        if (over) runOnJS(tap)('select');
      }
    })
    .onEnd(() => {
      if (armed.value && onSwipeReply) runOnJS(onSwipeReply)();
      armed.value = false;
      tx.value = withSpring(0, { damping: 20, stiffness: 260 });
    });
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  // أيقونة الرد تظهر في الفراغ الذي يتركه السحب (يسار الشاشة عند السحب يميناً والعكس)
  const leftIcon = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [10, SWIPE], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(tx.value, [10, SWIPE], [0.6, 1], 'clamp') }],
  }));
  const rightIcon = useAnimatedStyle(() => ({
    opacity: interpolate(-tx.value, [10, SWIPE], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(-tx.value, [10, SWIPE], [0.6, 1], 'clamp') }],
  }));
  const replyIcon = (
    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="reply" size={16} color={c.accent} />
    </View>
  );

  return (
    <View>
    {onSwipeReply ? (
      <>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 6 }, PHYS_LEFT, leftIcon]}>{replyIcon}</Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 6 }, PHYS_RIGHT, rightIcon]}>{replyIcon}</Animated.View>
      </>
    ) : null}
    <GestureDetector gesture={swipe}>
    <Animated.View
      entering={fresh ? FadeIn.duration(120) : undefined}
      style={[{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginTop: showName ? 8 : 0 }, rowStyle]}>
      {showName && sender ? (
        <View style={{ marginBottom: 2, paddingHorizontal: 6 }}>
          <NameLine name={sender.full_name} verified={sender.is_verified} size={12} />
        </View>
      ) : null}
      <Pressable onLongPress={onLongPress} delayLongPress={250}
        style={{ backgroundColor: bg, borderRadius: 20, borderWidth: mine ? 0 : 1, borderColor: c.line, padding: a?.type === 'image' && !m.body ? 4 : 10, paddingHorizontal: a?.type === 'image' && !m.body ? 4 : 14, gap: 6 }}>
        {m.deleted_at ? (
          <T size={14} color={sub} style={{ fontStyle: 'italic' }}>رسالة محذوفة</T>
        ) : (
          <>
            {m.forwarded ? (
              <Row gap={4}>
                <Icon name="forward-msg" size={13} color={sub} />
                <T size={11} color={sub} style={{ fontStyle: 'italic' }}>مُعاد توجيهها</T>
              </Row>
            ) : null}
            {m.reply_to_id ? (
              <Pressable onPress={onReplyPress} disabled={!onReplyPress} accessibilityRole="button" accessibilityLabel="الانتقال للرسالة الأصلية"
                style={{ borderRightWidth: 3, borderRightColor: mine ? '#FFFFFF' : c.accent, paddingRight: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: mine ? 'rgba(255,255,255,0.12)' : c.soft }}>
                {reply ? (
                  <>
                    <T size={12} weight="bold" color={mine ? fg : c.accent}>{replySender ?? ''}</T>
                    <T size={13} color={fg} lines={2}>{reply.deleted_at ? 'رسالة محذوفة' : reply.body ?? (reply.attachment?.type === 'image' ? 'صورة' : 'مرفق')}</T>
                  </>
                ) : <T size={13} color={fg}>رد على رسالة أقدم — اضغط للانتقال</T>}
              </Pressable>
            ) : null}
            {a?.type === 'image' ? (
              imageUrl ? (
                <Pressable onPress={() => onImage(imageUrl)} onLongPress={onLongPress} delayLongPress={250} accessibilityRole="imagebutton" accessibilityLabel="فتح الصورة">
                  <Image source={{ uri: imageUrl }} contentFit="cover" transition={150}
                    style={{ width: 240, height: a.width && a.height ? Math.min(320, (240 * a.height) / a.width) : 240, borderRadius: 16 }} />
                </Pressable>
              ) : <View style={{ width: 240, height: 180, borderRadius: 16, backgroundColor: c.line }} />
            ) : a ? <AttachmentCard a={a} mine={mine} messageId={m.id} /> : null}
            {m.body ? <T size={15} color={fg} selectable>{renderMentions(m.body, mine ? '#FFFFFF' : c.accent)}</T> : null}
          </>
        )}
        <Row gap={4} style={{ alignSelf: 'flex-end' }}>
          <T size={10} color={sub} style={{ lineHeight: 17 }}>
            {m.edited_at && !m.deleted_at ? 'معدّلة · ' : ''}{formatTime(new Date(m.created_at))}{mine && queued ? ' · بانتظار الإنترنت' : ''}
          </T>
          {mine && (pending || status) ? <Ticks status={pending ? 'pending' : status!} color={sub} readColor={mine ? '#FFFFFF' : c.accent} size={13} /> : null}
        </Row>
      </Pressable>
      {grouped.length ? (
        <Row gap={4} style={{ marginTop: -6, paddingHorizontal: 8, alignSelf: mine ? 'flex-start' : 'flex-end' }}>
          {grouped.map(([emoji, n]) => {
            const mineR = reactions.some((r) => r.emoji === emoji && r.user_id === myId);
            return (
              <Pressable key={emoji} onPress={() => onReact(emoji)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: mineR ? c.soft : c.card, borderWidth: 1, borderColor: mineR ? c.accent : c.line }}>
                <T size={12} style={{ lineHeight: 18 }}>{emoji}</T>
                {n > 1 ? <T size={11} weight="bold">{arDigits(n)}</T> : null}
              </Pressable>
            );
          })}
        </Row>
      ) : null}
    </Animated.View>
    </GestureDetector>
    </View>
  );
}

function renderMentions(body: string, color: string) {
  return body.split(/(@[^\s@]+)/g).map((part, i) =>
    part.startsWith('@') ? <T key={i} size={15} weight="bold" color={color}>{part.replace(/_/g, ' ')}</T> : part);
}

// ---------------------------------------------------------------- اختيار من المنهج
function CurriculumPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (a: Attachment) => void }) {
  const { c } = useTheme();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CurriculumAttachment[]>([]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(async () => {
      const like = `%${search.trim()}%`;
      const [l, d, qs] = await Promise.all([
        supabase.from('lectures').select('id, title, youtube_id, teachers(name)').eq('is_published', true).ilike('title', like).limit(8),
        supabase.from('documents').select('id, title, pages, subjects(name)').eq('is_published', true).ilike('title', like).limit(8),
        supabase.from('question_sets').select('id, title, period, subjects(name)').eq('status', 'published').ilike('title', like).limit(8),
      ]);
      type Row = { id: string; title: string; youtube_id?: string; pages?: number | null; period?: string;
        teachers?: { name: string } | null; subjects?: { name: string } | null };
      const one = <K,>(v: K | K[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined;
      setResults([
        ...((l.data ?? []) as unknown as Row[]).map((x) => ({
          type: 'lecture' as const, id: x.id, title: x.title, thumb: x.youtube_id,
          subtitle: one(x.teachers)?.name ? `الأستاذ ${one(x.teachers)!.name}` : undefined,
        })),
        ...((d.data ?? []) as unknown as Row[]).map((x) => ({
          type: 'document' as const, id: x.id, title: x.title,
          subtitle: [one(x.subjects)?.name, x.pages ? `${arDigits(x.pages)} صفحة` : null].filter(Boolean).join(' · ') || undefined,
        })),
        ...((qs.data ?? []) as unknown as Row[]).map((x) => ({
          type: 'question_set' as const, id: x.id, title: x.title,
          subtitle: [one(x.subjects)?.name, x.period ? PERIOD_LABELS[x.period as keyof typeof PERIOD_LABELS] : null].filter(Boolean).join(' · ') || undefined,
        })),
      ]);
    }, 250);
    return () => clearTimeout(t);
  }, [search, visible]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <T display size={22}>إرفاق من المنهج</T>
      <Field placeholder="ابحث عن محاضرة أو ملزمة أو أسئلة" value={search} onChangeText={setSearch} />
      <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
        {results.length === 0 ? <T dim center style={{ paddingVertical: 20 }}>لا نتائج</T> : results.map((r) => (
          <Pressable key={`${r.type}${r.id}`} onPress={() => onPick(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
            <Icon name={r.type === 'lecture' ? 'play' : r.type === 'document' ? 'file' : 'quiz'} size={20} color={c.accent} />
            <View style={{ flex: 1 }}>
              <T weight="bold" lines={1}>{r.title}</T>
              <T dim size={12}>{ATTACHMENT_LABELS[r.type]}{r.subtitle ? ` · ${r.subtitle}` : ''}</T>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

// ---------------------------------------------------------------- البحث في المحادثة
function SearchSheet({ visible, conversationId, members, onClose, onPick }: {
  visible: boolean; conversationId: string; members: Record<string, Member>; onClose: () => void; onPick: (m: Message) => void;
}) {
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Message[] | null>(null);
  useEffect(() => {
    if (!visible) { setQ(''); setResults(null); return; }
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      // % و _ و , حروف خاصة في البحث: تُزال من النص
      const safe = term.replace(/[%_,()]/g, ' ');
      const { data } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).is('deleted_at', null)
        .ilike('body', `%${safe}%`).order('created_at', { ascending: false }).limit(40);
      setResults(((data ?? []) as Message[]).filter((m) => !isSystem(m)));
    }, 300);
    return () => clearTimeout(t);
  }, [q, visible, conversationId]);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <T display size={22}>بحث في المحادثة</T>
      <Field placeholder="اكتب كلمة من الرسالة" value={q} onChangeText={setQ} autoFocus />
      <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
        {results === null ? <T dim center style={{ paddingVertical: 20 }}>حرفان على الأقل</T> : results.length === 0 ? (
          <T dim center style={{ paddingVertical: 20 }}>لا نتائج</T>
        ) : results.map((m) => (
          <Pressable key={m.id} onPress={() => onPick(m)} style={({ pressed }) => ({ paddingVertical: 10, gap: 2, opacity: pressed ? 0.6 : 1, borderBottomWidth: 1, borderBottomColor: c.line })}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T size={13} weight="bold" color={c.accent}>{members[m.sender_id]?.full_name ?? ''}</T>
              <T dim size={11}>{new Date(m.created_at).toLocaleDateString('ar-IQ')} · {formatTime(new Date(m.created_at))}</T>
            </Row>
            <T size={14} lines={2}>{m.body}</T>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

// ---------------------------------------------------------------- معلومات الرسالة: من قرأها ومن وصلته
function InfoSheet({ message, receipts, members, myId, direct, onClose }: {
  message: Message | null; receipts: Receipt[]; members: Record<string, Member>; myId: string; direct: boolean; onClose: () => void;
}) {
  const { c } = useTheme();
  if (!message) return null;
  const { read, delivered, waiting } = messageReaders(message.created_at, myId, receipts);
  const groups = [
    { key: 'read', title: direct ? 'قُرئت' : 'قرأها', list: read, status: 'read' as const },
    { key: 'delivered', title: direct ? 'وصلت ولم تُقرأ بعد' : 'وصلت إلى', list: delivered, status: 'delivered' as const },
    { key: 'waiting', title: direct ? 'لم تصل بعد' : 'لم تصل بعد إلى', list: waiting, status: 'sent' as const },
  ].filter((g) => g.list.length);
  return (
    <Sheet visible onClose={onClose}>
      <T display size={22}>معلومات الرسالة</T>
      <View style={{ padding: 12, borderRadius: 16, backgroundColor: c.bg }}>
        <T size={14} lines={3}>{message.body ?? (message.attachment?.type === 'image' ? 'صورة' : 'مرفق')}</T>
        <T dim size={11} style={{ marginTop: 4 }}>أُرسلت {formatTime(new Date(message.created_at))}</T>
      </View>
      <ScrollView style={{ maxHeight: 380 }}>
        {groups.length === 0 ? <T dim center style={{ paddingVertical: 16 }}>لا أحد غيرك في المحادثة بعد</T> : groups.map((g) => (
          <View key={g.key} style={{ marginTop: 12, gap: 4 }}>
            <Row gap={6}>
              <Ticks status={g.status} color={c.ink3} readColor={c.accent} size={16} />
              <T weight="bold" size={14}>{g.title}{direct ? '' : ` (${arDigits(g.list.length)})`}</T>
            </Row>
            {direct ? null : g.list.map((u) => (
              <Row key={u} gap={10} style={{ paddingVertical: 6 }}>
                <Avatar name={members[u]?.full_name ?? '؟'} url={members[u]?.avatar_url} size={34} />
                <NameLine name={members[u]?.full_name ?? 'عضو'} verified={members[u]?.is_verified} size={14} />
              </Row>
            ))}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}
