// Long Haul – convoy voice chat. Everyone who turns voice on is connected to everyone else who has it on (a mesh: a
// convoy is at most 6 drivers) with WebRTC audio. The convoy's broadcast channel carries the signalling ("rtc"
// messages, js/convoy.js). Each pair first tries a direct connection; only if that fails (school / work networks) does
// it reconnect through the X-ORBIT coturn relay, which is small and shared with Jitter's calls (40 allocations in all,
// 4 per credential: setup-coturn.sh) – so a relayed connection gets credentials of its own from the turn-credentials
// edge function, and a pair the relay can't help waits before trying again.
const SUPABASE_URL = "https://rujvmtvozorylfzsqppc.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1anZtdHZvem9yeWxmenNxcHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0NjQxNDEsImV4cCI6MjA3MzA0MDE0MX0.b7jJz3Se_oXXDwwd0dWQ8-rEvhY0aU4JDHQVioE39iY";
const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const SPEAKING = 0.035;       // RMS level above which someone counts as talking

const DIRECT_WAIT = 9000;     // ms a direct connection gets before the pair retries through the relay
const RETRY_AFTER = 30000;    // ms before a pair that couldn't connect even through the relay tries again

// STUN plus fresh TURN relay credentials (a username of their own); STUN only if they can't be had
export async function iceServers() {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/turn-credentials`, {
      method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: "{}",
    });
    const d = await r.json();
    if (!d || !Array.isArray(d.iceServers)) throw new Error("no iceServers");
    return [...STUN, ...d.iceServers];
  } catch (e) {
    console.warn("Convoy voice: TURN relay unavailable, direct connections only", e);
    return STUN;
  }
}

// send(to, data): deliver an "rtc" message to one member. Every member connection: { pc, audio, level, speaking }
export class Voice {
  constructor(send) {
    this.send = send;
    this.on = false; this.stream = null; this.peers = new Map();
    this.mode = "open"; this.talking = false; this.muted = false; this.volume = 1; this.forceRelay = false;
    this.ctx = null; this.meLevel = 0; this.meAnalyser = null;
    this.error = null; this.retryAt = new Map();       // memberId → time before which not to call them again
  }
  get transmitting() { return this.on && !this.muted && (this.mode === "open" || this.talking); }

  // Turn voice on: ask for the microphone. → true, or false with this.error ("denied" | "unsupported")
  async start() {
    if (this.on) return true;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") { this.error = "unsupported"; return false; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { this.error = "denied"; return false; }
    this.error = null; this.on = true;
    this.ctx = this.ctx || new AudioContext();
    this.meAnalyser = this.analyse(this.stream);
    this.applyMic();
    return true;
  }
  stop() {
    for (const id of [...this.peers.keys()]) this.drop(id, true);
    this.retryAt.clear();
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null; this.on = false; this.meAnalyser = null; this.meLevel = 0;
  }
  applyMic() { if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = this.transmitting; }
  setVolume(v) { this.volume = v; for (const p of this.peers.values()) if (p.audio) p.audio.volume = v; }

  // Each tick, from js/convoy.js: who has voice on. The lower id of each pair makes the offer, so it happens once.
  sync(myId, voiced) {
    this.myId = myId;
    if (!this.on) return;
    for (const id of [...this.peers.keys()]) if (!voiced.has(id)) this.drop(id);
    const now = Date.now();
    for (const id of voiced) if (!this.peers.has(id) && myId < id && !(this.retryAt.get(id) > now)) this.call(id, this.forceRelay);
  }

  // The connection is registered at once (so the next tick doesn't start a second one while relay credentials load);
  // p.ready resolves to it once it exists, or to null if it was dropped meanwhile. relay: go through coturn.
  peer(id, relay) {
    const p = { pc: null, relay, audio: null, analyser: null, level: 0, speaking: false, pending: [], ready: null, timer: 0 };
    this.peers.set(id, p);
    p.ready = (relay ? iceServers() : Promise.resolve(STUN)).then((servers) => (this.peers.get(id) === p && this.stream ? this.connect(id, p, servers) : null));
    return p;
  }
  connect(id, p, servers) {
    const pc = p.pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: p.relay && this.forceRelay ? "relay" : "all" });
    for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
    pc.onicecandidate = (e) => { if (e.candidate) this.send(id, { kind: "ice", candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      const s = e.streams[0] || new MediaStream([e.track]);
      if (!p.audio) { p.audio = new Audio(); p.audio.autoplay = true; }
      p.audio.srcObject = s; p.audio.volume = this.volume;
      p.audio.play?.().catch(() => {});
      p.analyser = this.analyse(s);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") { clearTimeout(p.timer); this.retryAt.delete(id); }
      else if (pc.connectionState === "failed" && this.peers.get(id) === p) this.failed(id, p);
    };
    return p;
  }
  // The caller's side: offer, and if a direct attempt hasn't connected in time, start over through the relay
  async call(id, relay = false) {
    const p = await this.peer(id, relay).ready;
    if (!p) return;
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.send(id, { kind: "offer", relay, sdp: p.pc.localDescription.toJSON() });
    p.timer = setTimeout(() => { if (this.peers.get(id) === p && p.pc.connectionState !== "connected") this.failed(id, p); }, relay ? DIRECT_WAIT * 2 : DIRECT_WAIT);
  }
  failed(id, p) {
    const relayed = p.relay;
    if (!(this.myId < id)) { this.drop(id, true); return; }   // the caller's side does the retrying
    this.drop(id);
    if (!relayed) this.call(id, true);                       // direct didn't work: once more through coturn
    else this.retryAt.set(id, Date.now() + RETRY_AFTER);     // nor did the relay: leave it a while (sync retries)
  }
  // An "rtc" message from member `from`
  async receive(from, d) {
    if (!this.on || !d) return;
    let p = this.peers.get(from);
    try {
      if (d.kind === "offer") {
        if (p) this.drop(from, true);
        p = await this.peer(from, !!d.relay).ready;
        if (!p) return;
        await p.pc.setRemoteDescription(d.sdp);
        await this.flush(p);
        const answer = await p.pc.createAnswer();
        await p.pc.setLocalDescription(answer);
        this.send(from, { kind: "answer", sdp: p.pc.localDescription.toJSON() });
      } else if (d.kind === "answer" && p && (await p.ready)) {
        await p.pc.setRemoteDescription(d.sdp);
        await this.flush(p);
      } else if (d.kind === "ice" && p) {
        if (p.pc && p.pc.remoteDescription) await p.pc.addIceCandidate(d.candidate); else p.pending.push(d.candidate);
      } else if (d.kind === "bye" && p) this.drop(from, true);
    } catch (e) { console.warn("Convoy voice:", e); }
  }
  async flush(p) { for (const c of p.pending.splice(0)) { try { await p.pc.addIceCandidate(c); } catch (e) {} } }
  drop(id, quiet = false) {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    if (!quiet) this.send(id, { kind: "bye" });
    try { p.pc && p.pc.close(); } catch (e) {}
    if (p.audio) { p.audio.srcObject = null; }
    this.peers.delete(id);
  }

  analyse(stream) {
    try {
      const a = this.ctx.createAnalyser();
      a.fftSize = 512;
      this.ctx.createMediaStreamSource(stream).connect(a);
      return { a, buf: new Float32Array(a.fftSize) };
    } catch (e) { return null; }
  }
  rms(an) {
    if (!an) return 0;
    an.a.getFloatTimeDomainData(an.buf);
    let s = 0;
    for (const v of an.buf) s += v * v;
    return Math.sqrt(s / an.buf.length);
  }
  // Talking indicators: call a few times a second
  levels() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    // "Talking" holds for a moment after the last loud sample, so it doesn't flicker between words
    const now = performance.now();
    this.meLevel = this.transmitting ? this.rms(this.meAnalyser) : 0;
    if (this.meLevel > SPEAKING) this.meUntil = now + 450;
    this.meSpeaking = now < (this.meUntil || 0);
    for (const p of this.peers.values()) {
      p.level = this.rms(p.analyser);
      if (p.level > SPEAKING) p.until = now + 450;
      p.speaking = now < (p.until || 0);
    }
  }
  get speaking() { return !!this.meSpeaking; }
  state(id) {
    const p = this.peers.get(id);
    if (!p) return null;
    return { connected: !!p.pc && p.pc.connectionState === "connected", speaking: p.speaking };
  }
}
