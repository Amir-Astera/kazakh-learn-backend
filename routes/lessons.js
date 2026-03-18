const express = require('express');
const {
  getLessonsForUnit,
  getLessonByIdWithExercises,
  getExerciseAnswerContext,
  completeLessonForUser,
} = require('../repositories/lessonRepository');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get lessons for a unit
router.get('/unit/:unitId', authMiddleware, async (req, res) => {
  try {
    const { unitId } = req.params;
    const userId = req.user.id;

    const lessons = await getLessonsForUnit(unitId, userId);
    res.json(lessons);
  } catch (err) {
    console.error('Get lessons error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get a specific lesson with exercises
router.get('/:lessonId', authMiddleware, async (req, res) => {
  try {
    const { lessonId } = req.params;

    const lesson = await getLessonByIdWithExercises(lessonId);
    if (!lesson) {
      return res.status(404).json({ error: 'Урок не найден' });
    }

    res.json(lesson);
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

    const exercise = await getExerciseAnswerContext(lessonId, exerciseId);
    if (!exercise) {
      return res.status(404).json({ error: 'Упражнение не найдено' });
    }

    const normalizedAnswer = String(answer || '').trim().toLowerCase();
    const isCorrect = String(exercise.correct_answer || '').trim().toLowerCase() === normalizedAnswer;

    res.json({
      correct: isCorrect,
      correct_answer: exercise.correct_answer,
      explanation: exercise.explanation,
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

    const result = await completeLessonForUser(lessonId, userId, req.body || {});
    if (!result) {
      return res.status(404).json({ error: 'Урок не найден' });
    }

    res.json(result);
  } catch (err) {
    console.error('Complete lesson error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
