# Long Haul – architecture and shared contracts

Static browser game. No build step, no backend. `index.html` loads ES modules; Three.js 0.170 is vendored in
`vendor/three/` and mapped by the import map (`three`, `three/addons/`). Only the addons already in
`vendor/three/addons/` may be imported; if you need another one, copy it there from the same Three.js version.

Everything is procedural (geometry, canvas textures, synthesized audio). No downloaded art assets.

## 1. Ownership

| Area | Files | Owner |
|---|---|---|
| Boot, loop, state machine, camera, saves, audio, music, X-ORBIT | `js/main.js`, `js/camera.js`, `js/save.js`, `js/perf.js`, `js/audio.js`, `js/music.js`, `js/survival.js`, `js/core/*`, `audio/`, `tests/` (shared), docs | **lead** |
| Vehicles | `js/vehicles/*`, `dev/vehicle.html`, `tests/vehicle*.test.mjs` | **vehicle agent** |
| World | `js/world/*`, `js/sky.js`, `js/weather.js`, `dev/world.html`, `tests/world*.test.mjs` | **world agent** |
| On-foot play | `js/player.js`, `js/interact.js`, `js/items.js`, `js/props.js`, `js/pockets.js`, `dev/interact.html`, `tests/items*.test.mjs` | **interaction agent** |
| Interface | `index.html`, `css/*`, `js/input.js`, `js/ui/*`, `dev/ui.html` | **interface agent** |

Do not edit files you do not own. If a contract here is wrong or missing something, implement against your best
reading and list the deviation in your final report – the lead reconciles in `main.js`.
The old flat modules (`js/car.js`, `js/parts.js`, `js/world.js`, `js/stations.js`, old `js/items.js`, …) are the
starting point for their new owners: move/rewrite them into your files and delete the old ones you replace.

## 2. Units, axes, coordinates

- Metres, seconds, kilograms, litres, °C, radians. y is up. The road heads towards +z. A vehicle's forward is its local +z,
  its left is local +x (existing convention – keep it).
- Simulation positions are **absolute world coordinates** in JS doubles. Never store render-space positions.
- **Floating origin** (`js/core/origin.js`): every world object – chunks, vehicles, props, the camera, lights, sky dome,
  weather particles – is a descendant of `worldRoot` and is positioned with absolute coordinates. `worldRoot` is offset by
  `−origin`, so GPU values stay small. Keep vertex data and instance matrices local to a parent within ~500 m.
  Raycaster hits / `getWorldPosition()` are render space: convert with `toWorld()`.
- Fixed physics step 1/120 s (main owns the accumulator). Anything stepped must be frame-rate independent.
- Game time: `sky.time` 0..1 of a day; main owns day count.

## 3. Shared kernel (`js/core`, written by the lead – read the source)

- `bus.js`: `on(type, fn)`, `emit(type, data)`, `notify(text, {level, icon, key})`, `sfx(name, opts)`.
  Events used across modules: `chunk:load` (chunk), `chunk:unload` (chunk), `notify`, `sfx`, `discover` ({site}).
- `collide.js`: collider shapes (`circle`, `box` with yaw, optional `y0/y1`, `solid`), `resolveCircle`, `circleFree`, `pathBlocked`.
  This is the only collision system for walls, doors, scenery, vehicles vs world, player and props. No physics library:
  the vehicle keeps its custom raycast-suspension model (deliberate: static deploy, deterministic, cheap on Chromebooks).
- `targets.js`: interaction registry and raycast (§6).
- `worldstate.js`: `ws` – persistence of world changes (§8).
- `origin.js`: floating origin.

Ground height is always `heightAt(x, z)` from `js/world/terrain.js`. Building floors are flush with the (flattened)
terrain, so there is one ground function for wheels, feet and props. Single storey only.

## 4. Items and components

