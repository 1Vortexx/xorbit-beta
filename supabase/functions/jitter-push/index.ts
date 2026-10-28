// Jitter push notifications (iPhone Home Screen app, Web Push).
// POST JSON { action, ... }:
//   subscribe   { email, subscription: { endpoint, keys: { p256dh, auth } } }  register / refresh a device
//   unsubscribe { endpoint }                                                  remove a device
//   ring        { from, fromName, to, callId, convId, seq }                   "<name> is calling you"
//   missed      { from, fromName, to, callId, convId }                        "Missed call from <name>"
// Devices live in push_subscriptions (supabase/push-subscriptions.sql), readable only with the
// service role. Calls only push between people who share a 1:1 conversation and haven't blocked
// each other. Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (and optional VAPID_SUBJECT).
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendWebPush } from './webpush.js';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const VAPID = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY')!,
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY')!,
    subject: Deno.env.get('VAPID_SUBJECT') ?? 'https://xorbit.org',
};

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const EMAIL = /^[^\s@,()]+@[^\s@,()]+\.[^\s@,()]+$/;
const isPushEndpoint = (u: string) => {
    try {
        const h = new URL(u).hostname;
        return new URL(u).protocol === 'https:' &&
            /(^|\.)push\.apple\.com$|(^|\.)googleapis\.com$|(^|\.)mozilla\.com$|(^|\.)notify\.windows\.com$/.test(h);
    } catch { return false; }
};

async function canCall(from: string, to: string) {
    const { data: conv } = await sb.from('dm_conversations')
        .select('id')
        .or(`and(participant_1_email.eq.${from},participant_2_email.eq.${to}),and(participant_1_email.eq.${to},participant_2_email.eq.${from})`)
        .limit(1);
    if (!conv || !conv.length) return false;
    const { data: blocks } = await sb.from('user_blocks')
        .select('blocker_email')
        .or(`and(blocker_email.eq.${from},blocked_email.eq.${to}),and(blocker_email.eq.${to},blocked_email.eq.${from})`)
        .limit(1);
    return !blocks || !blocks.length;
}

async function pushTo(email: string, message: Record<string, unknown>, topic: string) {
    const { data: subs } = await sb.from('push_subscriptions').select('endpoint, p256dh, auth').eq('email', email);
    let sent = 0;
    await Promise.all((subs || []).map(async (s) => {
        try {
            const status = await sendWebPush(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                JSON.stringify(message), VAPID, { ttl: 60, urgency: 'high', topic });
            if (status === 404 || status === 410) await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
            else if (status < 300) sent++;
            else console.warn('push failed', status, new URL(s.endpoint).hostname);
        } catch (err) {
            console.warn('push error', String(err));
        }
    }));
    return sent;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    let body: Record<string, any>;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

    switch (body.action) {
        case 'subscribe': {
            const sub = body.subscription;
            if (!EMAIL.test(body.email || '') || !sub || !isPushEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth)
                return json({ error: 'bad subscription' }, 400);
            const { error } = await sb.from('push_subscriptions').upsert({
                endpoint: sub.endpoint, email: body.email, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
                user_agent: (req.headers.get('user-agent') || '').slice(0, 300), updated_at: new Date().toISOString(),
            }, { onConflict: 'endpoint' });
            return error ? json({ error: error.message }, 500) : json({ ok: true });
        }
        case 'unsubscribe': {
            if (!isPushEndpoint(body.endpoint || '')) return json({ error: 'bad endpoint' }, 400);
            await sb.from('push_subscriptions').delete().eq('endpoint', body.endpoint);
            return json({ ok: true });
        }
        case 'ring':
        case 'missed': {
            const { from, to, callId } = body;
            if (!EMAIL.test(from || '') || !EMAIL.test(to || '') || from === to || !/^[\w-]{8,64}$/.test(callId || ''))
                return json({ error: 'bad call' }, 400);
            if (!(await canCall(from, to))) return json({ error: 'not allowed' }, 403);
            const name = String(body.fromName || from).slice(0, 60);
            const sent = await pushTo(to, {
                type: 'call', state: body.action, callId, from, name,
                convId: typeof body.convId === 'string' ? body.convId : null,
                seq: Number(body.seq) || 0, ts: Date.now(),
            }, `jcall-${callId}`.replace(/[^\w-]/g, '').slice(0, 32));
            return json({ ok: true, sent });
        }
        default:
            return json({ error: 'unknown action' }, 400);
    }
});
