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
    if (o.reelItemRenderer?.videoId) {
      const r = o.reelItemRenderer;
      out.push({ id: r.videoId, title: r.headline?.simpleText || '' });
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

async function readPlaylistOnce(id) {
  const res = await fetch(`https://www.youtube.com/playlist?list=${id}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`YouTube answered ${res.status}`);
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error('Playlist data not found');
  const videos = collectVideos(JSON.parse(m[1]));
  if (!videos.length) throw new Error('No videos found');
  return videos;
}

// YouTube sometimes serves a different page version; try up to 3 times
async function readPlaylist(id) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await readPlaylistOnce(id); } catch (e) { lastError = e; }
  }
  throw lastError;
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

  // If any playlist failed, only remember this answer for a minute so it's retried soon
  const complete = Object.keys(result).length > 0 && Object.values(result).every(Boolean);
  return new Response(JSON.stringify(result), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': complete ? 'public, max-age=300' : 'no-cache',
      'Netlify-CDN-Cache-Control': complete
        ? 'public, durable, s-maxage=900, stale-while-revalidate=86400'
        : 'public, s-maxage=60',
    },
  });
};

export const config = { path: '/api/playlists' };