```js
// Definition (static). ITEMS in js/items.js; vehicle parts are defined in js/vehicles/components.js as
// COMPONENT_ITEMS (same shape) and merged into ITEMS by items.js.
ItemDef = {
  name, icon,                    // icon: emoji / short glyph for UI
  kind: "food"|"drink"|"med"|"tool"|"fluid"|"part"|"misc",
  mass, size: [x, y, z],         // kg, metres (prop collision box)
  price,                         // shop price, 0/undefined = not sold
  pocket: bool,                  // fits in a quick slot; otherwise it is carried in the hands / loaded as cargo
  cap, unit, fluid,              // containers: capacity, "L", and "fuel"|"oil"|"coolant"|"water"
  slot, fits,                    // parts: "engine"|"battery"|"radiator"|"wheel", fits: ["pickup","sedan"]
  use(ctx, item) -> string,      // optional; throw a string to refuse. Called for hand/pocket use.
  makeMesh(item) -> Object3D,    // origin at the centre of `size`
}
// Instance (plain JSON, saved as is)
ItemInstance = { id, type, qty?, cond?, flat?, ... }   // qty in def.unit, cond 0..100
```

Stable ids: seeded loot `"<siteId>:<n>"` (world agent), created in play `ws.newId()`.

Fixed item type ids (all agents may reference these):

- Supplies: `water` (0.5 L bottle), `waterjug` (4 L, qty), `beans`, `jerky`, `chips`, `soda`, `coffee`, `medkit`, `bandage`
- Fluids: `fuelcan` (10 L, qty), `jerrycan` (20 L, qty), `oil` (1 L bottle, qty), `oiljug` (4 L, qty), `coolant` (4 L jug, qty)
- Tools: `wrench` (needed to remove/install engine, battery, radiator), `jack` (jack + lug wrench, needed for wheels), `repairkit` (consumable, restores body/engine condition), `flashlight` (optional)
- Parts: `engine_i6` (fits pickup + sedan), `engine_v8` (pickup only), `engine_i4` (sedan only), `battery` (universal),
  `radiator` (universal), `wheel_16` (pickup), `wheel_14` (sedan)

Vehicle type ids: `pickup` (starter) and `sedan` (old four-door, recoverable).

## 5. Vehicles (vehicle agent provides)

```js
// js/vehicles/index.js
export async function prepare(report)            // build textures/geometry in slices; report(pct 0..1, label)
export class Vehicles {
  constructor({ root /* worldRoot */, getColliders /* (x, z, r) => static colliders */ })
  list                                            // loaded Vehicle[]
  get(id)
  spawnStarter(spawn /* {x, z, yaw} */) -> Vehicle  // worn but usable pickup, id "starter"
  // Loads/unloads vehicles: seeded spawns from loaded chunks (unless ws.vehicles has that id), plus ws.vehicles records
  // within range of any focus point. Unloading writes the record to ws.vehicles when the vehicle differs from its seed.
  sync(focusPoints /* Vector3[] */)
  step(dt, driven /* Vehicle|null */, input, env)  // fixed step: full physics for driven + moving vehicles, parked ones sleep
  update(dt, env)                                   // per frame: mesh sync, animations (doors, gauges, wheels)
  flush()                                           // write every loaded, modified vehicle to ws.vehicles (before saving)
  dispose()
}
// input: { throttle -1..1, steer -1..1, handbrake bool, shiftUp bool(edge), shiftDown bool(edge) }
// env:   { ambient °C, wet 0..1, sand 0..1, wear (difficulty multiplier), night bool }

Vehicle = {
  id, type, def,                       // def.name, def.tank, def.oilCap, def.coolantCap, def.mass …
  pos, quat, vel, speed,               // absolute; speed = signed forward m/s
  mesh,                                // Object3D under worldRoot
  slots: { engine, battery, radiator, wheelFL, wheelFR, wheelRL, wheelRR },   // ItemInstance | null
  fuel, oil, coolant,                  // litres
  doors: { driver, passenger, hood, tailgate /* or trunk */ },                // 0..1 open amount, animated
  cargo,                               // { items: [...] } secured cargo, see §7
  occupied,                            // set by main when the player is seated
  toggleIgnition(), setLights(mode), toggleParkingBrake(), setGearMode("auto"|"manual"), horn(bool),
  telemetry() -> Telemetry,            // one fresh object per call is fine
  inspect() -> [{ slot, label, item, cond, note }],   // for the component screen
  seatEye(out) -> Vector3,             // absolute eye position of the driver; cabQuat = vehicle quat
  camMotion,                           // { x, y, z, roll } small offsets (m, rad) from suspension + engine vibration
  exitSpots() -> [{x, z}],             // candidate standing spots, best first (driver door, passenger door, rear)
  colliders() -> Collider[],           // boxes with y0/y1 for player/props/other vehicles (closed doors only)
  placeOnRoad(z), recover(),           // un-stick helpers
  serialize() -> VehicleRecord, restore(record)
}

Telemetry = {
  speed, rpm, redline, gear /* "P","R","N","D","1".. */, gearMode, ignition /* "off"|"on"|"cranking"|"running" */,
  throttle, load /* 0..1 */, slip /* 0..1 */, surface, grounded,
  fuel, tank, temp, overheating, oil, oilCap, coolant, coolantCap, battery /* 0..100 */, charging,
  engineCond, bodyCond, tyres: [{ cond, flat, missing } ×4 FL FR RL RR],
  parkingBrake, lights /* bool */, odometer /* m */,
  warnings: [{ id: "fuel"|"temp"|"oil"|"coolant"|"battery"|"tyre"|"engine"|"body", level: "warn"|"crit", text }],
  impact /* crash severity since last telemetry call, for driver injury + camera shake */
}
```

