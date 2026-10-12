import { isSafeUrl } from '@saey/shared';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';

/** يعرض HTML بارتفاع يتكيف مع المحتوى (الهاتف)، والروابط تفتح خارج التطبيق */
export function HtmlView({ html }: { html: string }) {
  const [height, setHeight] = useState(60);
  return (
    <View style={{ height }}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ backgroundColor: 'transparent' }}
        scrollEnabled={false}
        onMessage={(e) => {
          const d = e.nativeEvent.data;
          if (d.startsWith('link:')) {
            // روابط الويب فقط: المحتوى قد يكتبه طالب آخر (لا intent: ولا روابط التطبيق الداخلية)
            const url = d.slice(5);
            if (isSafeUrl(url)) Linking.openURL(url).catch(() => {});
            return;
          }
          const h = Number(d);
          if (h > 0) setHeight(Math.ceil(h) + 4);
        }}
        setSupportMultipleWindows={false}
        javaScriptEnabled
      />
    </View>
  );
}
