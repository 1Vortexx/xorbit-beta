// Long Haul – player-facing changelog, newest first. Shown by the "What's New" screen (menus.js); CHANGELOG.md mirrors it.
// sections: [heading, [line, …]]
export const CHANGELOG = [
  {
    version: "2.3.1", date: "2026-11-15",
    sections: [
      ["Changed", [
        "The menu music is credited to its artist, Jaobi, on the Credits screen and in the now-playing line.",
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