Vehicle parts register their own interaction targets (§6): doors (open/close, “Get in”), hood, tailgate/trunk,
fuel filler (pour from held fuel container), oil filler + dipstick, radiator cap, each wheel (remove/install with `jack`),
engine / battery / radiator (remove/install with `wrench`, hood open), cargo bed/trunk floor (§7).
Removing a part puts the ItemInstance in the player's hands (`ctx.giveHeld`); installing consumes the held item
(`ctx.consumeHeld`) after checking `def.slot` and `def.fits`. A vehicle with a missing/dead engine, battery or wheel must
not drive; fitting good parts must restore it. Seeded recoverable vehicles spawn with deterministic defects.

## 6. Interaction (interaction agent provides the system; everyone registers targets)

One raycast from the camera each frame (`raycastTargets`). Whoever builds an interactive mesh registers it:

```js
addTarget(object3D, {
  id, name /* string | () => string */,
  info?: () => ({ cond?, qty?, note? }),      // shown under the name in the HUD
  reach?: 2.6,                                // metres
  item?: ItemInstance,                        // only for loose props
  actions: (ctx) => Action[],                 // only the actions that make sense right now
});
Action = {
  key: "use" | "alt" | "grab",                // E, F, left mouse
  label,                                      // "Open hood", "Pour fuel", "Remove wheel"
  blocked?: "Needs a jack",                   // shown but not runnable
  hold?: seconds,                             // timed action with a progress ring, then run()
  run?(ctx),                                  // instant / after hold
  tick?(ctx, dt) -> number | false,           // continuous while the key is held (pouring): return 0..1 progress, false to stop
}
ctx = {                                       // built by interact.js
  held,                                       // ItemInstance in the hands or null
  consumeHeld() -> ItemInstance,              // remove it from the game (installed / used up)
  giveHeld(item) -> bool,                     // put an instance in the hands; false when hands are full
  dropItem(item, pos, vel?),                  // spawn as a loose prop at an absolute position
  pocketAdd(item) -> bool,
  player,                                     // Player
  enterVehicle(vehicle),                      // main hook
  openShop(site), sleep(where), wallet /* { money } */,
  notify, sfx,
}
```

Static geometry that should block the ray (walls, vehicle bodies) is registered with `addOccluder`.
On dispose call `removeAllUnder(root)`.

