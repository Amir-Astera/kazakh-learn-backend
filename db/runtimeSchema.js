const pool = require('../config/db');

async function ensurePostgresRuntimeSchema() {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE');
  await pool.query('ALTER TABLE units ADD COLUMN IF NOT EXISTS path_image_url VARCHAR(500)');
  await pool.query('ALTER TABLE units ADD COLUMN IF NOT EXISTS path_points JSONB');
  await pool.query('ALTER TABLE units ADD COLUMN IF NOT EXISTS landmark_position JSONB');
  await pool.query('ALTER TABLE user_lesson_progress ADD COLUMN IF NOT EXISTS xp_earned INTEGER DEFAULT 0');
  await pool.query('ALTER TABLE landmarks DROP CONSTRAINT IF EXISTS landmarks_unit_id_key');
  await pool.query('ALTER TABLE landmarks ADD COLUMN IF NOT EXISTS position JSONB');
}

module.exports = {
  ensurePostgresRuntimeSchema,
};
