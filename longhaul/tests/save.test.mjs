import assert from "node:assert";
import { setStorage, loadSave, writeSave, clearSave, loadPrefs, savePrefs, previewOf, migrateV2 } from "../js/save.js";
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

let s = mem(); setStorage(s);
assert.deepEqual(loadSave(), { save: null, error: null });
const good = { seed: 5, day: 3, time: 0.4, diff: "hard", needs: { health: 90 }, player: { pos: [1, 2, 3], yaw: 0 }, world: {}, stats: { distance: 1234 } };
assert(writeSave(good));
let r = loadSave();
assert(r.save && r.save.v === 3 && r.save.day === 3 && r.error === null);
assert.equal(previewOf(r.save).distance, 1234);

// corrupt → reported and backed up, not deleted
s.setItem("longhaul-save-v3", "{not json");
r = loadSave();
assert.equal(r.error, "corrupt"); assert.equal(r.save, null);
assert.equal(s.getItem("longhaul-save-backup"), "{not json");
assert.equal(s.getItem("longhaul-save-v3"), "{not json");
s.setItem("longhaul-save-v3", JSON.stringify({ v: 3, seed: 1, day: 1, needs: {}, world: {}, player: { pos: [NaN, 0, 0] } }));
assert.equal(loadSave().error, "corrupt");
s.setItem("longhaul-save-v3", JSON.stringify({ v: 9 }));
assert.equal(loadSave().error, "newer");

// v2 migration keeps the old key
s = mem(); setStorage(s);
const v2 = { v: 2, seed: 77, time: 0.6, day: 4, diff: "easy", car: { pos: [0, 0, 5000], fuel: 22, odometer: 37200 }, parts: { engine: 55, body: 80 }, needs: { health: 70, hunger: 50, thirst: 40, energy: 30 }, inv: { items: { water: 2, tyre: 1 }, money: 64 }, stats: { wrecks: 3, litres: 40 } };
s.setItem("longhaul-save-v2", JSON.stringify(v2));
r = loadSave();
assert(r.save && r.save.migrated === 2 && r.save.seed === 77 && r.save.day === 4 && r.save.wallet.money === 64);
assert.equal(r.save.stats.distance, 37200); assert.equal(r.save.legacy.items.water, 2);
assert(s.getItem("longhaul-save-v2"));
assert.equal(migrateV2({ v: 1 }), null);
clearSave(); assert.deepEqual(loadSave(), { save: null, error: null });

// storage that throws
setStorage({ getItem() { throw new Error("x"); }, setItem() { throw new Error("full"); }, removeItem() {} });
assert.equal(writeSave(good), false);
assert.equal(loadSave().save, null);
setStorage(null);
assert.equal(loadSave().error, "unavailable"); assert.equal(writeSave(good), false);

// prefs: defaults, nested merge, old format, bad values
s = mem(); setStorage(s);
let p = loadPrefs();
assert.equal(p.vol.music, 0.6); assert.equal(p.hud.show, "full");
s.setItem("longhaul-prefs", JSON.stringify({ volume: 0.3, showHelp: false, quality: "ultra", fov: 500, units: "mi", hud: undefined }));
p = loadPrefs();
assert.equal(p.vol.master, 0.3); assert.equal(p.vol.sfx, 0.8); assert.equal(p.hud.help, false);
assert.equal(p.quality, "auto"); assert.equal(p.fov, 110); assert.equal(p.units, "mi");
p.hud.scale = 1.25; savePrefs(p); assert.equal(loadPrefs().hud.scale, 1.25);
console.log("save ok");
