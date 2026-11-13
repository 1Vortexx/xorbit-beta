// Long Haul – inline SVG icons (drawn for this game; 24×24 grid, stroke = currentColor) and small UI helpers.
const P = {
  fuel: "M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3.5 21h13M7.5 7h5v4h-5zM15 10h1.5a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3",
  temp: "M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0zM12 10v7",
  oil: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11zM9.500 14.500a2.500 2.500 0 0 0 2.500 2.500",
  coolant: "M12 2.500v19M3.800 7.200l16.400 9.600M20.200 7.200L3.800 16.800M9.500 3.500L12 6l2.500-2.500M9.500 20.500L12 18l2.500 2.500",
  battery: "M3 8h18v11H3zM7 8V5M17 8V5M6 13.500h4M14.500 13.500h4M16.500 11.500v4",
  tyre: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 3v6M12 15v6M3 12h6M15 12h6",
  engine: "M8 9V6h5v3M3.500 11.500v6M3.500 14.500H6M6 9h10l2 3h2.500v6H18l-2 2H6z",
  body: "M2.500 16v-3.500l3.500-1 2-4h7.500l3 4 3 1V16h-1.500M9.500 16h5M5.500 16a2 2 0 1 0 4 0a2 2 0 0 0-4 0M14.500 16a2 2 0 1 0 4 0a2 2 0 0 0-4 0",
  lights: "M9.500 5a7 7 0 0 0 0 14c2.800 0 4-3 4-7s-1.200-7-4-7zM16.500 7.500h4.500M16.500 12h4.500M16.500 16.500h4.500",
  pbrake: "M12 5a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM10.200 15.500v-7h2.300a2.200 2.200 0 0 1 0 4.400h-2.300M3.200 6.500a10.500 10.500 0 0 0 0 11M20.800 6.500a10.500 10.500 0 0 1 0 11",
  heart: "M12 20s-7.500-4.600-7.500-10.200A4.200 4.200 0 0 1 12 7.300a4.200 4.200 0 0 1 7.500 2.500C19.500 15.400 12 20 12 20z",
  food: "M6 3v6a2.500 2.500 0 0 0 5 0V3M8.500 3v18M17.500 21V3c-2.300 1.600-3.200 4.200-3.200 7.200 0 1.900 1.100 2.800 3.200 2.800",
  thirst: "M6 4h12l-1.600 16.500H7.600zM6.600 10h10.800",
  energy: "M13 2.500L5 14h6l-1 7.500L18 10h-6z",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2.500v2.500M12 19v2.500M2.500 12H5M19 12h2.500M5.300 5.300L7 7M17 17l1.700 1.700M18.700 5.300L17 7M7 17l-1.700 1.700",
  moon: "M20 14.500A8.200 8.200 0 0 1 9.500 4a8.200 8.200 0 1 0 10.500 10.500z",
  cloud: "M7 18.500a4.200 4.200 0 0 1-.300-8.400a5.600 5.600 0 0 1 10.800 1.300A3.600 3.600 0 0 1 17 18.500z",
  rain: "M7 15a4.200 4.200 0 0 1-.300-8.400a5.600 5.600 0 0 1 10.800 1.300A3.600 3.600 0 0 1 17 15M8 18l-1 3M12.500 18l-1 3M17 18l-1 3",
  storm: "M7 15a4.200 4.200 0 0 1-.300-8.400a5.600 5.600 0 0 1 10.800 1.300A3.600 3.600 0 0 1 17 15M12.500 12l-2.500 4.500h4L11.500 21",
  dust: "M3 8.500h10.500a2.800 2.800 0 1 0-2.800-2.800M3 12.500h15.500a2.800 2.800 0 1 1-2.800 2.800M3 16.500h7",
  note: "M9 18V5.500l11-2.500v13M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z",
  warn: "M12 3.500L2.500 20h19zM12 10v5M12 17.300v.400",
  info: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 11v6M12 7.300v.400",
  good: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM7.500 12.300l3 3 6-6.300",
  box: "M4 8l8-4.500L20 8v8l-8 4.500L4 16zM4 8l8 4.500L20 8M12 12.500v8",
  cursor: "M5 3l14.500 8-6.500 2-2 6.500z",
  back: "M14.500 5l-7 7 7 7",
  next: "M9.500 5l7 7-7 7",
  road: "M9 3L5 21M15 3l4 18M12 4.500v3M12 10.500v3M12 16.500v3",
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8v.100M16 8v.100M12 12v.100M8 16v.100M16 16v.100",
  skip: "M5 5l9 7-9 7zM18 5v14",
  wrench: "M14.500 6.500a4 4 0 0 0-5.300 5.300L3.500 17.500l3 3 5.700-5.700a4 4 0 0 0 5.300-5.300l-2.700 2.700-2.800-.700-.700-2.800z",
  bag: "M5 8h14l1 12.500H4zM9 8V6.500a3 3 0 0 1 6 0V8",
  x: "M6 6l12 12M18 6L6 18",
};

export function icon(name, cls = "") {
  const d = P[name] || P.info;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}
// Critical marker: a filled octagon (shape differs from the warning triangle, so it never relies on colour).
export function critIcon(cls = "") {
  return `<svg class="ic ic-crit ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="fillc" d="M8 2.500h8l5.500 5.500v8L16 21.500H8L2.500 16V8z"/><path class="cut" d="M12 7v6.500M12 16.800v.400"/></svg>`;
}
export const hasIcon = (name) => !!P[name];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);

// metres → display distance in the chosen units
export function fmtDist(m, units, digits = 1) {
  const v = (m || 0) / (units === "mi" ? 1609.344 : 1000);
  return `${v.toFixed(v >= 1000 ? 0 : digits)} ${units === "mi" ? "mi" : "km"}`;
}
export function weatherIcon(label, clock) {
  const l = String(label || "").toLowerCase();
  if (/dust|sand|haz|wind/.test(l)) return "dust";
  if (/storm|thunder/.test(l)) return "storm";
  if (/rain|drizzle|shower/.test(l)) return "rain";
  if (/cloud|overcast/.test(l)) return "cloud";
  const h = parseInt(String(clock || "12"), 10);
  return h >= 20 || h < 6 ? "moon" : "sun";
}
