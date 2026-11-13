# Long Haul soundtrack

The game ships with no music. It plays ambient sound and reports an empty playlist until you add tracks here.

## Adding tracks

1. Copy your audio files into this folder (`longhaul/audio/music/`). Subfolders are fine.
   Supported: `.mp3`, `.ogg`, `.opus`, `.m4a`, `.aac`, `.wav`, `.flac` (whatever the player's browser can decode –
   `.mp3` and `.m4a` work everywhere).
2. List them in `manifest.json`:

```json
{
  "menu": [
    { "file": "menu-theme.mp3", "title": "Dust and Daylight", "artist": "Your Name", "license": "Used with permission" }
  ],
  "radio": [
    { "file": "radio/track-01.mp3", "title": "Mile 40", "artist": "Your Name", "license": "CC BY 4.0" },
    { "file": "radio/track-02.mp3", "title": "Heat Shimmer", "artist": "Your Name" }
  ],
  "options": { "menuOrder": "sequence", "radioOrder": "shuffle", "loop": true }
}
```

- `menu` plays on the title screen and menus. `radio` plays while you sit in a vehicle with the ignition on and the
  radio switched on (Settings › Audio, or press N for the next track).
- `title`, `artist` and `license` are optional. They appear in the now-playing line and on the Credits screen.
- `menuOrder` / `radioOrder`: `"sequence"` or `"shuffle"`. `loop: false` stops a single-track list after one play.
- Only local files are accepted; web addresses are ignored on purpose.

No game code needs to change. A file that is missing or cannot be decoded is skipped, and the reason is listed under
Settings › Audio.
