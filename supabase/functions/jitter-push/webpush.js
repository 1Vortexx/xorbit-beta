// Web Push with WebCrypto only (no Node crypto, so it runs in Supabase Edge / Deno).
//   • Payload encryption: RFC 8291 (aes128gcm content coding, RFC 8188)
//   • Sender identification: VAPID (RFC 8292), ES256 JWT
// Keys are base64url strings as printed by `web-push generate-vapid-keys`.

const enc = new TextEncoder();

export function b64urlToBytes(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function bytesToB64url(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

async function hkdf(salt, ikm, info, length) {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// Encrypts `payload` (string) for a subscription's keys { p256dh, auth }. Returns the request body.
export async function encryptPayload(payload, keys) {
    const uaPublic = b64urlToBytes(keys.p256dh);   // 65-byte uncompressed P-256 point
    const authSecret = b64urlToBytes(keys.auth);  // 16 bytes

    // Ephemeral sender key pair, then the ECDH shared secret with the browser's key
    const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
    const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

    // RFC 8291 §3.4: input keying material, then content encryption key and nonce
    const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
    const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

    // One record: plaintext + 0x02 (last-record delimiter), AES-128-GCM
    const plaintext = concat(enc.encode(payload), new Uint8Array([2]));
    const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

    // RFC 8188 header: salt(16) | record size(4) | key id length(1) | key id (sender public key)
    const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
    header.set(salt, 0);
    new DataView(header.buffer).setUint32(16, 4096);
    header[20] = asPublic.length;
    header.set(asPublic, 21);
    return concat(header, ciphertext);
}

// "vapid t=<jwt>, k=<public key>" for the push service at `endpoint`
export async function vapidAuthorization(endpoint, vapid) {
    const pub = b64urlToBytes(vapid.publicKey);
    const jwk = {
        kty: 'EC', crv: 'P-256', ext: true,
        x: bytesToB64url(pub.slice(1, 33)),
        y: bytesToB64url(pub.slice(33, 65)),
        d: vapid.privateKey,
    };
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = bytesToB64url(enc.encode(JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
    })));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
    return `vapid t=${header}.${claims}.${bytesToB64url(sig)}, k=${vapid.publicKey}`;
}

// Sends one push. Returns the push service's HTTP status (201 = accepted; 404/410 = subscription gone).
export async function sendWebPush(subscription, payload, vapid, { ttl = 60, urgency = 'high', topic } = {}) {
    const body = await encryptPayload(payload, subscription.keys);
    const headers = {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
        Authorization: await vapidAuthorization(subscription.endpoint, vapid),
    };
    if (topic) headers.Topic = topic; // a newer push with the same topic replaces an undelivered one
    const res = await fetch(subscription.endpoint, { method: 'POST', headers, body });
    return res.status;
}
