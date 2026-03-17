const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name, last_activity) VALUES ($1, $2, $3, CURRENT_DATE) RETURNING id, email, name, xp, streak',
      [email, password_hash, name]
    );

    const user = result.rows[0];

    // Initialize user skills
    const skills = ['vocabulary', 'grammar', 'listening', 'speaking'];
    for (const skill of skills) {
      await pool.query(
        'INSERT INTO user_skills (user_id, skill_name, progress) VALUES ($1, $2, 0)',
        [user.id, skill]
      );
    }

    // Unlock the first unit for the user
    const firstUnit = await pool.query(
      'SELECT u.id FROM units u JOIN modules m ON u.module_id = m.id JOIN levels l ON m.level_id = l.id ORDER BY l.order_num, m.order_num, u.order_num LIMIT 1'
    );
    if (firstUnit.rows.length > 0) {
      await pool.query(
        "INSERT INTO user_progress (user_id, unit_id, status) VALUES ($1, $2, 'current')",
        [user.id, firstUnit.rows[0].id]
      );
    }

    // Create initial quests
    await pool.query(
      "INSERT INTO user_quests (user_id, quest_name, quest_type, target, xp_reward) VALUES ($1, 'Выучить 5 новых слов', 'words', 5, 15), ($1, 'Пройти 3 микроурока', 'lessons', 3, 30)",
      [user.id]
    );

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Неверный email или пароль' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Неверный email или пароль' });
    }

    // Update streak
    const today = new Date().toISOString().split('T')[0];
    const lastActivity = user.last_activity ? new Date(user.last_activity).toISOString().split('T')[0] : null;

    let newStreak = user.streak;
    if (lastActivity) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      if (lastActivity === yesterday) {
        newStreak = user.streak + 1;
      } else if (lastActivity !== today) {
        newStreak = 1;
      }
    } else {
      newStreak = 1;
    }

    await pool.query(
      'UPDATE users SET last_activity = CURRENT_DATE, streak = $1 WHERE id = $2',
      [newStreak, user.id]
    );

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        xp: user.xp,
        streak: newStreak,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, avatar_url, xp, streak, last_activity, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
