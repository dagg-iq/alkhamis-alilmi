import YoutubePlayer from 'react-native-youtube-iframe';

/** مشغّل يوتيوب (الهاتف) */
export function VideoPlayer({ videoId, width, height, onEnded }: { videoId: string; width: number; height: number; onEnded?: () => void }) {
  return (
    <YoutubePlayer
      height={height}
      width={width}
      videoId={videoId}
      onChangeState={(state: string) => {
        if (state === 'ended') onEnded?.();
      }}
      initialPlayerParams={{ rel: false, modestbranding: true }}
    />
  );
}
