const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get all levels with their modules
router.get('/levels', authMiddleware, async (req, res) => {
  try {
    const levels = await pool.query('SELECT * FROM levels ORDER BY order_num');
    const modules = await pool.query(
      'SELECT * FROM modules ORDER BY order_num'
    );

    const result = levels.rows.map((level) => ({
      ...level,
      modules: modules.rows.filter((m) => m.level_id === level.id),
    }));

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

    // Get module info
    const moduleResult = await pool.query(
      `SELECT m.*, l.code as level_code, l.name as level_name 
       FROM modules m 
       JOIN levels l ON m.level_id = l.id 
       WHERE m.id = $1`,
      [moduleId]
    );

    if (moduleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Модуль не найден' });
    }

    const moduleData = moduleResult.rows[0];

    // Get units with progress and landmarks
    const units = await pool.query(
      `SELECT u.*, 
              COALESCE(up.status, 'locked') as status,
              COALESCE(up.completed_lessons, 0) as completed_lessons,
              COALESCE(up.stars, 0) as stars,
              lm.image_url as landmark_url,
              lm.alt_text as landmark_alt
       FROM units u
       LEFT JOIN user_progress up ON u.id = up.unit_id AND up.user_id = $1
       LEFT JOIN landmarks lm ON lm.unit_id = u.id
       WHERE u.module_id = $2
       ORDER BY u.order_num`,
      [userId, moduleId]
    );

    // Make first unit "current" if all are locked (new user)
    const allLocked = units.rows.every((u) => u.status === 'locked');
    if (allLocked && units.rows.length > 0) {
      units.rows[0].status = 'current';
    }

    // If a unit is completed but the next one is still locked, make it current
    for (let i = 0; i < units.rows.length - 1; i++) {
      if (units.rows[i].status === 'completed' && units.rows[i + 1].status === 'locked') {
        units.rows[i + 1].status = 'current';
        break;
      }
    }

    res.json({
      ...moduleData,
      units: units.rows,
    });
  } catch (err) {
    console.error('Get module error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get next module info (for locked module banner)
router.get('/:moduleId/next', authMiddleware, async (req, res) => {
  try {
    const { moduleId } = req.params;

    const current = await pool.query('SELECT * FROM modules WHERE id = $1', [moduleId]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Модуль не найден' });
    }

    const next = await pool.query(
      `SELECT m.*, l.code as level_code, l.name as level_name
       FROM modules m
       JOIN levels l ON m.level_id = l.id
       WHERE (m.level_id = $1 AND m.order_num > $2) 
          OR m.level_id > $1
       ORDER BY l.order_num, m.order_num
       LIMIT 1`,
      [current.rows[0].level_id, current.rows[0].order_num]
    );

    if (next.rows.length === 0) {
      return res.json(null);
    }

    // Get unit names for preview
    const units = await pool.query(
      'SELECT title_kz FROM units WHERE module_id = $1 ORDER BY order_num LIMIT 3',
      [next.rows[0].id]
    );

    res.json({
      ...next.rows[0],
      preview_units: units.rows.map((u) => u.title_kz),
    });
  } catch (err) {
    console.error('Get next module error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
