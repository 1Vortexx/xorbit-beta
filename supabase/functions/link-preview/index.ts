// Link previews for Jitter: fetches a page server-side (browsers can't read other sites'
// HTML) and returns its title, description, image and site name from Open Graph /
// Twitter / <title> tags.
// Request:  POST { url }   Response: { url, title, description, image, siteName, favicon }
// Only public http(s) addresses are fetched; private, local and link-local hosts are refused,
// and every redirect hop is checked again.

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MAX_BYTES = 512 * 1024;   // the <head> is near the top; never read whole pages
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;

function json(body: unknown, status = 200, cache = true) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...CORS,
            'Content-Type': 'application/json',
            ...(cache ? { 'Cache-Control': 'public, max-age=86400' } : {}),
        },
    });
}

// Refuse anything that isn't a public internet address
export function publicUrl(raw: string): URL | null {
    let u: URL;
    try { u = new URL(raw); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return null;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host.includes('.') && !host.includes(':')) return null;              // "localhost", intranet names
    if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) return null;
    const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        if (a === 0 || a === 10 || a === 127 || a >= 224) return null;
        if (a === 169 && b === 254) return null;                               // link-local / cloud metadata
        if (a === 172 && b >= 16 && b <= 31) return null;
        if (a === 192 && b === 168) return null;
        if (a === 100 && b >= 64 && b <= 127) return null;                     // carrier-grade NAT
    } else if (/^\d+$/.test(host) || /^0x/i.test(host)) {
        return null;                                                           // 2130706433 style IPs
    }
    if (host.includes(':')) {                                                  // IPv6 literal
        if (host === '::1' || host === '::' || /^(fe80|fc|fd)/.test(host) || host.startsWith('::ffff:')) return null;
    }
    return u;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s: string) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
        if (e[0] === '#') {
            const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    }).replace(/\s+/g, ' ').trim();
}
function attrs(tag: string) {
    const out: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
        out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
    }
    return out;
}

export function parseHtml(html: string, base: URL) {
    const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length);
    const meta: Record<string, string> = {};
    for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
        const a = attrs(m[0]);
        const key = (a.property || a.name || a.itemprop || '').toLowerCase();
        if (key && a.content && !(key in meta)) meta[key] = decode(a.content);
    }
    let favicon = '';
    for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
        const a = attrs(m[0]);
        const rel = (a.rel || '').toLowerCase();
        if (a.href && /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel) && (!favicon || rel.includes('apple'))) favicon = a.href;
    }
    const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const abs = (v: string) => { if (!v) return ''; try { const u = new URL(decode(v), base); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
    const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

    return {
        title: cut(meta['og:title'] || meta['twitter:title'] || (titleTag ? decode(titleTag[1]) : ''), 200),
        description: cut(meta['og:description'] || meta['twitter:description'] || meta['description'] || '', 300),
        image: abs(meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || ''),
        siteName: cut(meta['og:site_name'] || meta['application-name'] || '', 80),
        favicon: abs(favicon) || new URL('/favicon.ico', base).href,
    };
}

async function readCapped(res: Response) {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        size += value.length;
    }
    reader.cancel().catch(() => {});
    const all = new Uint8Array(Math.min(size, MAX_BYTES));
    let off = 0;
    for (const c of chunks) { const part = c.subarray(0, all.length - off); all.set(part, off); off += part.length; if (off >= all.length) break; }
    const charset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] || 'utf-8';
    try { return new TextDecoder(charset).decode(all); } catch { return new TextDecoder().decode(all); }
}

// YouTube's tags sit ~800 KB into the page, so ask its oEmbed endpoint instead
async function youtube(url: URL) {
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    if (host !== 'youtube.com' && host !== 'youtu.be') return null;
    const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1];
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    try {
        const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id),
            { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return null;
        const o = await res.json();
        return {
            url: url.href,
            title: String(o.title || ''),
            description: o.author_name ? String(o.author_name) : '',
            image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            siteName: 'YouTube',
            favicon: 'https://www.youtube.com/favicon.ico',
        };
    } catch { return null; }
}

export async function preview(raw: string) {
    let url = publicUrl(raw);
    if (!url) return { error: 'not a public http(s) address', status: 400 };
    const yt = await youtube(url);
    if (yt) return yt;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        let res: Response | null = null;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            res = await fetch(url.href, {
                redirect: 'manual',
                signal: ctrl.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; XORBIT-LinkPreview/1.0; +https://xorbit.org)',
                    'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
                    'Accept-Language': 'en',
                },
            });
            const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
            if (!loc) break;
            res.body?.cancel().catch(() => {});
            const nextUrl = publicUrl(new URL(loc, url).href);
            if (!nextUrl) return { error: 'redirects to a private address', status: 400 };
            url = nextUrl;
            res = null;
        }
        if (!res) return { error: 'too many redirects', status: 502 };

        const type = (res.headers.get('content-type') || '').toLowerCase();
        const base = { url: url.href, siteName: url.hostname.replace(/^www\./, '') };
        if (type.startsWith('image/')) {
            res.body?.cancel().catch(() => {});
            return { ...base, title: '', description: '', image: url.href, favicon: '' };
        }
        if (!res.ok || !(type.includes('html') || type.includes('xml'))) {
            res.body?.cancel().catch(() => {});
            return { ...base, title: '', description: '', image: '', favicon: '' };
        }
        const info = parseHtml(await readCapped(res), url);
        return { ...base, ...info, siteName: info.siteName || base.siteName };
    } catch (e) {
        return { error: (e as Error).name === 'AbortError' ? 'timed out' : 'could not load the page', status: 502 };
    } finally {
        clearTimeout(timer);
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    let target = new URL(req.url).searchParams.get('url') || '';
    if (!target && req.method === 'POST') {
        try { target = String((await req.json()).url || ''); } catch { /* no body */ }
    }
    if (!target || target.length > 2048) return json({ error: 'missing url' }, 400, false);
    const out = await preview(target);
    return 'error' in out ? json({ error: out.error }, out.status, false) : json(out);
});
