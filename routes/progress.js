const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get user dashboard data (skills, quests, stats)
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // User info
    const user = await pool.query(
      'SELECT id, name, xp, streak, last_activity FROM users WHERE id = $1',
      [userId]
    );

    // Skills
    const skills = await pool.query(
      'SELECT skill_name, progress FROM user_skills WHERE user_id = $1',
      [userId]
    );

    // Active quests
    const quests = await pool.query(
      'SELECT * FROM user_quests WHERE user_id = $1 AND completed = false ORDER BY created_at DESC LIMIT 5',
      [userId]
    );

    // Recent completed lessons count (last 7 days)
    const recentLessons = await pool.query(
      "SELECT COUNT(*) as cnt FROM user_lesson_progress WHERE user_id = $1 AND completed_at > NOW() - INTERVAL '7 days'",
      [userId]
    );

    // Smart reminder: find weakest skill or unit with most mistakes
    let reminder = null;
    const weakestSkill = await pool.query(
      'SELECT skill_name, progress FROM user_skills WHERE user_id = $1 ORDER BY progress ASC LIMIT 1',
      [userId]
    );

    if (weakestSkill.rows.length > 0 && weakestSkill.rows[0].progress < 50) {
      const skillNames = {
        vocabulary: 'словарный запас',
        grammar: 'грамматику',
        listening: 'аудирование',
        speaking: 'произношение',
      };
      reminder = {
        title: 'Умная подсказка',
        message: `Подтяните ${skillNames[weakestSkill.rows[0].skill_name] || weakestSkill.rows[0].skill_name}. Пройдите 2-минутный урок для закрепления!`,
      };
    }

    res.json({
      user: user.rows[0],
      skills: skills.rows,
      quests: quests.rows,
      recent_lessons: parseInt(recentLessons.rows[0].cnt),
      reminder,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get user statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const totalLessons = await pool.query(
      'SELECT COUNT(*) as cnt FROM user_lesson_progress WHERE user_id = $1 AND completed = true',
      [userId]
    );

    const totalXP = await pool.query(
      'SELECT xp FROM users WHERE id = $1',
      [userId]
    );

    const avgScore = await pool.query(
      'SELECT ROUND(AVG(score)) as avg_score FROM user_lesson_progress WHERE user_id = $1 AND completed = true',
      [userId]
    );

    const completedUnits = await pool.query(
      "SELECT COUNT(*) as cnt FROM user_progress WHERE user_id = $1 AND status = 'completed'",
      [userId]
    );

    res.json({
      total_lessons: parseInt(totalLessons.rows[0].cnt),
      total_xp: totalXP.rows[0].xp,
      avg_score: parseInt(avgScore.rows[0].avg_score) || 0,
      completed_units: parseInt(completedUnits.rows[0].cnt),
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get proverb of the day
router.get('/proverb', authMiddleware, async (req, res) => {
  const proverbs = [
    { text: 'Отан – отбасынан басталады.', translation: 'Родина начинается с семьи.', translation_en: 'Motherland begins with the family.' },
    { text: 'Тіл – білімнің кілті.', translation: 'Язык – ключ к знаниям.', translation_en: 'Language is the key to knowledge.' },
    { text: 'Білім – бақыттың кілті.', translation: 'Знание – ключ к счастью.', translation_en: 'Knowledge is the key to happiness.' },
    { text: 'Еңбек етсең ерінбей, тояды қарның тіленбей.', translation: 'Кто трудится – не голодает.', translation_en: 'He who works hard will never go hungry.' },
    { text: 'Бірлік бар жерде, тірлік бар.', translation: 'Где единство, там и жизнь.', translation_en: 'Where there is unity, there is life.' },
  ];

  const dayIndex = new Date().getDate() % proverbs.length;
  res.json({ ...proverbs[dayIndex], xp_reward: 50 });
});

// Rating (leaderboard)
router.get('/rating', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, xp, streak FROM users WHERE is_admin = FALSE ORDER BY xp DESC LIMIT 50'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get rating error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
