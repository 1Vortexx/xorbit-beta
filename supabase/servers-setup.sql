-- ══════════════════════════════════════════════════════
-- JITTERY SERVERS — Supabase table setup
-- Run this in the Supabase SQL editor
-- ══════════════════════════════════════════════════════

-- Servers
CREATE TABLE IF NOT EXISTS servers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    icon_url TEXT,
    owner_email TEXT NOT NULL,
    invite_code TEXT UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Server roles (position 0 = lowest)
CREATE TABLE IF NOT EXISTS server_roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4f8aff',
    permissions JSONB DEFAULT '{"manage_channels":false,"manage_roles":false,"kick_members":false,"ban_members":false,"manage_server":false,"send_messages":true,"admin":false}'::jsonb,
    position INT DEFAULT 0,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Server members
CREATE TABLE IF NOT EXISTS server_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
    user_email TEXT NOT NULL,
    role_id UUID REFERENCES server_roles(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(server_id, user_email)
);

-- Server channels
CREATE TABLE IF NOT EXISTS server_channels (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    topic TEXT DEFAULT '',
    position INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Server messages
CREATE TABLE IF NOT EXISTS server_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    channel_id UUID REFERENCES server_channels(id) ON DELETE CASCADE NOT NULL,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
    sender_email TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    message TEXT NOT NULL,
    reply_to_id UUID,
    reply_to_sender_name TEXT,
    reply_to_preview TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Server bans
CREATE TABLE IF NOT EXISTS server_bans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
    user_email TEXT NOT NULL,
    banned_by TEXT NOT NULL,
    reason TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(server_id, user_email)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_server_members_email ON server_members(user_email);
CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members(server_id);
CREATE INDEX IF NOT EXISTS idx_server_channels_server ON server_channels(server_id);
CREATE INDEX IF NOT EXISTS idx_server_messages_channel ON server_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_server_messages_created ON server_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_server_roles_server ON server_roles(server_id);
CREATE INDEX IF NOT EXISTS idx_server_bans_server ON server_bans(server_id);
CREATE INDEX IF NOT EXISTS idx_server_bans_email ON server_bans(user_email);
