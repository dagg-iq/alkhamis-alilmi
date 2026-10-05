// عنوان الفيديو واسم القناة من رابط يوتيوب (للوحة التحكم)
import { handler, HttpError, json } from '../_shared/cors.ts';
import { getCaller } from '../_shared/supabase.ts';

Deno.serve(handler(async (req) => {
  await getCaller(req, { staff: true });
  const { url } = await req.json();
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new HttpError(404, 'لم أجد الفيديو. تأكد من الرابط وأنه غير خاص.');
  const data = await res.json();
  return json({ title: data.title as string, author: data.author_name as string, thumbnail: data.thumbnail_url as string });
}));
