import type { MessageStatus } from '@saey/shared';
import { View } from 'react-native';
import { Icon } from './icon';

/**
 * علامة حالة رسالتي: ✓ أُرسلت · ✓✓ وصلت · ✓✓ قُرئت (أوضح وأسمك) · ساعة = يُرسل.
 * لون مميز واحد في الهوية: «قُرئت» تُميَّز بالشدة لا بلون جديد.
 */
export function Ticks({ status, color, readColor, size = 14 }: { status: MessageStatus | 'pending'; color: string; readColor?: string; size?: number }) {
  const label = { pending: 'يُرسل', sent: 'أُرسلت', delivered: 'وصلت', read: 'قُرئت' }[status];
  return (
    <View accessibilityLabel={label} style={{ opacity: status === 'read' ? 1 : 0.8 }}>
      <Icon
        name={status === 'pending' ? 'clock' : status === 'sent' ? 'check' : 'check-double'}
        size={size}
        color={status === 'read' ? readColor ?? color : color}
        strokeWidth={status === 'read' ? 2.4 : 1.8}
      />
    </View>
  );
}
