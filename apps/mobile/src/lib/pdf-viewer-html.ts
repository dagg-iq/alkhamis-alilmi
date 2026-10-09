import { PDFJS_MAIN, PDFJS_WORKER } from './pdfjs-source';

/**
 * صفحة HTML تعرض PDF بـ pdf.js (مضمّنة في التطبيق فتعمل بلا إنترنت، والعامل يعمل في الخيط الرئيسي).
 * الدوال التي يستدعيها التطبيق عبر injectJavaScript:
 *   openPdf({data|url}, {from,to,goto}) ← عرض الصفحات (نطاق اختياري) والتمرير إلى صفحة
 *   scrollToPage(n)                ← الانتقال إلى صفحة ضمن النطاق
 *   exportImages(scale, quality)   ← يرسل كل صفحة صورة JPEG: img:<رقم>:<العدد>:<العرض>x<الارتفاع>:<dataURL> ثم imgdone
 *   thumb({data|url}, width)       ← يرسم الصفحة الأولى فقط: thumb:<dataURL>
 * ويرسل للتطبيق: pages:<n> | ready | page:<n> (الصفحة الظاهرة) | error:<msg>
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
canvas{display:block;width:100%;height:100%}
.tag{position:absolute;top:6px;left:6px;z-index:2;min-width:26px;padding:1px 7px;border-radius:12px;background:rgba(0,0,0,.55);color:#fff;font:600 11px sans-serif;text-align:center}</style></head><body><div id="pages"></div>
<script>
function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(m);}
function bytes(s){var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;}
function load(src){return pdfjsLib.getDocument(src.data?{data:bytes(src.data)}:{url:src.url}).promise;}
var DOC=null;
window.openPdf=function(src,opts){
  opts=opts||{};
  if(typeof pdfjsLib==='undefined'){post('error:lib');return;}
  load(src).then(function(pdf){
    DOC=pdf;
    post('pages:'+pdf.numPages);
    var from=Math.max(1,Math.min(pdf.numPages,opts.from||1)),to=Math.max(from,Math.min(pdf.numPages,opts.to||pdf.numPages));
    var W=Math.min(window.innerWidth-16,900),box=document.getElementById('pages');
    box.innerHTML='';
    // ترسم الصفحات القريبة فقط، وتحرّر الصفحات البعيدة (كتاب ٣٠٠ صفحة كان سيملأ ذاكرة الهاتف)
    var io=new IntersectionObserver(function(es){es.forEach(function(e){var el=e.target;
      if(e.isIntersecting&&!el.dataset.done){el.dataset.done=1;draw(pdf,+el.dataset.n,el);}
      else if(!e.isIntersecting&&el.dataset.done){el.dataset.done='';el.dataset.gen=(+el.dataset.gen||0)+1;var cv=el.querySelector('canvas');if(cv){cv.width=0;cv.height=0;cv.remove();}}
    });},{rootMargin:'1600px 0px'});
    // الصفحة الظاهرة الآن (للعدّاد في التطبيق): الأقرب لمنتصف الشاشة
    var cur=0,pio=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var n=+e.target.dataset.n;if(n!==cur){cur=n;post('page:'+n);}}});},{rootMargin:'-45% 0px -45% 0px'});
    pdf.getPage(from).then(function(p1){
      var r=p1.getViewport({scale:1});
      for(var n=from;n<=to;n++){var d=document.createElement('div');d.className='pg';d.dataset.n=n;d.style.width=W+'px';d.style.height=(W*r.height/r.width)+'px';
        var tag=document.createElement('span');tag.className='tag';tag.textContent=n;d.appendChild(tag);box.appendChild(d);io.observe(d);pio.observe(d);}
      post('ready');
      var g=opts.goto&&opts.goto>=from&&opts.goto<=to?opts.goto:from;
      requestAnimationFrame(function(){window.scrollToPage(g,true);});
    });
  }).catch(function(e){post('error:'+e.message);});
};
window.scrollToPage=function(n,instant){var el=document.querySelector('.pg[data-n="'+n+'"]');if(el){el.scrollIntoView({block:'start',behavior:instant?'auto':'smooth'});}};
// دقة الرسم = كثافة شاشة الهاتف × التكبير الحالي بالإصبعين (حتى يبقى النص حاداً)، بحد أقصى حتى لا تمتلئ الذاكرة
function quality(){var z=(window.visualViewport&&window.visualViewport.scale)||1;return Math.min((window.devicePixelRatio||1)*z,5);}
function draw(pdf,n,el){var gen=el.dataset.gen;pdf.getPage(n).then(function(p){
  if(el.dataset.gen!==gen||!el.dataset.done)return; // ابتعدت الصفحة قبل أن تُرسم
  var v0=p.getViewport({scale:1}),W=parseFloat(el.style.width),q=quality(),px=Math.min(W*q,3600),v=p.getViewport({scale:px/v0.width});
  var cv=document.createElement('canvas');cv.width=Math.floor(v.width);cv.height=Math.floor(v.height);el.style.height=(W*v0.height/v0.width)+'px';
  var task=p.render({canvasContext:cv.getContext('2d'),viewport:v});
  // الرسم الجديد يحل محل القديم بعد اكتماله (بلا وميض عند إعادة الرسم بعد التكبير)
  task.promise.then(function(){
    if(el.dataset.gen!==gen||!el.dataset.done)return;
    var old=el.querySelector('canvas');if(old){old.width=0;old.height=0;old.remove();}
    el.appendChild(cv);el.dataset.q=String(q);
  }).catch(function(){});
});}
// بعد التكبير بالإصبعين: نعيد رسم الصفحات الظاهرة بدقة أعلى
var zt=0;
if(window.visualViewport)window.visualViewport.addEventListener('resize',function(){clearTimeout(zt);zt=setTimeout(function(){
  if(!DOC)return;var q=quality();
  document.querySelectorAll('.pg').forEach(function(el){
    if(!el.dataset.done)return;var r=el.getBoundingClientRect();
    var near=r.bottom>-window.innerHeight&&r.top<window.innerHeight*2;
    if(near&&(+el.dataset.q||0)<q*0.85){el.dataset.gen=(+el.dataset.gen||0)+1;draw(DOC,+el.dataset.n,el);}
  });
},350);});
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
