// X-ORBIT Service Worker
// • Lets the desktop be installed as an app (pass-through fetch, no caching)
// • Shows Jitter call notifications sent by the jitter-push Edge Function
const CACHE = "xorbit-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

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
  if (msg.type !== "call") return;
  e.waitUntil(openJitterFor(msg));
});

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
