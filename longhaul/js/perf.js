// Long Haul – X-ORBIT Performance Mode hookup and quality presets.
// X-ORBIT sends { type: "xorbit-performance", lite } to app windows and answers
// { type: "xorbit-performance-query" }. Outside X-ORBIT we guess from the device.
// Presets only change rendering cost. World generation, loot and collisions are identical in both.

const device = (() => {
  const chromebook = /\bCrOS\b/.test(navigator.userAgent || "");
  const memory = navigator.deviceMemory || null;
  const cores = navigator.hardwareConcurrency || null;
  return chromebook || (memory !== null && memory <= 4) || (cores !== null && cores <= 2);
})();

export const embedded = (() => { try { return window.parent !== window; } catch (e) { return true; } })();

export function settingsFor(lite) {
  return lite
    ? { lite: true, pixelRatio: 1, shadows: false, shadowSize: 1024, fogFar: 2000, ahead: 2, behind: 1, post: false, envEvery: 30 }
    : { lite: false, pixelRatio: Math.min(devicePixelRatio || 1, 1.5), shadows: true, shadowSize: 2048, fogFar: 3600, ahead: 4, behind: 1, post: true, envEvery: 8 };
}

export function watchPerformance(onChange) {
  let lite = device;
  onChange(lite);
  addEventListener("message", (e) => {
    if (e.data && e.data.type === "xorbit-performance" && typeof e.data.lite === "boolean" && e.data.lite !== lite) {
      lite = e.data.lite;
      onChange(lite);
    }
  });
  if (embedded) {
    try { window.parent.postMessage({ type: "xorbit-performance-query" }, "*"); } catch (e) {}
  }
}
