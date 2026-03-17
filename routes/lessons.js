const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get lessons for a unit
router.get('/unit/:unitId', authMiddleware, async (req, res) => {
  try {
    const { unitId } = req.params;
    const userId = req.user.id;

    const lessons = await pool.query(
      `SELECT l.*,
              COALESCE(ulp.completed, false) as completed,
              COALESCE(ulp.score, 0) as score
       FROM lessons l
       LEFT JOIN user_lesson_progress ulp ON l.id = ulp.lesson_id AND ulp.user_id = $1
       WHERE l.unit_id = $2
       ORDER BY l.order_num`,
      [userId, unitId]
    );

    res.json(lessons.rows);
  } catch (err) {
    console.error('Get lessons error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get a specific lesson with exercises
router.get('/:lessonId', authMiddleware, async (req, res) => {
  try {
    const { lessonId } = req.params;

    const lesson = await pool.query('SELECT * FROM lessons WHERE id = $1', [lessonId]);
    if (lesson.rows.length === 0) {
      return res.status(404).json({ error: 'Урок не найден' });
    }

    const exercises = await pool.query(
      'SELECT * FROM exercises WHERE lesson_id = $1 ORDER BY order_num',
      [lessonId]
    );

    res.json({
      ...lesson.rows[0],
      exercises: exercises.rows,
    });
  } catch (err) {
    console.error('Get lesson error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Submit exercise answer
router.post('/:lessonId/answer', authMiddleware, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const { exerciseId, answer } = req.body;

    const exercise = await pool.query(
      'SELECT * FROM exercises WHERE id = $1 AND lesson_id = $2',
      [exerciseId, lessonId]
    );

    if (exercise.rows.length === 0) {
      return res.status(404).json({ error: 'Упражнение не найдено' });
    }

    const isCorrect = exercise.rows[0].correct_answer.toLowerCase() === answer.toLowerCase();

    res.json({
      correct: isCorrect,
      correct_answer: exercise.rows[0].correct_answer,
      explanation: exercise.rows[0].explanation,
    });
  } catch (err) {
    console.error('Submit answer error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Complete a lesson
router.post('/:lessonId/complete', authMiddleware, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const userId = req.user.id;
    const { score, mistakes, timeSpent } = req.body;

    // Save lesson progress
    await pool.query(
      `INSERT INTO user_lesson_progress (user_id, lesson_id, completed, score, mistakes, time_spent, completed_at)
       VALUES ($1, $2, true, $3, $4, $5, NOW())
       ON CONFLICT (user_id, lesson_id)
       DO UPDATE SET completed = true, score = $3, mistakes = $4, time_spent = $5, completed_at = NOW()`,
      [userId, lessonId, score || 100, mistakes || 0, timeSpent || 0]
    );

    // Get lesson info for XP
    const lesson = await pool.query('SELECT * FROM lessons WHERE id = $1', [lessonId]);
    const xpEarned = lesson.rows[0].xp_reward;

    // Update user XP
    await pool.query(
      'UPDATE users SET xp = xp + $1, last_activity = CURRENT_DATE WHERE id = $2',
      [xpEarned, userId]
    );

    // Update unit progress
    const unit = await pool.query(
      'SELECT u.id, u.lesson_count FROM units u JOIN lessons l ON l.unit_id = u.id WHERE l.id = $1',
      [lessonId]
    );

    if (unit.rows.length > 0) {
      const unitId = unit.rows[0].id;
      const totalLessons = unit.rows[0].lesson_count;

      const completedCount = await pool.query(
        'SELECT COUNT(*) as cnt FROM user_lesson_progress WHERE user_id = $1 AND lesson_id IN (SELECT id FROM lessons WHERE unit_id = $2) AND completed = true',
        [userId, unitId]
      );

      const completed = parseInt(completedCount.rows[0].cnt);
      const stars = completed >= totalLessons ? 3 : completed >= totalLessons * 0.6 ? 2 : 1;
      const status = completed >= totalLessons ? 'completed' : 'current';

      await pool.query(
        `INSERT INTO user_progress (user_id, unit_id, status, completed_lessons, stars)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, unit_id)
         DO UPDATE SET status = $3, completed_lessons = $4, stars = $5`,
        [userId, unitId, status, completed, stars]
      );

      // If unit completed, unlock next unit
      if (status === 'completed') {
        const nextUnit = await pool.query(
          `SELECT u.id FROM units u 
           WHERE u.module_id = (SELECT module_id FROM units WHERE id = $1) 
           AND u.order_num > (SELECT order_num FROM units WHERE id = $1)
           ORDER BY u.order_num LIMIT 1`,
          [unitId]
        );

        if (nextUnit.rows.length > 0) {
          await pool.query(
            `INSERT INTO user_progress (user_id, unit_id, status)
             VALUES ($1, $2, 'current')
             ON CONFLICT (user_id, unit_id) DO UPDATE SET status = 'current'`,
            [userId, nextUnit.rows[0].id]
          );
        }
      }
    }

    // Update skills based on lesson type
    const skillMap = {
      translation: 'vocabulary',
      choice: 'vocabulary',
      sentence: 'grammar',
      listening: 'listening',
      speaking: 'speaking',
    };
    const skillName = skillMap[lesson.rows[0].type] || 'vocabulary';
    const skillIncrease = Math.max(1, Math.floor((score || 100) / 20));

    await pool.query(
      `INSERT INTO user_skills (user_id, skill_name, progress)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, skill_name)
       DO UPDATE SET progress = LEAST(100, user_skills.progress + $3)`,
      [userId, skillName, skillIncrease]
    );

    // Update quests
    await pool.query(
      `UPDATE user_quests SET current = current + 1 
       WHERE user_id = $1 AND quest_type = 'lessons' AND completed = false`,
      [userId]
    );

    // Mark completed quests
    await pool.query(
      `UPDATE user_quests SET completed = true 
       WHERE user_id = $1 AND current >= target AND completed = false`,
      [userId]
    );

    res.json({
      xp_earned: xpEarned,
      message: 'Урок завершён!',
    });
  } catch (err) {
    console.error('Complete lesson error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
