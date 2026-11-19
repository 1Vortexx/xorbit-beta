// Long Haul – player-facing changelog, newest first. Shown by the "What's New" screen (menus.js); CHANGELOG.md mirrors it.
// sections: [heading, [line, …]]
export const CHANGELOG = [
  {
    version: "2.5", name: "Meridian", date: "2026-11-16",
    sections: [
      ["New", [
        "The Meridian Deluxe: a 1950 two-door in showroom condition, with a hand-built 6.0 L V12. About one parked car in 500 turns out to be one. It's glossy black with chrome everywhere (bullet-nose grille, round headlamps, wrap-around bumpers with tall guards, side spears) and whitewall tyres with chrome hubcaps. Every part is new and every tank full. It does 0–100 km/h in about 4.5 seconds, tops out near 280 km/h, grips harder and turns tighter than anything else on the road. The V12 only fits the Meridian.",
        "Sleeping in a convoy works together: everyone on the road has to be asleep, in a cab or a bed, before the night skips ahead. Until then you lie awake with a count of who's asleep (\"1/3 asleep\"), and the sleep key or Esc gets you back up. When the last one lies down, everyone wakes up together after the same number of hours, set by whoever needed the longest sleep.",
        "Paused convoy members count as asleep, so nobody waits on them. They don't get the rest, though: when they come back, the clock has moved on but their energy is where they left it.",
        "A new loading screen: the menu music starts as the Long Haul logo appears, a loading bar fills under it with tips that change as you wait, then \"Press any key to start\" takes you straight to the main menu.",
        "Serious injuries: once your health drops below a quarter you can't stand any more and have to crawl, slowly and flat on the ground (convoy friends see you crawling too). You get back on your feet once you've healed past about a third.",
        "Falls hurt: a jump never does, dropping off a roof does, and a cliff can kill you.",
        "Bad crashes sound like it: a hard hit makes a bone-crunching impact the moment it happens, and if it kills you a heart monitor flatlines as the journey ends. Every death ends on the flatline over the game-over screen.",
        "Thrown through the windscreen: a really hard head-on crash (about 125 km/h or more into something solid) cracks the windscreen and throws you out over the hood. The camera pulls out of the cab to follow you as you tumble through the air, hit the ground, bounce, roll and slide to a stop, slamming into anything in the way. If you survive, you get up (or crawl) from where you landed. If the crash killed you, the heart monitor flatlines and the journey ends only once you've come to rest.",
      ]],
      ["Changed", [
        "Convoy drivers share one clock: the time of day and the weather are the same on every screen, all the time, not just when you join.",
        "The old start screen (the logo on the left with \"Click or press any key to start\") is gone.",
        "Hard crashes are dangerous: anything past about 70 km/h into something solid hurts badly. Around 100 km/h takes nearly half your health, 130 km/h leaves you barely alive and crawling, and 150 km/h or more is fatal.",
        "A crash at 100 km/h or more wrecks the vehicle: the engine is destroyed and stops, and a head-on hit smashes the radiator too. Swap the engine to get it going again.",
      ]],
      ["Fixed", [
        "When a convoy friend got out of their truck, it vanished from everyone else's screen. It now stays parked where they left it, and you can't drive through it.",
        "Convoy friends' clocks and weather drifted apart after joining: pausing, sleeping and the weather changing at random put everyone at a different time of day.",
        "You couldn't die: health crept back up the moment it hit zero, before the game checked for death. A fatal crash, beating, stabbing or thirst now ends the journey.",
      ]],
    ],
  },
  {
    version: "2.4", name: "Convoy", date: "2026-11-15",
    sections: [
      ["New", [
        "Career & Achievements: lifetime totals across every journey (distance driven, journeys, days on the road, places found, fuel bought, pursuits escaped, passengers delivered, time played) and 18 achievements to unlock.",
        "X-ORBIT accounts: when you're signed in (Account on the main menu), your journeys and achievements are saved to your account and add up across every device you play on. Signed out, your career stays on this browser.",
        "Account screen (main menu): sign in to any X-ORBIT account with its username or email and password, or sign out. Long Haul only uses an account signed in here, never your X-ORBIT sign-in, and doesn't change it. Each account keeps its own career and achievements.",
        "Global leaderboard: compete with other X-ORBIT players for the longest journey, the most total distance and the most days survived. Your journey is added as you drive.",
        "Convoys (multiplayer): drive the same road with up to 5 friends. Start a convoy from the pause menu and share its 5-letter code; friends join from the main menu and start right behind you. You see each other's vehicles, name tags and how far ahead or behind everyone is. Supplies, loot, strangers and damage stay your own.",
        "Cloud saves: when you're signed in, your journey is saved to your account and picks up on any device. If the account holds a newer or different journey than this device, the main menu offers it.",
        "You have a body: a driver at the wheel who turns it with the steering, seen in chase view and photo mode (from the cab, everything but the head). On foot it shows up in photo mode.",
        "Convoy drivers sit in their trucks instead of driving empty ones, and walk around as people on foot.",
        "Convoy trucks are solid: you can bump, shunt and crash into each other's trucks, and you can't walk through each other any more.",
        "Ride along: walk up to a convoy friend's truck and press E to ride in a free seat. You see the road from the passenger seat (C switches to chase view), they see you sitting next to them, and F gets you out once they've stopped. Your own truck stays where you left it.",
        "Convoy voice chat: turn voice on in the Convoy screen to talk to everyone else in the convoy who has it on. Open mic or push to talk (hold V). Mute your mic, set the volume in Settings › Audio, and see who's talking: their name tag turns green with a speaker over their truck, their row lights up in the convoy panel, and a bar there shows when you're being heard. Players who can't connect directly are put through the X-ORBIT voice relay.",
        "Chase camera zoom: the mouse wheel (or + and −) moves the chase camera closer or further back while you drive or ride. It's remembered, and also in Settings › Camera.",
        "Taking damage flashes the edges of the screen red: a scrape barely flickers, a beating or a bad crash glares.",
        "Pausing no longer drops you from a convoy: you stay where you stopped, and a pause sign shows next to your name for everyone else until you carry on.",
        "Maps: a minimap in the top-left corner, and the full map on M (drag to move, wheel to zoom, C to centre). They only show the road you've actually driven, your off-road tracks and the places you've discovered, so nobody gets a head start.",
        "The Digimap (sold at fuel stations, $65): carry it and your map shows the road ahead and the next open fuel, garage, diner and motel. The catch: while you carry it, far fewer of those places ahead are still open. Most turn out to have closed down long ago, leaving only their slab. Drop it and they come back to normal.",
        "Convoy drivers show up on the minimap and the map, with a pause sign when they've paused.",
        "The maps show the ground in its real colours (sand, scrub, rock) along everywhere you've been. The rest stays dark, and with a Digimap the road ahead is half-revealed.",
        "Engine trouble you can see: a failing engine smokes from under the hood, thicker as it gets worse, and an overheating one puffs steam. When an engine finally blows there's a low bang, a burst of black smoke, and it shuts off and smoulders for a while.",
        "A rare menu track: about 1 time in 50, the title screen plays \"Get Me Out Of Here (Demo Ver.)\" by Michael Lester instead of a Jaobi song.",
      ]],
      ["Changed", [
        "A tidier main menu: Play, Career, Settings and What's New, with Account and Credits underneath. Play holds Continue, Singleplayer, Convoy and Controls / How to Play. Career shows your stats and achievements beside the global leaderboard.",
        "M now opens the map. Muting all sound has moved to Settings › Audio only.",
      ]],
      ["Fixed", [
        "The flashlight pointed backwards when held in your hands: its lit lens shone straight at you as a big white disc. It now points where you look, and the beam starts just past the lens.",
        "The flashlight's beam stayed behind, floating where you got into a vehicle. It's now put away while you drive or ride, and comes back on when you get out.",
        "The flashlight was very dim. It's now about four times brighter, with a wider, longer beam.",
        "Topping up engine oil actually works. The oil filler cap is now bright yellow and easier to aim at. The prompt says to hold the key. Oil pours twice as fast (about 2 seconds a litre). It pours straight from a bottle in your pockets if your hands are empty. And the dipstick has \"Hold to add oil\" next to \"Check oil\".",
      ]],
    ],
  },
  {
    version: "2.3.1", date: "2026-11-15",
    sections: [
      ["New", [
        "Crash damage you can see: panels dent and crumple where you hit, paint scrapes back to bare metal, a hard front hit or a roll cracks the windscreen, and sparks and debris fly off the impact. Dents deepen with repeated hits, stay with the vehicle when you save, and a repair kit straightens them out.",
        "Crash sounds: sheet metal crunching as panels fold, a grinding screech when you scrape along something, the windscreen cracking and debris pattering down. Bullets now land with a thud in the dirt, a ricochet off walls and vehicles, or a hit on a person.",
        "Crash physics: a blow now pitches and rolls the vehicle as well as spinning it, and scraping along a wall or another car drags speed off with a shower of sparks.",
      ]],
      ["Changed", [
        "The Brazos (and the Poopmobile) has a more true-to-life body: rounded front corners, a sculpted shoulder crease, a rolled-under rocker, proper fender cut-outs over the wheels with a rolled edge, a crowned hood and roof and a more raked windscreen.",
        "Guns are held up and aimed where you look, kick back when they fire, and every shot shows a muzzle flash, a tracer and a puff of dust (or blood) where the round lands. The knife jabs forward when you stab.",
        "Number keys 1–6 now take that pocket's item straight into your hands (they used to only select the pocket). Press the same key again to put it away, or another to swap; what you were holding goes back to its pocket.",
        "The menu music is credited to its artist, Jaobi, on the Credits screen and in the now-playing line.",
        "The Credits screen lists the people behind the game: 1Vortexx (creator and developer) and contributors Michael Lester, ZeeAnimate and $GlitzerX$.",
      ]],
      ["Fixed", [
        "Guns gave no sign of firing: they were carried like any loose object and nothing came out of the barrel.",
        "Bullets passed through the ground. Rounds now stop at hills and the road as well as at walls and vehicles.",
        "The wheel arches were filled in, leaving the tyres tucked under flat slab sides. They are open now.",
        "Loading the truck bed only worked when looking almost straight down into it. Aim anywhere over the bed, over a side rail or at the closed tailgate to secure what you're holding; things already in the bed can still be picked out.",
      ]],
    ],
  },
  {
    version: "2.3", name: "Self-Defence", date: "2026-11-15",
    sections: [
      ["New", [
        "You leave home with a hunting knife in your pocket. Take it in hand (Q) and press LMB to stab; three good stabs put someone down.",
        "Handgun (9mm, 15 rounds) and AK-47 (7.62, 30 rounds, fully automatic). Hold one and press LMB to fire (hold it for the AK), R to reload. Walls, buildings and vehicles stop bullets.",
        "9mm and 7.62 ammo boxes. Reloading takes rounds from boxes in your pockets or lying within reach.",
        "Guns turn up rarely: about one start house in three keeps a handgun on the kitchen table, a few hide an AK-47 in the garage, and both show up in homes, garages, motels, diners, junkyards and wrecks along the road. Ammo boxes are more common and appear on their own.",
        "Big-block V8: the engine in roadblock pursuit cars. Wreck one and it's yours to strip.",
      ]],
      ["Changed", [
        "Roadblock pursuit cars now run a big-block V8, so they are much quicker than a stock Brazos (about 190 km/h flat out against your 154). Lose them in the bends or wreck them.",
        "Hitchhikers turn on you more often, and some don't want your money: they pull a knife while you drive and keep stabbing until you stop and get out, fight back (E), or get away. Once you're out, they come after you on foot.",
        "When a passenger threatens you, you can fight back with your knife or pull a gun instead of paying.",
        "People who are hostile now visibly carry a knife.",
      ]],
    ],
  },
  {
    version: "2.2", name: "Photo Op", date: "2026-11-15",
    sections: [
      ["New", [
        "Photo mode: press P while playing. The world freezes, the HUD hides and the camera flies free (WASD, Space / Q up and down, Shift faster, mouse wheel zoom).",
        "In photo mode, click or press Enter to save a clean screenshot as a PNG to your downloads, and press M to release or recapture the mouse.",
        "The Poopmobile: a red-and-white 1969 farm pickup whose paint, chipped bed, rusty bumpers and P O O P tailgate come from photos of a real truck. One journey in a thousand starts with it instead of the Brazos (try world seed 276).",
        "This What's New screen.",
      ]],
      ["Changed", [
        "Jacks turn up far more often: tool loot favours them, abandoned homes and repair shops often have one lying around, and recoverable cars frequently have a jack left by the driver's door.",
        "There is a good chance of a spare jack on the driveway next to your starting truck.",
        "P no longer opens the pause menu (Esc still does).",
      ]],
    ],
  },
  {
    version: "2.1", name: "Strangers", date: "2026-11-15",
    sections: [
      ["New", [
        "People on the road: walking, animated strangers with collision who can sit in vehicle seats.",
        "Hitchhikers: pick them up, talk to them, drive them to where they are going for a fare, or tell them to get out. Some are not what they seem.",
        "Roadblocks: armed checkpoints that either demand a toll or try to rob you. Pay, refuse, ram through or go around off-road – and live with the outcome.",
        "Pursuits: other drivers using the same vehicle physics chase you down after you run a roadblock; they can crash, be disabled and break through barricades.",
        "Dialogue panel, subtitles, a Talk key (E) and encounter sounds that fade with distance.",
        "New Journey option to turn hostile strangers off.",
      ]],
      ["Changed", [
        "Encounters are placed along the road from the world seed, so the same seed always meets the same strangers.",
        "Tolls and robberies take cash and supplies from your pockets, hands and secured cargo all at once, or not at all.",
        "Saves move to version 4; older journeys load unchanged.",
      ]],
    ],
  },
  {
    version: "2.0.1", name: "Tune-up", date: "2026-11-14",
    sections: [
      ["New", [
        "Menu music: three original tracks by Jaobi play on the title screen, with a now-playing label.",
        "Sound effects for doors, the ignition, switches, the parking brake and more.",
      ]],
      ["Fixed", [
        "The chase camera aimed the wrong way far from the start, leaving the vehicle out of frame.",
        "The now-playing label no longer lingers over the game after you start a journey.",
        "Hint notifications showed their icon twice.",
        "The windscreen was too dusty to see through comfortably.",
      ]],
    ],
  },
  {
    version: "2.0", name: "The Long Road", date: "2026-11-13",
    sections: [
      ["New", [
        "Rebuilt from the ground up as a semi-realistic 3D desert road-trip survival sandbox.",
        "An endless seeded desert road with homes, gas stations, garages, diners, motels, junkyards and roadside wrecks to explore and loot.",
        "Day and night, heat, rain and dust storms.",
        "A worn 1978 Brazos pickup with real suspension, a gearbox (automatic or manual), fuel, oil, coolant, battery and wear – and a recoverable old sedan to find.",
        "Engines, batteries, radiators and wheels you can remove and fit by hand with a wrench and a jack. A missing or dead part stops the truck.",
        "Walk, sprint, crouch and jump. Pick up, carry, throw and rotate anything loose; six pockets; secure cargo in the truck bed.",
        "Hunger, thirst, energy and health; sleep in a bed or the cab.",
        "Shops and fuel pumps that take your cash.",
        "Main menu, New Journey with difficulty and seed, pause, settings (graphics, camera, controls, HUD, audio, accessibility), inventory and game over.",
        "Lite mode for slower computers, and saves that keep everything where you left it.",
      ]],
    ],
  },
  {
    version: "1.0", date: "2026-10-27",
    sections: [
      ["New", ["Long Haul arrives in X-ORBIT."]],
    ],
  },
];
