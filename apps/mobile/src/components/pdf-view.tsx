import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { arDigits } from '@saey/shared';
import { useTheme } from '@/lib/theme';
import { T } from './ui';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

/**
 * عارض PDF داخل التطبيق (pdf.js داخل WebView): الصفحات تُرسم عند الوصول إليها،
 * والتكبير بإصبعين. يقبل ملفاً محلياً (base64) أو رابطاً.
 */
export function PdfView({ base64, url }: { base64?: string; url?: string }) {
  const { c, dark } = useTheme();
  const ref = useRef<WebView>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = useState(0);

  const html = useMemo(() => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=5,user-scalable=yes">
<script src="${PDFJS}/pdf.min.js"></script>
<style>body{margin:0;background:${dark ? '#0E0E0F' : '#E9E9E4'};padding:8px 0 24px}
.pg{margin:0 auto 10px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15);position:relative}
canvas{display:block;width:100%;height:100%}</style></head><body><div id="pages"></div>
<script>
function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(m);}
function bytes(s){var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;}
window.openPdf=function(src){
  if(typeof pdfjsLib==='undefined'){post('error:lib');return;}
  pdfjsLib.GlobalWorkerOptions.workerSrc='${PDFJS}/pdf.worker.min.js';
  pdfjsLib.getDocument(src.data?{data:bytes(src.data)}:{url:src.url}).promise.then(function(pdf){
    post('pages:'+pdf.numPages);
    var W=Math.min(window.innerWidth-16,900),box=document.getElementById('pages');
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting&&!e.target.dataset.done){e.target.dataset.done=1;draw(pdf,+e.target.dataset.n,e.target);}});},{rootMargin:'800px 0px'});
    pdf.getPage(1).then(function(p1){
      var r=p1.getViewport({scale:1});
      for(var n=1;n<=pdf.numPages;n++){var d=document.createElement('div');d.className='pg';d.dataset.n=n;d.style.width=W+'px';d.style.height=(W*r.height/r.width)+'px';box.appendChild(d);io.observe(d);}
      post('ready');
    });
  }).catch(function(e){post('error:'+e.message);});
};
function draw(pdf,n,el){pdf.getPage(n).then(function(p){
  var v0=p.getViewport({scale:1}),dpr=Math.min(window.devicePixelRatio||1,2.5),W=parseFloat(el.style.width),v=p.getViewport({scale:W/v0.width*dpr});
  var cv=document.createElement('canvas');cv.width=v.width;cv.height=v.height;el.style.height=(W*v0.height/v0.width)+'px';el.appendChild(cv);
  p.render({canvasContext:cv.getContext('2d'),viewport:v});
});}
</script></body></html>`, [dark]);

  const start = () => {
    const src = base64 ? { data: base64 } : { url };
    ref.current?.injectJavaScript(`window.openPdf(${JSON.stringify(src)});true;`);
  };

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://saeyiq.web.app/' }}
        onLoadEnd={start}
        onMessage={(e) => {
          const d = e.nativeEvent.data;
          if (d === 'ready') setState('ready');
          else if (d.startsWith('pages:')) setPages(Number(d.slice(6)));
          else if (d.startsWith('error')) setState('error');
        }}
        javaScriptEnabled
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        style={{ backgroundColor: 'transparent' }}
      />
      {state !== 'ready' ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: c.bg }}>
          {state === 'loading' ? <ActivityIndicator color={c.accent} /> : null}
          <T dim center>{state === 'loading' ? 'يجهّز الملف…' : 'تعذّر عرض الملف هنا (تحقق من الإنترنت). جرّب «مشاركة» لفتحه بتطبيق آخر.'}</T>
        </View>
      ) : null}
      {pages > 0 && state === 'ready' ? (
        <View style={{ position: 'absolute', bottom: 12, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)' }} pointerEvents="none">
          <T size={12} color="#FFFFFF">{arDigits(pages)} صفحة</T>
        </View>
      ) : null}
    </View>
  );
}
