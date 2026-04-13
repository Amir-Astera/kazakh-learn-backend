const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const adminRepository = require('../repositories/adminRepository');
const adminMiddleware = require('../middleware/admin');

const router = express.Router();

const landmarkUploadDir = path.join(__dirname, '../uploads/landmarks');
const pathMapUploadDir = path.join(__dirname, '../uploads/path-maps');
if (!fs.existsSync(landmarkUploadDir)) fs.mkdirSync(landmarkUploadDir, { recursive: true });
if (!fs.existsSync(pathMapUploadDir)) fs.mkdirSync(pathMapUploadDir, { recursive: true });

function removeUploadedFile(fileUrl) {
  if (!fileUrl) return;

  const normalizedPath = fileUrl.replace(/^\//, '').split('/');
  const absolutePath = path.join(__dirname, '..', ...normalizedPath);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLayoutPoint(point) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    return null;
  }

  return {
    x: clamp(Number(point.x), 0, 1),
    y: clamp(Number(point.y), 0, 1),
  };
}

function normalizePathPoints(points) {
  if (!Array.isArray(points)) return null;

  const normalized = points
    .map(normalizeLayoutPoint)
    .filter(Boolean);

  return normalized.length >= 2 ? normalized : null;
}

function serializeJsonValue(value) {
  return value == null ? null : JSON.stringify(value);
}

function normalizeLandmarkLayouts(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const id = Number(item?.id);
      if (!Number.isInteger(id) || id <= 0) return null;

      return {
        id,
        position: normalizeLayoutPoint(item?.position),
      };
    })
    .filter(Boolean);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'path_image') cb(null, pathMapUploadDir);
    else cb(null, landmarkUploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения'));
  },
});

router.use(adminMiddleware);

