# Pushing a Beta Build to Public

## Overview
This guide covers how to take a tested beta build from `xorbit-beta` and push it to the public `X-ORBIT-Desktop` repo as a stable release.

---

## Pre-Push Checklist

- [ ] All features tested and working in beta
- [ ] No console errors in browser dev tools
- [ ] Update badge / version check working correctly
- [ ] Changelog entries written for the new version
- [ ] `update_check` table in Supabase updated with the new stable version

---

## Step 1: Disable Beta Flag

In `app.html`, find the version constants block and flip the flag:

```js
// CHANGE THIS:
const IS_BETA_BUILD = true;

// TO THIS:
const IS_BETA_BUILD = false;
```

When `IS_BETA_BUILD` is `false`:
- `CURRENT_VERSION` falls back to the stable version string (e.g. `"v6.0.1"`)
- `CURRENT_VERSION_NAME` uses the stable name (e.g. `"X-ORBIT Desktop v6.0.1 Sahara"`)
- `UPDATE_CHECK_TABLE` points to `"update_check"` instead of `"update_check_beta"`
- Dev Tools section is excluded from Settings
- BETA badge is hidden from the menu bar
- Console log interception is disabled

## Step 2: Update Version Numbers

Update the stable version values to match the new release:

```js
const CURRENT_VERSION = IS_BETA_BUILD ? "v6.1.2-beta" : "v7.0.0";  // <-- update stable value
const CURRENT_VERSION_NAME = IS_BETA_BUILD ? "X-ORBIT Desktop v6.1.2 Beta" : "X-ORBIT Desktop v7.0.0 Nova";  // <-- update stable value
```

Then find and update all hardcoded version strings in the HTML:
- Settings > Software Update "up to date" subtitle
- Settings > About hero badge
- Settings > About info grid version card
- Settings > About info grid build card
- Menu bar update check (`checkForUpdates()` up-to-date state)

**Quick find:** Search for the old version string (e.g. `v6.0.1`) and replace with the new one. Skip the `IS_BETA_BUILD` ternary lines — those are handled by the constants.

## Step 3: Update the What's New Changelog

Add a new entry at the top of `WHATSNEW_CHANGELOG` in `app.html`:

```js
const WHATSNEW_CHANGELOG = [
  {
    version: "v7.0.0",       // must match CURRENT_VERSION stable value
    name: "Nova",
    date: "October 1, 2026",
    sections: [
      { type: "added", items: [
        "Feature one",
        "Feature two"
      ]},
      { type: "changed", items: [
        "Change one"
      ]},
      { type: "fixed", items: [
        "Bug fix one"
      ]}
    ]
  },
  // ... existing entries
];
```

## Step 4: Update `changelogs.html`

Add the new version entry at the top of the changelog page with the `badge-current` class. Change the previous "Current" badge to `badge-patch`, `badge-minor`, or `badge-major` as appropriate.

## Step 5: Update Supabase `update_check` Table

Run this SQL (or update via Supabase dashboard):

```sql
UPDATE update_check
SET version = 'v7.0.0',
    version_name = 'X-ORBIT Desktop v7.0.0 Nova',
    update_size = '14.2 MB'
WHERE id = (SELECT id FROM update_check LIMIT 1);
```

This ensures all existing public users see the update banner on their next login.

## Step 6: Commit and Push to Public Repo

```bash
cd /Users/demitriburns/Documents/xorbit/xorbit-beta

# Point remote to the public repo
git remote set-url origin https://github.com/1Vortexx/X-ORBIT-Desktop.git

# Stage and commit
git add app.html changelogs.html
git commit -m "v7.0.0 Nova: <summary of changes>"

# Push
git push origin main

# Point remote back to beta after pushing
git remote set-url origin https://github.com/1Vortexx/xorbit-beta.git
```

**Alternative:** Copy the changed files into `xorbit-main` and push from there instead of swapping remotes:

```bash
cp /Users/demitriburns/Documents/xorbit/xorbit-beta/app.html /Users/demitriburns/Documents/xorbit/xorbit-main/app.html
cp /Users/demitriburns/Documents/xorbit/xorbit-beta/changelogs.html /Users/demitriburns/Documents/xorbit/xorbit-main/changelogs.html
# Copy any new files (e.g. magma.html)

cd /Users/demitriburns/Documents/xorbit/xorbit-main
git add -A
git commit -m "v7.0.0 Nova: <summary>"
git push origin main
```

## Step 7: Re-enable Beta for Next Cycle

Back in `xorbit-beta/app.html`, flip the flag back and bump the beta version:

```js
const IS_BETA_BUILD = true;
const CURRENT_VERSION = IS_BETA_BUILD ? "v7.0.1-beta" : "v7.0.0";
const CURRENT_VERSION_NAME = IS_BETA_BUILD ? "X-ORBIT Desktop v7.0.1 Beta" : "X-ORBIT Desktop v7.0.0 Nova";
```

Commit and push to the beta repo.

---

## Quick Reference

| Item | Stable | Beta |
|------|--------|------|
| `IS_BETA_BUILD` | `false` | `true` |
| Version format | `v7.0.0` | `v7.0.1-beta` |
| Update table | `update_check` | `update_check_beta` |
| Dev Tools | Hidden | Visible in Settings |
| Menu bar badge | None | Orange "BETA" |
| Console capture | Off | On |
| Repo | `1Vortexx/X-ORBIT-Desktop` | `1Vortexx/xorbit-beta` |

---

## Remotes Cheat Sheet

```bash
# Check current remote
git remote -v

# Switch to public
git remote set-url origin https://github.com/1Vortexx/X-ORBIT-Desktop.git

# Switch to beta
git remote set-url origin https://github.com/1Vortexx/xorbit-beta.git
```
