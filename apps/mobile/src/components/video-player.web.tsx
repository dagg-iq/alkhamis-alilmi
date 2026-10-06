/** مشغّل يوتيوب (المتصفح) */
export function VideoPlayer({ videoId, width, height, start, seek }: {
  videoId: string; width: number; height: number; onEnded?: () => void; start?: number; seek?: { sec: number; n: number } | null;
}) {
  const from = Math.floor(seek?.sec ?? start ?? 0);
  return (
    <iframe
      key={seek?.n ?? 0}
      title="المحاضرة"
      width={width}
      height={height}
      src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1${from ? `&start=${from}&autoplay=1` : ''}`}
      style={{ border: 0, display: 'block' }}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}
