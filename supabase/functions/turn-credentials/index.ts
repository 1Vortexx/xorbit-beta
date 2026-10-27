// Short-lived TURN credentials for Jitter voice calls.
// coturn on the VPS runs with use-auth-secret; it accepts username "<expiry>:<label>"
// with password base64(HMAC-SHA1(TURN_SECRET, username)) until <expiry> (unix seconds).
// Secret: supabase secrets set TURN_SECRET=<contents of /root/.turn-secret on the VPS>
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const TURN_SECRET = Deno.env.get('TURN_SECRET')!;
const TURN_HOST   = Deno.env.get('TURN_HOST') ?? '158.173.1.138';
const TTL_SECONDS = 4 * 60 * 60;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    const username = `${Math.floor(Date.now() / 1000) + TTL_SECONDS}:${crypto.randomUUID().slice(0, 8)}`; // unique, so user-quota is per caller
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(TURN_SECRET),
        { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username));
    const credential = btoa(String.fromCharCode(...new Uint8Array(sig)));

    return new Response(JSON.stringify({
        ttl: TTL_SECONDS,
        iceServers: [{
            urls: [`turn:${TURN_HOST}:3478?transport=udp`, `turn:${TURN_HOST}:3478?transport=tcp`],
            username,
            credential,
        }],
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
