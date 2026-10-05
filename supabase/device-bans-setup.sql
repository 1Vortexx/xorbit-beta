-- ══════════════════════════════════════════════════════
-- DEVICE BANS + PUBLIC ACCESS — Supabase table setup
-- Run this in the Supabase SQL editor
-- ══════════════════════════════════════════════════════

-- Banned device UUIDs (the 6-character code stored as xorbit_device_uuid)
CREATE TABLE IF NOT EXISTS banned_devices (
    device_uuid TEXT PRIMARY KEY,
    reason TEXT,
    banned_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Single-row settings table.
--   public_access = false → devices that have no UUID yet are treated the
--                           same as a banned device.
--   lockout = true        → the entire X-ORBIT site is disabled for everyone.
--   deface = true         → index.html redirects to landing.html, a decoy
--                           graphing calculator site.
CREATE TABLE IF NOT EXISTS access_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    public_access BOOLEAN NOT NULL DEFAULT true,
    lockout BOOLEAN NOT NULL DEFAULT false,
    deface BOOLEAN NOT NULL DEFAULT false,
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- For projects where access_settings was created before these flags existed
ALTER TABLE access_settings ADD COLUMN IF NOT EXISTS lockout BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE access_settings ADD COLUMN IF NOT EXISTS deface BOOLEAN NOT NULL DEFAULT false;

INSERT INTO access_settings (id, public_access)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read (index.html / app.html check with the anon key);
-- only signed-in admins (Supabase Auth) can change anything.
ALTER TABLE banned_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banned_devices read" ON banned_devices
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "banned_devices admin write" ON banned_devices
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "access_settings read" ON access_settings
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "access_settings admin write" ON access_settings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
