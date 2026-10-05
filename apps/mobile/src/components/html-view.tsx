import { useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

/** يعرض HTML بارتفاع يتكيف مع المحتوى (الهاتف) */
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
          const h = Number(e.nativeEvent.data);
          if (h > 0) setHeight(h + 4);
        }}
        setSupportMultipleWindows={false}
        javaScriptEnabled
      />
    </View>
  );
}
