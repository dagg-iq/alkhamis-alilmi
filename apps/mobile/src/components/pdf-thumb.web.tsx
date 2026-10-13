import { View } from 'react-native';
import { Icon } from './icon';

/** المتصفح: أيقونة بدل المعاينة */
export function PdfThumb({ width = 360 }: { base64?: string; url?: string; fileUri?: string; width?: number; onPages?: (n: number) => void }) {
  return <View style={{ width, aspectRatio: 0.707, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}><Icon name="file" size={44} color="#999" /></View>;
}
