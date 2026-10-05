/** مشغّل يوتيوب (المتصفح) */
export function VideoPlayer({ videoId, width, height }: { videoId: string; width: number; height: number; onEnded?: () => void }) {
  return (
    <iframe
      title="المحاضرة"
      width={width}
      height={height}
      src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`}
      style={{ border: 0, display: 'block' }}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}