// ─── LEVELS ───────────────────────────────────────────────
router.get('/levels', async (req, res) => {
  try {
    const levels = await adminRepository.getAdminLevels();
    res.json(levels);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/levels', async (req, res) => {
  const { code, name, description, order_num } = req.body;
  try {
    const level = await adminRepository.createLevel({ code, name, description, order_num });
    res.status(201).json(level);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/levels/:id', async (req, res) => {
  const { code, name, description, order_num } = req.body;
  try {
    const level = await adminRepository.updateLevel(req.params.id, { code, name, description, order_num });
    if (!level) return res.status(404).json({ error: 'Уровень не найден' });
    res.json(level);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/levels/:id', async (req, res) => {
  try {
    const result = await adminRepository.deleteLevel(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── MODULES ──────────────────────────────────────────────
router.get('/modules', async (req, res) => {
  try {
    const modules = await adminRepository.getAdminModules();
    res.json(modules);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/modules', async (req, res) => {
  const { level_id, title, title_kz, description, order_num, required_xp } = req.body;
  try {
    const moduleItem = await adminRepository.createModule({ level_id, title, title_kz, description, order_num, required_xp });
    if (!moduleItem) return res.status(404).json({ error: 'Уровень не найден' });
    res.status(201).json(moduleItem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/modules/:id', async (req, res) => {
  const { level_id, title, title_kz, description, order_num, required_xp } = req.body;
  try {
    const moduleItem = await adminRepository.updateModule(req.params.id, { level_id, title, title_kz, description, order_num, required_xp });
    if (!moduleItem) return res.status(404).json({ error: 'Модуль не найден' });
    res.json(moduleItem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/modules/:id', async (req, res) => {
  try {
    const result = await adminRepository.deleteModule(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── UNITS ────────────────────────────────────────────────
router.get('/units', async (req, res) => {
  try {
    const units = await adminRepository.getAdminUnits();
    res.json(units);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/units', async (req, res) => {
  const { module_id, title, title_kz, subtitle, icon, order_num } = req.body;
  try {
    const unit = await adminRepository.createUnit({ module_id, title, title_kz, subtitle, icon, order_num });
    if (!unit) return res.status(404).json({ error: 'Модуль не найден' });
    res.status(201).json(unit);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/units/:id', async (req, res) => {
  const { module_id, title, title_kz, subtitle, icon, order_num } = req.body;
  try {
    const unit = await adminRepository.updateUnit(req.params.id, { module_id, title, title_kz, subtitle, icon, order_num });
    if (!unit) return res.status(404).json({ error: 'Раздел не найден' });
    res.json(unit);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/units/:id', async (req, res) => {
  try {
    const result = await adminRepository.deleteUnit(req.params.id);
    if (result.path_image_url) removeUploadedFile(result.path_image_url);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/units/:id/layout', async (req, res) => {
  const { path_points, landmark_position, landmarks } = req.body;
  try {
    const normalizedPathPoints = normalizePathPoints(path_points);
    const normalizedLandmarkPoint = normalizeLayoutPoint(landmark_position);
    const normalizedLandmarkLayouts = normalizeLandmarkLayouts(landmarks);
    const result = await adminRepository.saveUnitLayout(req.params.id, {
      path_points: normalizedPathPoints,
      landmark_position: normalizedLandmarkPoint,
      landmarks: normalizedLandmarkLayouts,
    });
    if (!result) return res.status(404).json({ error: 'Раздел не найден' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/units/:id/path-image', upload.single('path_image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

  const imageUrl = `/uploads/path-maps/${req.file.filename}`;
  try {
    const result = await adminRepository.saveUnitPathImage(req.params.id, imageUrl);
    if (!result) {
      removeUploadedFile(imageUrl);
      return res.status(404).json({ error: 'Раздел не найден' });
    }
    if (result.previous_path_image_url) removeUploadedFile(result.previous_path_image_url);
    res.json(result.item);
  } catch (err) {
    removeUploadedFile(imageUrl);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/units/:id/path-image', async (req, res) => {
  try {
    const result = await adminRepository.removeUnitPathImage(req.params.id);
    if (result.previous_path_image_url) removeUploadedFile(result.previous_path_image_url);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LANDMARKS (attach to unit) ───────────────────────────
router.post('/units/:id/landmarks', upload.single('image'), async (req, res) => {
  const unitId = req.params.id;
  const altText = String(req.body.alt_text || '').trim();

  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    if (!altText) return res.status(400).json({ error: 'Введите описание достопримечательности' });

    const imageUrl = `/uploads/landmarks/${req.file.filename}`;
    const landmark = await adminRepository.createUnitLandmark(unitId, {
      image_url: imageUrl,
      alt_text: altText,
    });
    if (!landmark) {
      removeUploadedFile(imageUrl);
      return res.status(404).json({ error: 'Раздел не найден' });
    }

    res.status(201).json(landmark);
  } catch (err) {
    if (req.file) removeUploadedFile(`/uploads/landmarks/${req.file.filename}`);
    res.status(500).json({ error: err.message });
  }
});

router.put('/units/:unitId/landmarks/:landmarkId', upload.single('image'), async (req, res) => {
  const { unitId, landmarkId } = req.params;
  const altText = String(req.body.alt_text || '').trim();

  try {
    if (!altText) return res.status(400).json({ error: 'Введите описание достопримечательности' });

    const nextImageUrl = req.file ? `/uploads/landmarks/${req.file.filename}` : null;
    const result = await adminRepository.updateUnitLandmark(unitId, landmarkId, {
      image_url: nextImageUrl,
      alt_text: altText,
    });
    if (!result) {
      if (nextImageUrl) removeUploadedFile(nextImageUrl);
      return res.status(404).json({ error: 'Достопримечательность не найдена' });
    }
    if (result.previous_image_url) removeUploadedFile(result.previous_image_url);

    res.json(result.item);
  } catch (err) {
    if (req.file) removeUploadedFile(`/uploads/landmarks/${req.file.filename}`);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/units/:unitId/landmarks/:landmarkId', async (req, res) => {
  try {
    const result = await adminRepository.deleteUnitLandmark(req.params.unitId, req.params.landmarkId);
    if (result.image_url) removeUploadedFile(result.image_url);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LESSONS ──────────────────────────────────────────────
router.get('/lessons', async (req, res) => {
  const { unit_id } = req.query;
  try {
    const lessons = await adminRepository.getAdminLessons(unit_id ?? null);
    res.json(lessons);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/lessons', async (req, res) => {
  const { unit_id, title, type, xp_reward, order_num, content } = req.body;
  try {
    const lesson = await adminRepository.createLesson({ unit_id, title, type, xp_reward, order_num, content });
    if (!lesson) return res.status(404).json({ error: 'Раздел не найден' });
    res.status(201).json(lesson);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/lessons/:id', async (req, res) => {
  const { unit_id, title, type, xp_reward, order_num, content } = req.body;
  try {
    const lesson = await adminRepository.updateLesson(req.params.id, { unit_id, title, type, xp_reward, order_num, content });
    if (!lesson) return res.status(404).json({ error: 'Урок не найден' });
    res.json(lesson);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/lessons/:id', async (req, res) => {
  try {
    const result = await adminRepository.deleteLesson(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EXERCISES ────────────────────────────────────────────
router.get('/exercises', async (req, res) => {
  const { lesson_id } = req.query;
  try {
    const exercises = await adminRepository.getAdminExercises(lesson_id ?? null);
    res.json(exercises);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/exercises', async (req, res) => {
  const { lesson_id, type, question, options, correct_answer, explanation, order_num } = req.body;
  try {
    const exercise = await adminRepository.createExercise({ lesson_id, type, question, options, correct_answer, explanation, order_num });
    if (!exercise) return res.status(404).json({ error: 'Урок не найден' });
    res.status(201).json(exercise);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/exercises/:id', async (req, res) => {
  const { lesson_id, type, question, options, correct_answer, explanation, order_num } = req.body;
  try {
    const exercise = await adminRepository.updateExercise(req.params.id, { lesson_id, type, question, options, correct_answer, explanation, order_num });
    if (!exercise) return res.status(404).json({ error: 'Упражнение не найдено' });
    res.json(exercise);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/exercises/:id', async (req, res) => {
  try {
    const result = await adminRepository.deleteExercise(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── STATS ────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const stats = await adminRepository.getAdminStats();
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