Input ownership (interface agent's `input.js`; action names are the contract):

- Always: `pause` (Esc/P), `inventory` (Tab/I), `mute` (M), `radioNext` (N)
- Driving: `throttle`/`brake` (W/S), `left`/`right` (A/D), `handbrake` (Space, hold), `parkingBrake` (B), `ignition` (I is inventory → use `K`),
  `shiftUp`/`shiftDown` (Shift / Ctrl, manual mode), `gearMode` (G), `lights` (L), `horn` (H), `camera` (C), `exit` (F),
  `sleep` (Z), `recover` (R)
- On foot: `fwd/back/left/right` (WASD), `sprint` (Shift), `jump` (Space), `crouch` (Ctrl or C), `use` (E), `alt` (F),
  `grab` (LMB: pick up / drop held), `throw` (RMB), `rotate` (R held + mouse), `stow` (Q: held ↔ pocket), `slot1..slot6` (1–6),
  `consume` (X: use selected pocket item), `flashlight` (T)

Modes: `"drive" | "foot" | "overlay" | "none"`. Keys must not leak between modes; everything is released on blur,
pointer-lock loss and mode change.

## 7. Props and cargo (interaction agent)

- Every scavenged supply is a physical prop (mesh from `ItemDef.makeMesh`) under `worldRoot`, registered as a target.
- Loose props use a small custom body: gravity, ground = `heightAt`, static colliders, friction, sleep. No tunnelling,
  no falling through the world (clamp to ground), props never get deleted by physics.
- Carrying: one item in the hands, held in front of the camera, collides softly with the world, can be rotated, dropped, thrown.
- **Cargo securing** (deliberate, communicated in the HUD): aiming a held item at a vehicle's cargo target shows a ghost;
  placing it parents the prop to the vehicle (`vehicle.cargo`), where it rides without physics. Picking it up frees it.
  `vehicle.cargo = { zone: {min:[x,y,z], max:[x,y,z]} /* vehicle-local box */, items: [{ item, lpos:[x,y,z], lyaw }] }`
  The vehicle agent creates the zone and the cargo target (`target.cargoOf = vehicle`); the interaction agent owns the
  placement logic and the prop meshes parented to `vehicle.mesh`.
- Pockets (`pockets.js`): 6 quick slots for `pocket: true` items (stacks of identical stateless items, or one stateful item).

## 8. World (world agent provides)

```js
// js/world/terrain.js – pure math, importable in Node (no DOM, no THREE objects created at import)
setSeed(n), getSeed(), rng(seed), hashStr(str) -> uint32
CHUNK = 200, ROAD_HALF
roadX(z), roadY(z), roadDir(z) -> {x, z}
heightAt(x, z), normalAt(x, z, out)
surfaceAt(x, z) -> "asphalt"|"gravel"|"dirt"|"sand"|"rock"|"concrete"|"wood"   // grip, tyre noise, footsteps
onRoad(x, z), regionAt(x, z) -> { id, name }                                    // dunes, flats, rocky, …

// js/world/sites.js – deterministic points of interest
startSite() -> { id, kind, x, z, yaw, playerSpawn: {x, z, yaw}, vehicleSpawn: {x, z, yaw} }   // small garage/home near z≈60
sitesBetween(z0, z1) -> Site[]          // { id, kind: "station"|"home"|"garage"|"diner"|"motel"|"junkyard"|"wreck", x, z, yaw, name }
nextSiteAfter(z, kind?) -> Site

// js/world/index.js
export async function prepare(report)
export class World {
  constructor({ root /* worldRoot */ })
  setOptions({ lite, ahead, behind })     // render cost only – never changes placement, loot or colliders
  update(focusPoints /* Vector3[] */, force) // stream chunks around every focus point; emits chunk:load / chunk:unload
  collidersNear(x, z, radius, out = []) -> Collider[]   // static + door colliders
  chunks                                   // Map k → Chunk
  clear(), dispose()
}
Chunk = {
  k, z0, group, colliders,
  spawns: [{ id, type, qty?, cond?, pos: [x, y, z], yaw }],               // seeded loot (props agent instantiates)
  vehicleSpawns: [{ id, type, pos: [x, y, z], yaw, seed }],               // seeded recoverable vehicles
}
```

World-owned interactive things register their own targets and persist through `ws.flags`:
doors (`door:<id>`; a door is a box collider whose `solid` follows its state), containers/fridges/lockers/trunks
(their lid is a target and an occluder; contents are ordinary spawns placed inside), beds (`ctx.sleep`), shop counters
(`ctx.openShop(site)`), fuel pumps (hold E: fills the nearest parked vehicle's tank within 6 m or the held fuel container,
charging `ctx.wallet.money`). Decorative burnt-out wrecks are scenery; recoverable vehicles are `vehicleSpawns`.

`js/sky.js` (`Sky`: sun/moon light + shadows following the focus, sky dome, `scene.environment`, `time`, `night`, `clock()`)
and `js/weather.js` (`Weather`: clear / dusty / storm / rain, fog, particles, `ambient(time)`, `wet`, `p`, `label`,
`serialize/restore/advance`) keep their current public API; add `setQuality`.

## 9. Persistence (lead)

- Save key `longhaul-save-v3`. Older v2 saves are migrated (seed, day, needs, money, difficulty, distance; the truck is
  placed at the nearest safe road position). Corrupt saves are kept under a backup key and reported, never silently wiped.
- Save = `{ v, at, seed, time, day, diff, stats, needs, wallet, weather, player, interact (held + pockets), drivenId,
  world: ws.serialize(), prefs are separate }`.
- `ws` rules: a seeded prop that is picked up, moved, consumed or stowed gets its id added to `ws.removed`; wherever it
  now rests is a record in `ws.props`:
  `{ item, at: "world", pos, quat }` | `{ item, at: "cargo", vehicle, lpos, lyaw }`. Held/pocket items live in the
  interaction save. Props in unloaded chunks exist only as records; they are re-instantiated on `chunk:load`
  (records are matched to chunks by `Math.floor(pos[2] / CHUNK)`).
- Vehicles: `ws.vehicles` record = `vehicle.serialize()` (includes slots, fluids, cargo, pos/quat, doors, odometer).

## 10. HUD and menus (interface agent provides; main feeds real state)

```js
// js/ui/hud.js
hud.init({ prefs }), hud.applyPrefs(prefs), hud.setVisible(bool), hud.dim(bool)
hud.update({
  mode: "drive" | "foot",
  units: "km" | "mi",
  tel,                         // Telemetry or null (on foot)
  vehicleName,
  needs: { health, hunger, thirst, energy },      // 0..100
  stamina, sprinting,                             // 0..1
  day, clock, weather, tempC, money, trip /* m */,
  target: { name, cond, qty, note } | null,
  actions: [{ key: "E"|"F"|"LMB"|..., label, blocked, progress /* 0..1 | null */ }],
  held: { name, qty, hints: ["LMB drop", "RMB throw", …] } | null,
  cargoHint: string | null,                       // "Release to secure in the bed"
  slots: [{ icon, name, count, qty } | null ×6], selected,
  progress: { label, pct } | null,                // refuelling, repairs, timed actions
  lite, music: { title, artist } | null,
})
// Notifications arrive through bus "notify"; the HUD queues and prioritises them itself.

// js/ui/menus.js
menus.init({ prefs, handlers })     // handlers: onContinue(), onNewJourney({difficulty, seed}), onResume(), onSaveAndMenu(),
                                    // onPrefs(prefs) (called on every change), onReturnToHost(), onUseSlot(i), onDropSlot(i), onBuy(typeId)
menus.show(name, data)              // "loading" {pct,label} | "main" {save: preview|null, saveError, hostAvailable} | "pause" {summary}
                                    // | "gameover" {cause, stats} | "inventory" {slots, held, needs, vehicle: inspect()|null, stats}
                                    // | "shop" {site, stock:[{type, price}], money} | "sleep" {text}
menus.hide(), menus.current         // name or null
```

`prefs` (owned by `save.js`, persisted under `longhaul-prefs`):

```js
{ quality: "auto"|"high"|"lite", fov: 70, camMotion: 1, camera: "cab"|"chase", sens: 1, invertY: false,
  units: "km"|"mi", gearbox: "auto"|"manual",
  vol: { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.7 }, muted: false, radio: true,
  hud: { scale: 1, opacity: 1, show: "full"|"minimal"|"off", critical: true, help: true },
  a11y: { reduceMotion: false, highContrast: false } }
```

## 11. Audio (lead)

`audio.js` owns one AudioContext with buses master → music / sfx / ambience. Modules never touch WebAudio; they call
`sfx(name)` from the bus. Names: `ui_click, ui_back, door_open, door_close, hood_open, hood_close, pickup, drop, throw,
thud, pour_start, pour_stop, ratchet, wheel_fit, eat, drink, cash, container, footstep` (opts.surface), `land, error,
discover`. Engine, tyres, wind, rain and interior filtering are driven every frame from `Telemetry` by main.

## 12. Quality

`setOptions({ lite })` / `setQuality` may change pixel ratio, shadow resolution/distance, draw distance of *decorative*
instances, texture size and particle counts. It must not change terrain height, collider lists, spawns or sites.

## 13. Dev pages and tests

Each agent keeps a small harness page in `dev/` that exercises its modules in isolation (mock what you do not own) and
Node tests in `tests/` for pure logic. The game must stay loadable: never leave a module that throws at import.
