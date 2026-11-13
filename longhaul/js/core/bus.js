// Long Haul – tiny shared bus: notifications, sound requests and game events.
// No imports, so every module can use it without import-order problems.
const subs = new Map();

export function on(type, fn) {
  if (!subs.has(type)) subs.set(type, new Set());
  subs.get(type).add(fn);
  return () => subs.get(type).delete(fn);
}
export function emit(type, data) {
  const s = subs.get(type);
  if (s) for (const fn of [...s]) fn(data);
}

// Player-facing message. level: "info" | "good" | "warn" | "crit". icon: short text/emoji (never colour alone).
// key: messages with the same key replace each other instead of stacking.
export function notify(text, opts = {}) {
  emit("notify", { text, level: opts.level || "info", icon: opts.icon || "", key: opts.key || null, ms: opts.ms || 0 });
}

// One-shot sound by name (see audio.js SFX list). opts: { vol, rate, pos: Vector3 (absolute world) }
export function sfx(name, opts) { emit("sfx", { name, opts: opts || {} }); }
