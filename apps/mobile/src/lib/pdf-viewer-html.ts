import { PDFJS_MAIN, PDFJS_WORKER } from './pdfjs-source';

/**
 * صفحة HTML تعرض PDF بـ pdf.js (مضمّنة في التطبيق فتعمل بلا إنترنت، والعامل يعمل في الخيط الرئيسي).
 * الدوال التي يستدعيها التطبيق عبر injectJavaScript:
 *   openPdf({data|url})            ← عرض كل الصفحات
 *   exportImages(scale, quality)   ← يرسل كل صفحة صورة JPEG: img:<رقم>:<العدد>:<العرض>x<الارتفاع>:<dataURL> ثم imgdone
 *   thumb({data|url}, width)       ← يرسم الصفحة الأولى فقط: thumb:<dataURL>
 * ويرسل للتطبيق: pages:<n> | ready | error:<msg>
 */
export function pdfViewerHtml(dark: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=5,user-scalable=yes">
<script>${PDFJS_WORKER}</script>
<script>window.pdfjsWorker=window['pdfjs-dist/build/pdf.worker'];</script>
<script>${PDFJS_MAIN}</script>
<script>pdfjsLib.GlobalWorkerOptions.workerSrc='about:blank';</script>
<style>body{margin:0;background:${dark ? '#0E0E0F' : '#E9E9E4'};padding:8px 0 24px}
.pg{margin:0 auto 10px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15);position:relative}
canvas{display:block;width:100%;height:100%}</style></head><body><div id="pages"></div>
<script>
function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(m);}
function bytes(s){var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;}
function load(src){return pdfjsLib.getDocument(src.data?{data:bytes(src.data)}:{url:src.url}).promise;}
var DOC=null;
window.openPdf=function(src){
  if(typeof pdfjsLib==='undefined'){post('error:lib');return;}
  load(src).then(function(pdf){
    DOC=pdf;
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
function pageJpeg(pdf,n,width,quality){
  return pdf.getPage(n).then(function(p){
    var v0=p.getViewport({scale:1}),v=p.getViewport({scale:width/v0.width});
    var cv=document.createElement('canvas');cv.width=Math.round(v.width);cv.height=Math.round(v.height);
    var ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);
    return p.render({canvasContext:ctx,viewport:v}).promise.then(function(){return {u:cv.toDataURL('image/jpeg',quality),w:cv.width,h:cv.height};});
  });
}
window.exportImages=function(width,quality){
  if(!DOC){post('error:nodoc');return;}
  var total=DOC.numPages,chain=Promise.resolve();
  for(let n=1;n<=total;n++){chain=chain.then(function(){return pageJpeg(DOC,n,width,quality).then(function(u){post('img:'+n+':'+total+':'+u.w+'x'+u.h+':'+u.u);});});}
  chain.then(function(){post('imgdone');}).catch(function(e){post('error:'+e.message);});
};
window.thumb=function(src,width){
  if(typeof pdfjsLib==='undefined'){post('error:lib');return;}
  load(src).then(function(pdf){return pageJpeg(pdf,1,width,0.82).then(function(u){post('pages:'+pdf.numPages);post('thumb:'+u.u);});})
    .catch(function(e){post('error:'+e.message);});
};
</script></body></html>`;
}
