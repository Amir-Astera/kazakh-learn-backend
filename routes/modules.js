const express = require('express');
const {
  getLevelsWithModules,
  getModuleByIdForUser,
  getNextModulePreview,
} = require('../repositories/moduleRepository');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get all levels with their modules
router.get('/levels', authMiddleware, async (req, res) => {
  try {
    const result = await getLevelsWithModules();
    res.json(result);
  } catch (err) {
    console.error('Get levels error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get module with units and user progress
router.get('/:moduleId', authMiddleware, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const userId = req.user.id;

    const moduleData = await getModuleByIdForUser(moduleId, userId);
    if (!moduleData) {
      return res.status(404).json({ error: 'Модуль не найден' });
    }

    res.json(moduleData);
  } catch (err) {
    console.error('Get module error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get next module info (for locked module banner)
router.get('/:moduleId/next', authMiddleware, async (req, res) => {
  try {
    const { moduleId } = req.params;

    const next = await getNextModulePreview(moduleId);
    if (typeof next === 'undefined') {
      return res.status(404).json({ error: 'Модуль не найден' });
    }

    if (next === null) {
      return res.json(null);
    }

    res.json(next);
  } catch (err) {
    console.error('Get next module error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
