-- Kazakh Learn Database Schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  avatar_url VARCHAR(500),
  xp INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  last_activity DATE,
  current_level_id INTEGER,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS levels (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  order_num INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  level_id INTEGER REFERENCES levels(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  title_kz VARCHAR(200),
  description TEXT,
  order_num INTEGER NOT NULL,
  required_xp INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS units (
  id SERIAL PRIMARY KEY,
  module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  title_kz VARCHAR(200),
  subtitle VARCHAR(300),
  icon VARCHAR(50) DEFAULT 'book',
  path_image_url VARCHAR(500),
  path_points JSONB,
  landmark_position JSONB,
  lesson_count INTEGER DEFAULT 0,
  order_num INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  unit_id INTEGER REFERENCES units(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL,
  xp_reward INTEGER DEFAULT 10,
  order_num INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  question TEXT NOT NULL,
  question_audio VARCHAR(500),
  options JSONB,
  correct_answer TEXT NOT NULL,
  explanation TEXT,
  order_num INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'locked',
  completed_lessons INTEGER DEFAULT 0,
  stars INTEGER DEFAULT 0,
  UNIQUE(user_id, unit_id)
);

CREATE TABLE IF NOT EXISTS user_lesson_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  completed BOOLEAN DEFAULT FALSE,
  score INTEGER DEFAULT 0,
  mistakes INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  time_spent INTEGER DEFAULT 0,
  completed_at TIMESTAMP,
  UNIQUE(user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS user_skills (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  skill_name VARCHAR(50) NOT NULL,
  progress INTEGER DEFAULT 0,
  UNIQUE(user_id, skill_name)
);

CREATE TABLE IF NOT EXISTS user_quests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  quest_name VARCHAR(200) NOT NULL,
  quest_type VARCHAR(50) NOT NULL,
  target INTEGER NOT NULL,
  current INTEGER DEFAULT 0,
  xp_reward INTEGER DEFAULT 15,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS landmarks (
  id SERIAL PRIMARY KEY,
  unit_id INTEGER REFERENCES units(id) ON DELETE CASCADE,
  image_url VARCHAR(500) NOT NULL,
  alt_text VARCHAR(300) NOT NULL,
  position JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
