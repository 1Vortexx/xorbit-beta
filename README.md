# X-ORBIT Desktop — Project Reference

## What It Is

A browser-based desktop operating system built entirely in HTML, CSS, and JavaScript.
Live at: **https://beta.xorbit.org**

Features:
- Full windowed desktop environment with resizable/draggable windows, dock, and menu bar
- macOS Catalina-style login screen powered by Supabase auth with login attempt logging
- Built-in proxy browser (Orbix engine on Ultraviolet + Rammerhead backend)
- Spotify music player, Minecraft (Eaglercraft), Jitter.video, and direct messaging
- In-OS notification center, terminal emulator, changelogs viewer, and admin dashboard
- Live alert system (downtime, maintenance, info) fetched from Supabase and shown on login
- PWA support — installable as a standalone desktop or mobile app via Web App Manifest

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Auth & Database | Supabase (PostgreSQL) |
| Proxy | Ultraviolet (Orbix engine) + Rammerhead |
| Email notifications | Resend API (via Supabase Edge Functions / Deno) |
| Icons | Font Awesome 6 |
| Fonts | Inter (Google Fonts) |
| PWA | Web App Manifest (`manifest.json`) + Service Worker (`sw.js`) |
| Hosting | Custom domain — `xorbit.org` |

---

## Environment Variables

### Client-side (set directly in HTML/JS files)

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

### Supabase Edge Functions

Required secrets set in the Supabase dashboard under Project Settings → Edge Functions:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=        # optional — defaults to: X-ORBIT <noreply@updates.xorbit.org>
APP_URL=                  # optional — defaults to: https://xorbit.org/jittery.html
```

The service role key is used only inside Edge Functions (server-side). It is never exposed client-side.

---

## Project Structure

```
xorbit-beta/
├── index.html                  # Landing/marketing page
├── auth.html                   # Login screen (Supabase auth, macOS-style UI)
├── browser.html                # In-OS proxy browser (Orbix + Rammerhead)
├── terminal.html               # Web-based terminal emulator
├── account.html                # Account settings and profile page
├── support.html                # Support portal / early access signup
├── notifications.html          # Notification feed
├── notification-center.html    # In-OS notification center app
├── changelogs.html             # Release notes viewer
├── render.html                 # Render page
├── uv-render.html              # Ultraviolet render page
├── build-info.html             # Build metadata display
├── spotify-player.html         # Spotify music app
├── X-MUSIC.html                # X-MUSIC player
├── minecraft.html              # Minecraft (Eaglercraft) embed
├── jittery.html                # Jitter.video client
├── studios.html                # X-ORBIT Studios hub
├── cipher.html                 # Cipher tool
├── cipher.js                   # Cipher logic
├── blockblast.html             # Block Blast game
├── doom.html                   # Doom embed
├── blocked.html                # Blocked/access denied page
├── timeout.html                # Session timeout page
├── error.html                  # Error page
├── the-interval.html           # The Interval page
├── privacy-policy.html         # Privacy policy
├── tos.html                    # Terms of service
├── index-backup.html           # Landing page backup
│
├── admin/
│   ├── dashboard.html          # Admin dashboard — alerts, users, system status
│   └── logs.html               # Login attempt logs viewer
│
├── status/
│   └── status.html             # Live service status page
│
├── blog/
│   └── yearly-shutdown.html    # Blog post — yearly shutdown notice
│
├── supabase/
│   └── functions/
│       ├── notify-new-message/ # Edge Function — sends DM email notifications via Resend
│       └── send-welcome-email/ # Edge Function — sends welcome email on account creation
│
├── theme-minimalist.css        # Minimalist theme stylesheet
├── theme-orange.css            # Orange theme stylesheet
├── manifest.json               # PWA manifest (name, icons, theme color #7850ff)
├── sw.js                       # Service worker — minimal install-prompt enabler
├── .gitattributes
└── service_components_rows.sql # Seed data for the service_components Supabase table
```

---

## Database Schema

Supabase is used for auth, direct messaging, alerts, and service status. Key tables:

### `service_components`
Tracks live status of system components displayed on the status page.

```sql
id                  uuid (PK)
component_id        text        -- e.g. 'proxy-ultraviolet', 'auth-login'
component_name      text        -- Display name, e.g. 'Orbix'
component_description text
parent_service_id   text        -- Groups components: 'proxy-browser', 'authentication', 'database', 'api-services'
status              text        -- 'operational' | 'degraded' | 'outage'
issue_description   text
priority            int
created_at          timestamptz
updated_at          timestamptz
```

Seed data is in `service_components_rows.sql` — run in Supabase SQL editor to populate.

### Other tables (managed via Supabase dashboard)
- `dm_conversations` — direct message threads (`participant_1_email`, `participant_2_email`, `is_group`, `group_name`, `participants`)
- User auth is handled natively by Supabase Auth

---

## Design System

| Token | Value |
|---|---|
| Background | `#000000` |
| Background raised | `#080808` |
| Background card | `#0a0a0a` |
| Border | `rgba(255, 255, 255, 0.08)` |
| Border highlight | `rgba(255, 255, 255, 0.14)` |
| Text primary | `#ffffff` |
| Text secondary | `rgba(255, 255, 255, 0.45)` |
| Text muted | `rgba(255, 255, 255, 0.18)` |
| Accent green | `#22c55e` |
| Accent purple | `#7c6af7` |
| PWA theme color | `#7850ff` |

Themes are swappable via external CSS files (`theme-minimalist.css`, `theme-orange.css`).

---

## Hosting

| Detail | Value |
|---|---|
| Domain | `xorbit.org` |
| Live app | `https://xorbit.org` |
| Admin | `https://xorbit.org/admin/dashboard` |
| Status page | `https://xorbit.org/status/status.html` |
| Support portal | `https://xorbit.org/support` |
| Edge Functions | Deployed via Supabase CLI |

---

## Releases

| Version | Codename | Status | Date |
|---|---|---|---|
| 5.1.0 | Nova | Stable | Apr 2026 |
| 5.0.1B | Ventas | Beta | Feb 2026 |
| 4.6.1 | Astra | Stable | Feb 2026 |

---

## Deploying Edge Functions

Supabase Edge Functions are located in `supabase/functions/`. To deploy:

```bash
# Deploy a single function
supabase functions deploy notify-new-message
supabase functions deploy send-welcome-email

# Set secrets
supabase secrets set RESEND_API_KEY=your_key
supabase secrets set RESEND_FROM_EMAIL="X-ORBIT <noreply@updates.xorbit.org>"
supabase secrets set APP_URL=https://xorbit.org/jittery.html
```

The `notify-new-message` function is triggered by a Supabase database webhook on `INSERT` to the DM messages table. Configure the webhook in Supabase under Database → Webhooks.

---

## Access

X-ORBIT is account-gated. Access is by application while in early access:

1. Visit the [Support Portal](https://xorbit.org/support)
2. Register for an Account Services account
3. Submit a ticket requesting X-ORBIT access
4. Receive credentials via email
