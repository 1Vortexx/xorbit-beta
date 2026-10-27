// Long Haul – X-ORBIT Performance Mode hookup
// X-ORBIT sends { type: "xorbit-performance", lite } to app windows and answers
// { type: "xorbit-performance-query" }. Outside X-ORBIT we guess from the device.

const device = (() => {
  const chromebook = /\bCrOS\b/.test(navigator.userAgent || "");
  const memory = navigator.deviceMemory || null;
  const cores = navigator.hardwareConcurrency || null;
  return chromebook || (memory !== null && memory <= 4) || (cores !== null && cores <= 2);
})();

export function settingsFor(lite) {
  return lite
    ? { lite: true, pixelRatio: 1, fogFar: 320, ahead: 2, behind: 1 }
    : { lite: false, pixelRatio: Math.min(devicePixelRatio || 1, 1.5), fogFar: 450, ahead: 3, behind: 1 };
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
  if (window.parent !== window) {
    try { window.parent.postMessage({ type: "xorbit-performance-query" }, "*"); } catch (e) {}
  }
}
