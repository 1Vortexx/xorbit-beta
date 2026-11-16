import assert from "node:assert";
import { setStorage, loadCareer, saveCareer, newCareer, tripOf, track, endTrip, totals, unlock, mergeAchievements, ACHIEVEMENTS } from "../js/career.js";
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

setStorage(mem());
let c = loadCareer();
assert.deepEqual(c, newCareer());
assert.deepEqual(unlock(c), []);

// a journey in progress counts towards the totals without being folded in yet
const game = { tripId: "a", day: 3, playTime: 600, diff: "normal", hostile: true, stats: { distance: 52000, litres: 30, sites: 2, escapes: 1, rides: 0 } };
track(c, tripOf(game));
assert.equal(totals(c).distance, 52000);
assert.equal(totals(c).trips, 1);
assert.equal(c.done.distance, 0);
const got = unlock(c).map((a) => a.id).sort();
assert.deepEqual(got, ["day_3", "escape", "first_km", "trip_50"]);
assert.deepEqual(unlock(c), [], "an achievement unlocks once");

// tracking the same journey again replaces it rather than adding to it
game.stats.distance = 60000;
track(c, tripOf(game));
assert.equal(totals(c).distance, 60000);
assert.equal(c.best.km, 60);

// ending folds it in once
assert.equal(endTrip(c).id, "a");
assert.equal(c.live, null);
assert.equal(c.done.distance, 60000);
assert.equal(c.done.trips, 1);
assert.equal(endTrip(c), null);
assert.equal(totals(c).distance, 60000);

// a short journey adds its numbers but isn't a trip
track(c, tripOf({ tripId: "b", day: 1, playTime: 30, stats: { distance: 100 } }));
endTrip(c);
assert.equal(c.done.trips, 1);
assert.equal(c.done.distance, 60100);

// persists, and unknown achievements from the account are ignored
mergeAchievements(c, ["ride", "not_a_real_one"]);
assert(saveCareer(c));
const back = loadCareer();
assert.equal(back.done.distance, 60100);
assert(back.ach.ride && back.ach.trip_50 && !back.ach.not_a_real_one);

// hardcore only counts on hard
const h = newCareer();
track(h, tripOf({ tripId: "h", day: 1, playTime: 5000, diff: "normal", stats: { distance: 120000 } }));
assert(!unlock(h).some((a) => a.id === "hard_100"));
track(h, tripOf({ tripId: "h", day: 1, playTime: 5000, diff: "hard", stats: { distance: 120000 } }));
assert(unlock(h).some((a) => a.id === "hard_100"));

// ids are valid for the server (^[a-z0-9_]{1,32}$) and unique
assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
for (const a of ACHIEVEMENTS) assert(/^[a-z0-9_]{1,32}$/.test(a.id), a.id);

// each account has its own career
assert(saveCareer(newCareer(), "someone"));
assert.equal(loadCareer("someone").done.distance, 0);
assert.equal(loadCareer().done.distance, 60100);

// corrupt storage gives an empty career
const s = mem(); s.setItem("longhaul-career", "{nope"); setStorage(s);
assert.deepEqual(loadCareer(), newCareer());
console.log("career ok");
