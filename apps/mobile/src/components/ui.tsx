import { arDigits, initials, radius } from '@saey/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import Animated, { Easing, ZoomIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme } from '@/lib/theme';
import { Icon, type IconName, VerifiedBadge } from './icon';
import { KeyboardView, PressScale, Skeleton, Stagger, tap } from './motion';

// ---------------------------------------------------------------- النص
type Weight = 'regular' | 'medium' | 'bold' | 'black';

export function T({
  children, size = 15, weight = 'regular', display, serif, color, dim, style, lines, center, selectable,
}: {
  children: ReactNode;
  size?: number;
  weight?: Weight;
  /** خط العناوين (Serif Display) */
  display?: boolean;
  /** خط القراءة الطويلة (Serif Text) */
  serif?: boolean;
  color?: string;
  dim?: boolean;
  style?: StyleProp<TextStyle>;
  lines?: number;
  center?: boolean;
  selectable?: boolean;
}) {
  const { c } = useTheme();
  const family = display
    ? weight === 'bold' ? fonts.displayBold : fonts.display
    : serif
      ? weight === 'bold' || weight === 'black' ? fonts.serifBold : fonts.serif
      : fonts[weight];
  return (
    <Text
      numberOfLines={lines}
      selectable={selectable}
      style={[
        {
          fontFamily: family,
          fontSize: size,
          // خط العناوين له نقاط وذيول عميقة (ي، ج): مسافة سطر كافية حتى لا تُقص في أندرويد
          lineHeight: Math.round(size * (display ? 1.5 : serif ? 1.9 : 1.6)),
          color: color ?? (dim ? c.ink2 : c.ink),
          writingDirection: 'rtl',
          ...(center ? { textAlign: 'center' as const } : null),
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------- الشاشة
export function Screen({
  children, scroll = true, padded = true, onRefresh, refreshing, footer, style, edges = ['top'],
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: ('top' | 'bottom')[];
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const pad = {
    paddingTop: edges.includes('top') ? insets.top + 8 : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom + 16 : 24,
  };
  const inner = padded ? { paddingHorizontal: 20 } : null;
  if (!scroll) {
    return (
      <KeyboardView style={[{ flex: 1, backgroundColor: c.bg }, pad, style]} bottomInset={insets.bottom}>
        <View style={[{ flex: 1 }, inner]}>{children}</View>
        {footer}
      </KeyboardView>
    );
  }
  return (
    <KeyboardView style={{ backgroundColor: c.bg }} bottomInset={insets.bottom}>
      <ScrollView
        contentContainerStyle={[pad, inner, { gap: 16 }, style]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshCtl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        <Stagger>{children}</Stagger>
      </ScrollView>
      {footer}
      {/* شريط خفيف تحت ساعة الهاتف حتى لا يتداخل المحتوى مع شريط الحالة عند التمرير */}
      {edges.includes('top') ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: c.bg, opacity: 0.94 }} /> : null}
    </KeyboardView>
  );
}

function RefreshCtl(props: { refreshing: boolean; onRefresh: () => void }) {
  const { c } = useTheme();
  return <RefreshControl {...props} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.card} />;
}
export { RefreshCtl };

// ---------------------------------------------------------------- رأس الصفحة
export function Header({ title, subtitle, right, back = true, big }: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  back?: boolean;
  big?: boolean;
}) {
  return (
    <View style={{ gap: 12 }}>
      {(back || right) && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 }}>
          {back ? (
            <IconButton name="back" label="رجوع" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          ) : <View />}
          <View style={{ flexDirection: 'row', gap: 8 }}>{right}</View>
        </View>
      )}
      {title ? (
        <View style={{ gap: 2 }}>
          <T display size={big ? 42 : 30}>{title}</T>
          {subtitle ? <T dim size={14}>{subtitle}</T> : null}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- الأزرار
export function IconButton({ name, label, onPress, color, filled, size = 44, badge }: {
  name: IconName; label: string; onPress?: () => void; color?: string; filled?: boolean; size?: number; badge?: number;
}) {
  const { c } = useTheme();
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      scaleTo={0.88}
      style={{
        width: size, height: size, borderRadius: size / 2,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: filled ? c.accent : c.card,
        borderWidth: filled ? 0 : 1, borderColor: c.line,
      }}>
      <Icon name={name} size={Math.round(size * 0.48)} color={filled ? '#FFFFFF' : color ?? c.ink} />
      {badge ? (
        <View style={{
          position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
          backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.bg,
        }}>
          <T size={10} weight="bold" color="#FFFFFF" style={{ lineHeight: 13 }}>{badge > 99 ? '+٩٩' : arDigits(badge)}</T>
        </View>
      ) : null}
    </PressScale>
  );
}

export function Button({
  title, onPress, variant = 'primary', icon, loading, disabled, style, small,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const { c, dark } = useTheme();
  const bg = {
    primary: c.accent, secondary: c.card, ghost: 'transparent', danger: dark ? '#3A1715' : '#FBE6E4', ink: c.ink,
  }[variant];
  const fg = {
    primary: dark ? '#0E0E0F' : '#FFFFFF', secondary: c.ink, ghost: c.accent, danger: dark ? '#F59A93' : '#A82620', ink: c.bg,
  }[variant];
  return (
    <PressScale
      accessibilityRole="button"
      onPress={onPress}
      haptic
      disabled={disabled || loading}
      style={[{
        height: small ? 40 : 52,
        paddingHorizontal: small ? 14 : 20,
        borderRadius: radius.pill,
        backgroundColor: bg,
        borderWidth: variant === 'secondary' ? 1 : 0,
        borderColor: c.line,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: disabled ? 0.45 : 1,
      }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Icon name={icon} size={small ? 18 : 20} color={fg} strokeWidth={2} /> : null}
          <T weight="bold" size={small ? 14 : 16} color={fg}>{title}</T>
        </>
      )}
    </PressScale>
  );
}

// ---------------------------------------------------------------- البطاقات والقوائم
export function Card({ children, style, onPress, tone = 'card' }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'card' | 'hero' | 'soft';
}) {
  const { c } = useTheme();
  const base: ViewStyle = {
    backgroundColor: tone === 'hero' ? c.heroBg : tone === 'soft' ? c.soft : c.card,
    borderRadius: tone === 'hero' ? radius.xl : radius.lg,
    borderWidth: tone === 'card' ? 1 : 0,
    borderColor: c.line,
    padding: 16,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <PressScale onPress={onPress} scaleTo={0.975} style={[base, style]}>
      {children}
    </PressScale>
  );
}

export function Row({ children, style, gap = 12 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function ListItem({ title, subtitle, icon, onPress, right, danger }: {
  title: string; subtitle?: string; icon?: IconName; onPress?: () => void; right?: ReactNode; danger?: boolean;
}) {
  const { c } = useTheme();
  const color = danger ? '#C8312B' : c.ink;
  return (
    <PressScale onPress={onPress} disabled={!onPress} scaleTo={0.98} style={{
      flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14,
    }}>
      {icon ? (
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={danger ? color : c.accent} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T weight="bold" size={16} color={color}>{title}</T>
        {subtitle ? <T dim size={13}>{subtitle}</T> : null}
      </View>
      {right ?? (onPress ? <Icon name="forward" size={18} color={c.ink3} /> : null)}
    </PressScale>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.line }} />;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { c } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
      <T display size={22}>{title}</T>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <T weight="bold" color={c.accent}>{action}</T>
        </Pressable>
      ) : null}
    </Row>
  );
}

// ---------------------------------------------------------------- الشرائح والتبويبات
export function Chip({ label, active, onPress, color, bg, small }: {
  label: string; active?: boolean; onPress?: () => void; color?: string; bg?: string; small?: boolean;
}) {
  const { c } = useTheme();
  return (
    <PressScale
      onPress={onPress ? () => { tap('select'); onPress(); } : undefined}
      disabled={!onPress}
      scaleTo={0.92}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: !!active } : undefined}
      style={{
        height: small ? 28 : 38,
        paddingHorizontal: small ? 10 : 14,
        borderRadius: radius.pill,
        backgroundColor: bg ?? (active ? c.ink : c.card),
        borderWidth: bg || active ? 0 : 1,
        borderColor: c.line,
        alignItems: 'center', justifyContent: 'center',
      }}>
      <T size={small ? 12 : 14} weight={active || small ? 'bold' : 'medium'} color={color ?? (active ? c.bg : c.ink)}>{label}</T>
    </PressScale>
  );
}

