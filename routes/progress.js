const express = require('express');
const {
  getDashboardData,
  getUserStats,
  getRating,
} = require('../repositories/progressRepository');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get user dashboard data (skills, quests, stats)
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const dashboard = await getDashboardData(userId);
    res.json(dashboard);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get user statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const stats = await getUserStats(userId);
    res.json(stats);
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
    const result = await getRating();
    res.json(result);
  } catch (err) {
    console.error('Get rating error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
