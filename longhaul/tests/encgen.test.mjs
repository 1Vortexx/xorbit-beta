import assert from "node:assert/strict";
import { encountersBetween, encounterById, encRng, FIRST_HITCH_Z, FIRST_ROADBLOCK_Z } from "../js/core/encgen.js";
import { setSeed, roadX } from "../js/world/terrain.js";
import { sitesBetween } from "../js/world/sites.js";
function sample(seed) {
  setSeed(seed);
  const es = encountersBetween(0, 900000);
  assert.ok(es.some(e=>e.kind==="hitch") && es.some(e=>e.kind==="roadblock"));
  assert.deepEqual(es, [...encountersBetween(0,445001), ...encountersBetween(445001,900000)]);
  for (const e of es) {
    assert.deepEqual(encounterById(e.id),e);
    assert.ok(e.z >= (e.kind==="hitch" ? FIRST_HITCH_Z : FIRST_ROADBLOCK_Z));
    assert.equal(e.x,roadX(e.z));
    assert.equal(sitesBetween(e.z-260,e.z+260).length,0);
  }
  return es;
}
const first = sample(73);
assert.notDeepEqual(sample(5),first);
for(let i=0;i<90;i++) encRng("unrelated" + i)();
assert.deepEqual(sample(73),first);
console.log("Encounter schedule: seeded, site-safe and stable across streaming and seed changes.");