export function ChipRow<K extends string>({ options, value, onChange }: {
  options: { key: K; label: string }[]; value: K; onChange: (k: K) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => (
        <Chip key={o.key} label={o.label} active={o.key === value} onPress={() => onChange(o.key)} />
      ))}
    </ScrollView>
  );
}

export function Segmented<K extends string>({ options, value, onChange }: {
  options: { key: K; label: string }[]; value: K; onChange: (k: K) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.card, borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: c.line }}>
      {options.map((o) => (
        <SegmentItem key={o.key} label={o.label} on={o.key === value} onPress={() => { tap('select'); onChange(o.key); }} />
      ))}
    </View>
  );
}

function SegmentItem({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(on ? 1 : 0, { duration: 260, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  const pill = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.85 + v.value * 0.15 }] }));
  return (
    <PressScale onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} scaleTo={0.95}
      style={{ flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: radius.pill, backgroundColor: c.ink }, pill]} />
      <T size={14} weight={on ? 'bold' : 'medium'} color={on ? c.bg : c.ink2}>{label}</T>
    </PressScale>
  );
}

// ---------------------------------------------------------------- الإدخال
export function Field({ label, hint, ...props }: TextInputProps & { label?: string; hint?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <T weight="bold" size={14}>{label}</T> : null}
      <TextInput
        placeholderTextColor={c.ink3}
        {...props}
        style={[{
          minHeight: 52,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: c.line,
          backgroundColor: c.card,
          paddingHorizontal: 16,
          paddingVertical: props.multiline ? 14 : 0,
          fontFamily: fonts.regular,
          fontSize: 16,
          color: c.ink,
          writingDirection: 'rtl',
          textAlignVertical: props.multiline ? 'top' : 'center',
        }, props.style]}
      />
      {hint ? <T dim size={12}>{hint}</T> : null}
    </View>
  );
}

