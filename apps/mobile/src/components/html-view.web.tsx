import { useState } from 'react';

/** يعرض HTML بارتفاع يتكيف مع المحتوى (المتصفح) */
export function HtmlView({ html }: { html: string }) {
  const [height, setHeight] = useState(60);
  return (
    <iframe
      title="محتوى"
      srcDoc={html}
      style={{ border: 0, width: '100%', height, background: 'transparent' }}
      onLoad={(e) => {
        const doc = (e.target as HTMLIFrameElement).contentDocument;
        const measure = () => doc && setHeight(doc.documentElement.scrollHeight + 4);
        measure();
        setTimeout(measure, 400);
        setTimeout(measure, 1200);
      }}
    />
  );
}
