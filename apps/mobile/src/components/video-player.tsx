import { useEffect, useRef } from 'react';
import YoutubePlayer, { type YoutubeIframeRef } from 'react-native-youtube-iframe';

/** مشغّل يوتيوب (الهاتف). seek: الانتقال لثانية معيّنة (n يتغير مع كل ضغطة) */
export function VideoPlayer({ videoId, width, height, onEnded, start, seek }: {
  videoId: string; width: number; height: number; onEnded?: () => void; start?: number; seek?: { sec: number; n: number } | null;
}) {
  const ref = useRef<YoutubeIframeRef>(null);
  useEffect(() => {
    if (seek) ref.current?.seekTo(seek.sec, true);
  }, [seek]);
  return (
    <YoutubePlayer
      ref={ref}
      height={height}
      width={width}
      videoId={videoId}
      onChangeState={(state: string) => {
        if (state === 'ended') onEnded?.();
      }}
      initialPlayerParams={{ rel: false, modestbranding: true, start: start ? Math.floor(start) : undefined }}
    />
  );
}
