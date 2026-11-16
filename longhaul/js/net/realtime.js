// Long Haul – a minimal Supabase Realtime client: one broadcast channel over the Phoenix websocket protocol.
// Just enough for the convoy (js/convoy.js); no supabase-js, so the game keeps its no-build, no-CDN setup.
const HOST = "rujvmtvozorylfzsqppc.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1anZtdHZvem9yeWxmenNxcHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0NjQxNDEsImV4cCI6MjA3MzA0MDE0MX0.b7jJz3Se_oXXDwwd0dWQ8-rEvhY0aU4JDHQVioE39iY";
const HEARTBEAT = 25000;

// onMessage(event, payload) for every broadcast from the others; onStatus("joined" | "reconnecting" | "closed")
export class Channel {
  constructor(name, { onMessage, onStatus } = {}) {
    this.topic = "realtime:" + name;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ref = 0; this.joinRef = null; this.ws = null; this.closed = false; this.joined = false;
    this.retry = 0; this._hb = null; this._timer = null;
    this.connect();
  }
  connect() {
    if (this.closed) return;
    let ws;
    try { ws = new WebSocket(`wss://${HOST}/realtime/v1/websocket?apikey=${KEY}&vsn=1.0.0`); }
    catch (e) { this.reconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.joinRef = String(++this.ref);
      this.raw({ topic: this.topic, event: "phx_join", ref: this.joinRef, join_ref: this.joinRef, payload: {
        config: { broadcast: { self: false, ack: false }, presence: { key: "" }, postgres_changes: [], private: false },
        access_token: KEY,
      } });
      clearInterval(this._hb);
      this._hb = setInterval(() => this.raw({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++this.ref) }), HEARTBEAT);
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.topic !== this.topic) return;
      if (m.event === "phx_reply" && m.ref === this.joinRef) {
        if (m.payload && m.payload.status === "ok") { this.joined = true; this.retry = 0; this.onStatus("joined"); }
        else ws.close();
      } else if (m.event === "broadcast" && m.payload) {
        try { this.onMessage(m.payload.event, m.payload.payload || {}); } catch (e) { console.error(e); }
      } else if (m.event === "phx_error" || m.event === "phx_close") ws.close();
    };
    ws.onclose = () => {
      clearInterval(this._hb);
      const was = this.joined;
      this.joined = false;
      if (this.closed) return;
      if (was) this.onStatus("reconnecting");
      this.reconnect();
    };
    ws.onerror = () => {};
  }
  reconnect() {
    if (this.closed) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.retry++));
  }
  raw(m) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; }
  // Fire and forget: dropped while disconnected (positions are sent again a moment later anyway)
  send(event, payload) {
    if (!this.joined) return false;
    return this.raw({ topic: this.topic, event: "broadcast", ref: String(++this.ref), join_ref: this.joinRef, payload: { type: "broadcast", event, payload } });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._hb); clearTimeout(this._timer);
    if (this.joined) this.raw({ topic: this.topic, event: "phx_leave", payload: {}, ref: String(++this.ref), join_ref: this.joinRef });
    try { this.ws && this.ws.close(); } catch (e) {}
    this.onStatus("closed");
  }
}
