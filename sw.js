// X-ORBIT Service Worker
// • Lets the desktop be installed as an app (pass-through fetch, no caching)
// • Shows Jitter call notifications sent by the jitter-push Edge Function
const CACHE = "xorbit-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
  // Chrome refuses client.navigate() until activation has finished, so sweep just after
  setTimeout(reloadStaleJitter, 0);
});

// ── Stale Jitter sweep ─────────────────────────────────────────────
// When this worker takes over, ask each open Jitter for its version. Current copies answer
// (see VERSION CHECK in jittery.html) and enforce min_version themselves; copies from before
// that code can't answer, so they're reloaded onto a fresh URL that skips the browser cache.
const JITTER_PING_TIMEOUT_MS = 5000;

async function reloadStaleJitter() {
  const windows = await clients.matchAll({ type: "window" });
  const jitters = windows.filter((c) => new URL(c.url).pathname.endsWith("/jittery.html"));
  await Promise.all(jitters.map(async (client) => {
    if (await answersVersionPing(client)) return;
    const url = new URL(client.url);
    url.searchParams.set("_v", Date.now());
    try { await client.navigate(url.toString()); } catch (_) { /* not controlled by this worker */ }
  }));
}

function answersVersionPing(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), JITTER_PING_TIMEOUT_MS);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(!!(e.data && e.data.type === "jitter-version-pong"));
    };
    client.postMessage({ type: "jitter-version-ping" }, [channel.port2]);
  });
}

// Pass-through fetch – no offline caching needed for the prompt to work
self.addEventListener("fetch", () => {});

// ── Jitter call pushes ─────────────────────────────────────────────
// A ring arrives about every second (up to 30) while the call rings; each one replaces the
// last under a new tag, so the phone buzzes again (iOS stays silent when a notification is
// just updated).
// "missed" clears them and leaves one "Missed call" notification.
const RING_FRESH_MS = 45000;

self.addEventListener("push", (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch (_) {}
  if (msg.type !== "call") return;
  e.waitUntil(showCallNotification(msg));
});

async function showCallNotification(msg) {
  const prefix = "jcall-" + msg.callId;
  const old = await self.registration.getNotifications();
  old.filter((n) => n.tag && n.tag.startsWith(prefix)).forEach((n) => n.close());

  const ringing = msg.state === "ring";
  await self.registration.showNotification(
    ringing ? `${msg.name} is calling you` : `Missed call from ${msg.name}`,
    {
      body: ringing ? "Tap to answer in Jitter" : "Tap to open the chat",
      tag: ringing ? `${prefix}-${msg.seq || 0}` : `${prefix}-missed`,
      icon: "/jitter/icon-192.png",
      badge: "/jitter/icon-192.png",
      requireInteraction: ringing,
      data: msg,
    }
  );
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const msg = e.notification.data || {};
  if (msg.type === "call-paused") e.waitUntil(backToJitter());
  if (msg.type !== "call") return;
  e.waitUntil(openJitterFor(msg));
});

// "Call paused" (iPhone app went to the background mid-call): just bring Jitter back
async function backToJitter() {
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const jitter = windows.find((c) => new URL(c.url).pathname.endsWith("/jittery.html"));
  if (jitter) { try { await jitter.focus(); return; } catch (_) {} }
  await clients.openWindow("/jitter/");
}

async function openJitterFor(msg) {
  const fresh = msg.state === "ring" && Date.now() - (msg.ts || 0) < RING_FRESH_MS;
  const ring = fresh ? { callId: msg.callId, email: msg.from, name: msg.name, convId: msg.convId } : null;

  // Jitter already open (iPhone app in the background): bring it forward and hand it the call
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const jitter = windows.find((c) => new URL(c.url).pathname.endsWith("/jittery.html"));
  if (jitter) {
    jitter.postMessage({ type: "jitter-push-open", ring, convId: msg.convId });
    try { await jitter.focus(); return; } catch (_) { /* fall through and open it */ }
  }

  // Otherwise launch it; /jitter/ passes these on to jittery.html
  const params = new URLSearchParams();
  if (ring) params.set("ring", JSON.stringify(ring));
  else if (msg.convId) params.set("chat", msg.convId);
  await clients.openWindow("/jitter/?" + params.toString());
}
