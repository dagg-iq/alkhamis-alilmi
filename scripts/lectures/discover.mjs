// استكشاف قوائم تشغيل الأساتذة على يوتيوب (قراءة فقط) — يعمل في سير العمل lectures-discover.yml بمفتاح YouTube
// يطبع: القنوات المطابقة، قوائم تشغيلها (العدد والعنوان)، ونتائج البحث عن القوائم. لا يكتب شيئاً.
import fs from 'node:fs';

const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) throw new Error('YOUTUBE_API_KEY is not set');
const YT = 'https://www.googleapis.com/youtube/v3';

async function yt(path, params) {
  const res = await fetch(`${YT}/${path}?${new URLSearchParams({ ...params, key: KEY })}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function channelPlaylists(channelId) {
  const out = [];
  let page = '';
  for (let i = 0; i < 6; i++) {
    const d = await yt('playlists', { part: 'snippet,contentDetails', channelId, maxResults: '50', ...(page ? { pageToken: page } : {}) });
    for (const p of d.items ?? []) out.push({ id: p.id, title: p.snippet.title, count: p.contentDetails.itemCount, published: p.snippet.publishedAt.slice(0, 10) });
    if (!d.nextPageToken) break;
    page = d.nextPageToken;
  }
  return out;
}

const queries = JSON.parse(fs.readFileSync(new URL('./discover-queries.json', import.meta.url), 'utf8'));
const seenChannels = new Set();
for (const q of queries) {
  console.log(`\n################ ${q.label}`);
  if (q.channels) {
    for (const term of q.channels) {
      const d = await yt('search', { part: 'snippet', type: 'channel', q: term, maxResults: String(q.channelResults ?? 4), regionCode: 'IQ', relevanceLanguage: 'ar' });
      const ids = (d.items ?? []).map((x) => x.snippet.channelId);
      if (!ids.length) continue;
      const info = await yt('channels', { part: 'snippet,statistics', id: ids.join(',') });
      for (const c of info.items ?? []) {
        console.log(`CHANNEL ${c.id} | ${c.snippet.title} | ${c.snippet.customUrl ?? ''} | subs=${c.statistics.subscriberCount} videos=${c.statistics.videoCount} | q="${term}"`);
        if (seenChannels.has(c.id)) continue;
        seenChannels.add(c.id);
        if (q.listChannelPlaylists === false) continue;
        for (const p of await channelPlaylists(c.id)) console.log(`   PL ${p.id} | n=${p.count} | ${p.published} | ${p.title}`);
      }
    }
  }
  for (const term of q.playlists ?? []) {
    const d = await yt('search', { part: 'snippet', type: 'playlist', q: term, maxResults: '15', regionCode: 'IQ', relevanceLanguage: 'ar' });
    const ids = (d.items ?? []).map((x) => x.id.playlistId);
    if (!ids.length) continue;
    const info = await yt('playlists', { part: 'snippet,contentDetails', id: ids.join(',') });
    for (const p of info.items ?? []) console.log(`SEARCH-PL ${p.id} | n=${p.contentDetails.itemCount} | ${p.snippet.publishedAt.slice(0, 10)} | ${p.snippet.channelTitle} (${p.snippet.channelId}) | ${p.snippet.title} | q="${term}"`);
  }
}
