// Reads the YouTube playlists listed in content/site.json and returns their videos,
// so new videos added on YouTube appear on the website automatically.
// Served at /api/playlists. Netlify caches the answer for 15 minutes.

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=YES+1; SOCS=CAI',
};

function playlistId(input) {
  if (!input) return '';
  const m = String(input).match(/[?&]list=([\w-]+)/);
  if (m) return m[1];
  return /^[\w-]{12,}$/.test(input) ? input : '';
}

// Collect videos in playlist order from YouTube's page data (handles old and new page formats)
function collectVideos(data) {
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;

    if (o.playlistVideoRenderer) {
      const r = o.playlistVideoRenderer;
      if (r.videoId && r.isPlayable !== false) {
        out.push({ id: r.videoId, title: (r.title?.runs || []).map((x) => x.text).join('') || r.title?.simpleText || '' });
      }
      return;
    }
    if (o.lockupViewModel?.contentId) {
      const l = o.lockupViewModel;
      if (String(l.contentType || 'VIDEO').includes('VIDEO')) {
        out.push({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content || '' });
      }
      return;
    }
    if (o.shortsLockupViewModel) {
      const s = o.shortsLockupViewModel;
      const m = JSON.stringify(s).match(/"videoId":\s*"([\w-]{11})"/);
      if (m) out.push({ id: m[1], title: s.overlayMetadata?.primaryText?.content || '' });
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(data);
  const seen = new Set();
  return out.filter((v) => /^[\w-]{11}$/.test(v.id) && !seen.has(v.id) && seen.add(v.id));
}

async function readPlaylist(id) {
  const res = await fetch(`https://www.youtube.com/playlist?list=${id}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`YouTube answered ${res.status}`);
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error('Playlist data not found');
  const videos = collectVideos(JSON.parse(m[1]));
  if (!videos.length) throw new Error('No videos found');
  return videos;
}

export default async (req) => {
  const result = {};
  try {
    // Only read the playlists the site itself lists, so this can't be used for other playlists
    const site = await fetch(new URL('/content/site.json', req.url)).then((r) => r.json());
    await Promise.all((site.sections || []).map(async (sec) => {
      const id = playlistId(sec.playlist);
      if (!id) return;
      try { result[sec.id] = await readPlaylist(id); } catch { result[sec.id] = null; }
    }));
  } catch {
    // Leave result empty — the website then keeps showing the videos saved in site.json
  }

  return new Response(JSON.stringify(result), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=900, stale-while-revalidate=86400',
    },
  });
};

export const config = { path: '/api/playlists' };
