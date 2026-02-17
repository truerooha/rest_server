ALTER TABLE buildings ADD COLUMN invite_code TEXT;
ALTER TABLE buildings ADD COLUMN invite_code_active INTEGER DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_buildings_invite_code ON buildings(invite_code);
ALTER TABLE users ADD COLUMN is_approved INTEGER DEFAULT 0;
UPDATE users SET is_approved = 1 WHERE building_id IS NOT NULL