// ---------------------------------------------------------------- الصورة الشخصية
export function Avatar({ name, url, size = 44, verified }: { name: string; url?: string | null; size?: number; verified?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.soft }} contentFit="cover" />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <T weight="bold" size={size * 0.42} color="#FFFFFF" style={{ lineHeight: size * 0.6 }}>{initials(name)}</T>
        </View>
      )}
      {verified ? (
        <View style={{ position: 'absolute', bottom: size > 80 ? size * 0.04 : -2, left: size > 80 ? size * 0.04 : -2, backgroundColor: c.bg, borderRadius: 99, padding: 2 }}>
          <VerifiedBadge size={Math.min(26, Math.max(14, size * 0.3))} color={c.accent} />
        </View>
      ) : null}
    </View>
  );
}

export function NameLine({ name, verified, size = 15, weight = 'bold' }: { name: string; verified?: boolean; size?: number; weight?: Weight }) {
  const { c } = useTheme();
  return (
    <Row gap={4}>
      <T size={size} weight={weight} lines={1} style={{ flexShrink: 1 }}>{name}</T>
      {verified ? <VerifiedBadge size={size} color={c.accent} /> : null}
    </Row>
  );
}

// ---------------------------------------------------------------- مؤشرات
export function ProgressBar({ value, color, track, height = 6, marker }: {
  value: number; color?: string; track?: string; height?: number; marker?: number;
}) {
  const { c } = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(pct, { duration: 500, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track ?? c.line, overflow: 'visible' }}>
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, right: 0, borderRadius: height / 2, backgroundColor: color ?? c.accent }, fill]} />
      {marker !== undefined ? (
        <View style={{ position: 'absolute', top: -4, bottom: -4, right: `${marker * 100}%`, width: 2, backgroundColor: c.heroInk }} />
      ) : null}
    </View>
  );
}

export function Loading({ spinner }: { spinner?: boolean } = {}) {
  const { c } = useTheme();
  if (!spinner) return <Skeleton />;
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center' }}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}

export function Empty({ icon = 'book', title, body, action, onAction }: {
  icon?: IconName; title: string; body?: string; action?: string; onAction?: () => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 10 }}>
      <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={28} color={c.accent} />
      </View>
      <T weight="bold" size={17} center>{title}</T>
      {body ? <T dim center size={14}>{body}</T> : null}
      {action ? <Button title={action} onPress={onAction} small style={{ marginTop: 6 }} /> : null}
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <Empty icon="refresh" title="تعذّر التحميل" body={message} action={onRetry ? 'إعادة المحاولة' : undefined} onAction={onRetry} />;
}

/** زر عائم أسفل الشاشة */
export function Fab({ title, icon = 'plus', onPress }: { title: string; icon?: IconName; onPress: () => void } & Partial<PressableProps>) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View entering={ZoomIn.springify().damping(14).delay(250)} style={{ position: 'absolute', left: 20, bottom: insets.bottom + 20 }}>
      <Button title={title} icon={icon} onPress={onPress} />
    </Animated.View>
  );
}
