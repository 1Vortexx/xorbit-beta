// Long Haul – X-ORBIT account link: who is signed in, journey reports, achievements and the global leaderboard.
// Talks to the X-ORBIT Supabase project over plain REST (tables and functions: supabase/longhaul-career-setup.sql).
// Every call fails quietly: the game never waits on the network or breaks without it.
const SUPABASE_URL = "https://rujvmtvozorylfzsqppc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1anZtdHZvem9yeWxmenNxcHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0NjQxNDEsImV4cCI6MjA3MzA0MDE0MX0.b7jJz3Se_oXXDwwd0dWQ8-rEvhY0aU4JDHQVioE39iY";
const HEADERS = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };

// ── Which account Long Haul plays as ──
// Only an account signed in on Long Haul's own Account screen ("longhaul-account"). X-ORBIT's site-wide session is
// deliberately ignored, and signing in or out here never changes it.
// Accounts are named by their Jitter handle (clients.username): that is what the leaderboard and saves are keyed by.
const CHOICE = "longhaul-account";
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
write("longhaul-session-user", null);          // left over from builds that followed X-ORBIT's session

export function identity() {
  const c = read(CHOICE);
  return c && c.mode === "account" && c.username ? c.username : null;
}

// The same check as X-ORBIT's sign-in page (auth.html), including its log of sign-in attempts.
// → { user } | { error: "invalid" | "blocked" | "offline", reason? }
export async function signIn(id, password) {
  id = String(id || "").trim();
  if (!id || !password) return { error: "invalid" };
  const q = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  let row;
  try {
    const r = await select(`clients?select=id,name,email,username,blocked,ban_reason`
      + `&or=${encodeURIComponent(`(email.eq.${q(id)},name.eq.${q(id)})`)}&password=eq.${encodeURIComponent(password)}&limit=1`);
    [row] = await r.json();
  } catch (e) { return { error: "offline" }; }
  const ok = !!row && !row.blocked;
  let device = null;
  try { device = localStorage.getItem("xorbit_device_uuid"); } catch (e) {}
  fetch(`${SUPABASE_URL}/rest/v1/login_attempts`, { method: "POST", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({
    attempted_username: id, attempted_email: id.includes("@") ? id : null, success: ok, attempt_timestamp: new Date().toISOString(),
    user_agent: navigator.userAgent, device_uuid: device, client_id: row ? row.id : undefined, client_name: row ? row.name : undefined,
    client_email: row ? row.email : undefined, failure_reason: !row ? "Invalid credentials" : row.blocked ? "Account blocked" : undefined,
  }) }).catch(() => {});
  if (!row) return { error: "invalid" };
  if (row.blocked) return { error: "blocked", reason: row.ban_reason || "" };
  const user = row.username || row.name;
  write(CHOICE, { mode: "account", username: user });
  return { user };
}
export function signOut() { write(CHOICE, null); }

// One row per game load for the admin logs (supabase/longhaul-launches.sql). Guests are logged too, with no username.
export function logLaunch(user, { hasSave = false } = {}) {
  let device = null, framed = true;
  try { device = localStorage.getItem("xorbit_device_uuid"); } catch (e) {}
  try { framed = window.parent !== window; } catch (e) {}
  const platform = /\bElectron\//.test(navigator.userAgent) ? "desktop" : framed ? "xorbit" : "web";
  fetch(`${SUPABASE_URL}/rest/v1/longhaul_launches`, { method: "POST", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({
    username: user || null, signed_in: !!user, platform, device_uuid: device, user_agent: navigator.userAgent,
    page_url: location.href.slice(0, 500), referrer: document.referrer ? document.referrer.slice(0, 500) : null,
    has_save: !!hasSave, screen: `${screen.width}x${screen.height}`,
  }) }).catch(() => {});
}

export function newTripId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  const h = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function rpc(name, args) {
  // keepalive lets the last report go out as the tab closes; browsers only allow it for small bodies
  const body = JSON.stringify(args);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: HEADERS, body, keepalive: body.length < 60000 });
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r;
}
async function select(path, extra = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...HEADERS, ...extra } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r;
}

export function reportTrip(user, trip, ended = false, cause = null) {
  if (!user || !trip || !trip.id) return Promise.resolve(false);
  return rpc("longhaul_report_trip", {
    p_username: user, p_trip: trip.id, p_distance: trip.distance, p_days: trip.days, p_play_time: trip.playTime,
    p_sites: trip.sites, p_difficulty: trip.diff, p_hostile: trip.hostile, p_ended: ended, p_cause: cause,
  }).then(() => true, () => false);
}
export function pushAchievements(user, ids) {
  if (!user || !ids.length) return Promise.resolve(false);
  return rpc("longhaul_add_achievements", { p_username: user, p_ids: ids }).then(() => true, () => false);
}

// The player's own achievements on the account → [id] or null when unreachable
export async function fetchAchievements(user) {
  try {
    const r = await select(`longhaul_players?select=achievements&username=eq.${encodeURIComponent(user)}`);
    const [row] = await r.json();
    return row && row.achievements ? Object.keys(row.achievements) : [];
  } catch (e) { return null; }
}

export const BOARDS = { trip: "best_m", total: "total_m", days: "best_days" };
const COLS = "username,best_m,total_m,trips,best_days,achievements";

// → { rows, me, rank } (me/rank: the player's own row when outside the top 25), or null when unreachable
export async function fetchBoard(kind, user) {
  const col = BOARDS[kind] || BOARDS.trip;
  try {
    const rows = await (await select(`longhaul_board?select=${COLS}&order=${col}.desc,username.asc&limit=25`)).json();
    let me = null, rank = 0;
    if (user && !rows.some((r) => r.username === user)) {
      const [mine] = await (await select(`longhaul_board?select=${COLS}&username=eq.${encodeURIComponent(user)}`)).json();
      if (mine) {
        const r = await select(`longhaul_board?select=username&${col}=gt.${Number(mine[col]) || 0}`, { Prefer: "count=exact", Range: "0-0" });
        const total = Number((r.headers.get("content-range") || "").split("/")[1]);
        me = mine; rank = (isFinite(total) ? total : 0) + 1;
      }
    }
    return { rows, me, rank };
  } catch (e) { return null; }
}

// The player's own row: totals over every device they play on → row | null
export async function fetchMine(user) {
  if (!user) return null;
  try {
    const [row] = await (await select(`longhaul_board?select=${COLS}&username=eq.${encodeURIComponent(user)}`)).json();
    return row || null;
  } catch (e) { return null; }
}

// ── Cloud saves (supabase/longhaul-cloud-saves.sql): one journey per account ──
export function putSave(user, data) {
  if (!user || !data) return Promise.resolve(false);
  return rpc("longhaul_put_save", { p_username: user, p_data: data }).then(() => true, () => false);
}
export function dropSave(user, trip) {
  if (!user || !trip) return Promise.resolve(false);
  return rpc("longhaul_drop_save", { p_username: user, p_trip: trip }).then(() => true, () => false);
}
// → { data, at } | null (nothing saved) | undefined (unreachable)
export async function getSave(user) {
  if (!user) return null;
  try {
    const row = await (await rpc("longhaul_get_save", { p_username: user })).json();
    return row && row.data ? { data: row.data, at: Date.parse(row.saved_at) || 0 } : null;
  } catch (e) { return undefined; }
}
