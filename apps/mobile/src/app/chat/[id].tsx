import { arDigits, formatTime, type Attachment, type Message, type Profile } from '@saey/shared';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icon';
import { Sheet, SheetItem } from '@/components/sheet';
import { Avatar, Field, IconButton, NameLine, Row, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { ATTACHMENT_LABELS, REACTIONS, conversationTitle, openAttachment, type ConversationRow } from '@/lib/chat';
import { compressImage, signedUrls, uploadFile } from '@/lib/files';
import { must, supabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';

type Member = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'is_verified' | 'role'>;
interface Reaction { message_id: string; user_id: string; emoji: string }
const PAGE = 40;

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const { isStaff } = useAuth();

  const [conv, setConv] = useState<ConversationRow | null>(null);
  const [members, setMembers] = useState<Record<string, Member>>({});
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
  const inputRef = useRef<TextInput>(null);

  const markRead = useCallback(() => {
    supabase.rpc('mark_read', { p_conversation: id }).then(() => {});
  }, [id]);

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

  // التحميل الأول
  useEffect(() => {
    (async () => {
      try {
        const [convs, mem, msgs] = await Promise.all([
          must(supabase.rpc('my_conversations')) as Promise<ConversationRow[]>,
          must(supabase.from('conversation_members').select('profiles(id, full_name, avatar_url, is_verified, role)').eq('conversation_id', id)),
          must(supabase.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: false }).limit(PAGE)),
        ]);
        setConv(convs.find((x) => x.id === id) ?? null);
        const map: Record<string, Member> = {};
        for (const row of mem as unknown as { profiles: Member | null }[]) if (row.profiles) map[row.profiles.id] = row.profiles;
        setMembers(map);
        const list = msgs as Message[];
        setMessages(list);
        setHasMore(list.length === PAGE);
        loadImages(list);
        loadReactions(list.map((m) => m.id));
        markRead();
      } catch (e) {
        Alert.alert('تعذّر فتح المحادثة', e instanceof Error ? e.message : '');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, loadImages, loadReactions, markRead]);

  // اللحظي
  useEffect(() => {
    const channel = supabase.channel(`conv:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, (p) => {
        const m = p.new as Message;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [m, ...prev]));
        loadImages([m]);
        markRead();
        if (!members[m.sender_id]) {
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadOlder = async () => {
    if (!hasMore || loading || !messages.length) return;
    const oldest = messages[messages.length - 1].created_at;
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', id)
      .lt('created_at', oldest).order('created_at', { ascending: false }).limit(PAGE);
    const list = (data ?? []) as Message[];
    setMessages((prev) => [...prev, ...list]);
    setHasMore(list.length === PAGE);
    loadImages(list);
    loadReactions(list.map((m) => m.id));
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
    setSending(true);
    try {
      if (editing) {
        const { error } = await supabase.from('messages').update({ body }).eq('id', editing.id);
        if (error) throw new Error(error.message);
        setEditing(null);
      } else {
        const mentionIds = mentions.filter((p) => body.includes(`@${p.full_name.split(' ').slice(0, 2).join('_')}`)).map((p) => p.id);
        const { data, error } = await supabase.from('messages').insert({
          conversation_id: id,
          sender_id: me.id,
          body: body || null,
          attachment: attachment ?? null,
          reply_to_id: replyTo?.id ?? null,
          mentions: mentionIds,
        }).select('*').single();
        if (error) throw new Error(error.message);
        setMessages((prev) => (prev.some((x) => x.id === data.id) ? prev : [data as Message, ...prev]));
        if (attachment) loadImages([data as Message]);
      }
      setText('');
      setMentions([]);
      setReplyTo(null);
    } catch (e) {
      Alert.alert('لم تُرسل الرسالة', e instanceof Error ? e.message : '');
    } finally {
      setSending(false);
    }
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

  const canPost = !conv?.only_staff_can_post || isStaff;
  const title = conv ? conversationTitle(conv) : '';
  const isGroup = conv?.type !== 'direct';
  const byId = useMemo(() => Object.fromEntries(messages.map((m) => [m.id, m])), [messages]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* الرأس */}
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Row>
          <IconButton name="back" label="رجوع" onPress={() => router.back()} size={40} />
          <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
            onPress={() => conv?.type === 'direct' && conv.peer_id && router.push(`/profile/${conv.peer_id}`)}>
            {conv?.type === 'direct'
              ? <Avatar name={conv.peer_name ?? '؟'} url={conv.peer_avatar} size={38} />
              : <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={conv?.type === 'school' ? 'home' : 'users'} size={20} color={c.accent} />
              </View>}
            <View style={{ flex: 1 }}>
              <NameLine name={title} verified={conv?.type === 'direct' && !!conv.peer_verified} size={16} />
              <T dim size={12}>{isGroup ? `${arDigits(Object.keys(members).length)} عضو` : 'محادثة خاصة'}</T>
            </View>
          </Pressable>
        </Row>
      </View>

      {loading ? <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} /> : (
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, gap: 4 }}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          renderItem={({ item, index }) => {
            const older = messages[index + 1];
            const showName = isGroup && item.sender_id !== me.id && older?.sender_id !== item.sender_id;
            const dayChanged = !older || new Date(older.created_at).toDateString() !== new Date(item.created_at).toDateString();
            return (
              <View>
                {dayChanged ? (
                  <View style={{ alignSelf: 'center', marginVertical: 10, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: c.card }}>
                    <T dim size={12}>{new Date(item.created_at).toDateString() === new Date().toDateString() ? 'اليوم' : new Date(item.created_at).toLocaleDateString('ar-IQ')}</T>
                  </View>
                ) : null}
                <Bubble
                  m={item}
                  mine={item.sender_id === me.id}
                  sender={members[item.sender_id]}
                  showName={showName}
                  reply={item.reply_to_id ? byId[item.reply_to_id] : undefined}
                  replySender={item.reply_to_id && byId[item.reply_to_id] ? members[byId[item.reply_to_id].sender_id]?.full_name : undefined}
                  imageUrl={item.attachment?.type === 'image' ? images[item.attachment.key] : undefined}
                  reactions={reactions.filter((r) => r.message_id === item.id)}
                  myId={me.id}
                  onLongPress={() => !item.deleted_at && setActionFor(item)}
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
        <Row gap={8} style={{ backgroundColor: c.card, paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 10, borderTopWidth: replyTo || editing ? 0 : 1, borderTopColor: c.line, alignItems: 'flex-end' }}>
          {!editing ? <IconButton name="paperclip" label="إرفاق" size={44} onPress={() => setAttachOpen(true)} /> : null}
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
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
            {sending ? <ActivityIndicator color="#FFFFFF" /> : <Icon name={editing ? 'check' : 'send'} size={20} color="#FFFFFF" strokeWidth={2} />}
          </Pressable>
        </Row>
      ) : (
        <View style={{ backgroundColor: c.card, padding: 16, paddingBottom: insets.bottom + 16, borderTopWidth: 1, borderTopColor: c.line }}>
          <T dim center size={13}>هذه قناة إعلانات — النشر للأدمن والمشرفين فقط</T>
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
            <SheetItem icon="reply" label="رد" onPress={() => { setReplyTo(actionFor); setActionFor(null); inputRef.current?.focus(); }} />
            {actionFor.body ? <SheetItem icon="copy" label="نسخ النص" onPress={() => { Clipboard.setStringAsync(actionFor.body ?? ''); setActionFor(null); }} /> : null}
            {actionFor.sender_id === me.id && actionFor.body ? (
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
        <SheetItem icon="book" label="من المنهج (محاضرة، ملزمة، أسئلة)" onPress={() => { setAttachOpen(false); setCurriculumOpen(true); }} />
      </Sheet>
      <CurriculumPicker visible={curriculumOpen} onClose={() => setCurriculumOpen(false)}
        onPick={(a) => { setCurriculumOpen(false); send(a); }} />
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------- الفقاعة
function Bubble({ m, mine, sender, showName, reply, replySender, imageUrl, reactions, myId, onLongPress, onReact }: {
  m: Message; mine: boolean; sender?: Member; showName: boolean; reply?: Message; replySender?: string;
  imageUrl?: string; reactions: Reaction[]; myId: string; onLongPress: () => void; onReact: (e: string) => void;
}) {
  const { c } = useTheme();
  const bg = mine ? c.bubbleMine : c.bubbleOther;
  const fg = mine ? c.bubbleMineInk : c.ink;
  const sub = mine ? 'rgba(255,255,255,0.75)' : c.ink2;
  const grouped = Object.entries(reactions.reduce<Record<string, number>>((a, r) => ({ ...a, [r.emoji]: (a[r.emoji] ?? 0) + 1 }), {}));
  const a = m.attachment;
  // الرسائل الجديدة فقط تدخل بحركة (لا نحرّك السجل القديم عند الفتح أو التمرير)
  const [fresh] = useState(() => Date.now() - new Date(m.created_at).getTime() < 5000);

  return (
    <Animated.View
      entering={fresh ? FadeInDown.springify().damping(16).stiffness(180).withInitialValues({ transform: [{ translateY: 24 }] }) : undefined}
      layout={LinearTransition.duration(200)}
      style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginTop: showName ? 8 : 0 }}>
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
            {reply ? (
              <View style={{ borderRightWidth: 3, borderRightColor: mine ? '#FFFFFF' : c.accent, paddingRight: 8, opacity: 0.85 }}>
                <T size={12} weight="bold" color={fg}>{replySender ?? ''}</T>
                <T size={13} color={fg} lines={2}>{reply.deleted_at ? 'رسالة محذوفة' : reply.body ?? 'مرفق'}</T>
              </View>
            ) : null}
            {a?.type === 'image' ? (
              imageUrl ? (
                <Image source={{ uri: imageUrl }} contentFit="cover" transition={150}
                  style={{ width: 240, height: a.width && a.height ? Math.min(320, (240 * a.height) / a.width) : 240, borderRadius: 16 }} />
              ) : <View style={{ width: 240, height: 180, borderRadius: 16, backgroundColor: c.line }} />
            ) : a ? (
              <Pressable onPress={() => openAttachment(a)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: mine ? 'rgba(255,255,255,0.15)' : c.soft, borderRadius: 14, padding: 10 }}>
                <Icon name={a.type === 'lecture' ? 'play' : a.type === 'document' ? 'file' : 'quiz'} size={20} color={mine ? '#FFFFFF' : c.accent} />
                <View style={{ flex: 1 }}>
                  <T size={11} color={sub}>{ATTACHMENT_LABELS[a.type]}</T>
                  <T weight="bold" size={14} color={fg} lines={2}>{a.title}</T>
                </View>
              </Pressable>
            ) : null}
            {m.body ? <T size={15} color={fg} selectable>{renderMentions(m.body, mine ? '#FFFFFF' : c.accent)}</T> : null}
          </>
        )}
        <T size={10} color={sub} style={{ alignSelf: 'flex-end', lineHeight: 14 }}>
          {m.edited_at && !m.deleted_at ? 'معدّلة · ' : ''}{formatTime(new Date(m.created_at))}
        </T>
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
  const [results, setResults] = useState<Attachment[]>([]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(async () => {
      const like = `%${search.trim()}%`;
      const [l, d, qs] = await Promise.all([
        supabase.from('lectures').select('id, title').ilike('title', like).limit(8),
        supabase.from('documents').select('id, title').ilike('title', like).limit(8),
        supabase.from('question_sets').select('id, title').eq('status', 'published').ilike('title', like).limit(8),
      ]);
      setResults([
        ...(l.data ?? []).map((x) => ({ type: 'lecture' as const, id: x.id, title: x.title })),
        ...(d.data ?? []).map((x) => ({ type: 'document' as const, id: x.id, title: x.title })),
        ...(qs.data ?? []).map((x) => ({ type: 'question_set' as const, id: x.id, title: x.title })),
      ]);
    }, 250);
    return () => clearTimeout(t);
  }, [search, visible]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <T display size={22}>إرفاق من المنهج</T>
      <Field placeholder="ابحث عن محاضرة أو ملزمة أو أسئلة" value={search} onChangeText={setSearch} />
      <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
        {results.length === 0 ? <T dim center style={{ paddingVertical: 20 }}>لا نتائج</T> : results.map((r) => r.type !== 'image' && (
          <Pressable key={`${r.type}${r.id}`} onPress={() => onPick(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
            <Icon name={r.type === 'lecture' ? 'play' : r.type === 'document' ? 'file' : 'quiz'} size={20} color={c.accent} />
            <View style={{ flex: 1 }}>
              <T weight="bold" lines={1}>{r.title}</T>
              <T dim size={12}>{ATTACHMENT_LABELS[r.type]}</T>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}
