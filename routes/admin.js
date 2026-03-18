const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
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
    const result = await pool.query('SELECT * FROM levels ORDER BY order_num');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/levels', async (req, res) => {
  const { code, name, description, order_num } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO levels (code, name, description, order_num) VALUES ($1,$2,$3,$4) RETURNING *',
      [code, name, description, order_num]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/levels/:id', async (req, res) => {
  const { code, name, description, order_num } = req.body;
  try {
    const result = await pool.query(
      'UPDATE levels SET code=$1, name=$2, description=$3, order_num=$4 WHERE id=$5 RETURNING *',
      [code, name, description, order_num, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/levels/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM levels WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── MODULES ──────────────────────────────────────────────
router.get('/modules', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, l.code as level_code FROM modules m JOIN levels l ON m.level_id=l.id ORDER BY l.order_num, m.order_num`
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/modules', async (req, res) => {
  const { level_id, title, title_kz, description, order_num, required_xp } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO modules (level_id,title,title_kz,description,order_num,required_xp) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [level_id, title, title_kz, description, order_num, required_xp || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/modules/:id', async (req, res) => {
  const { level_id, title, title_kz, description, order_num, required_xp } = req.body;
  try {
    const result = await pool.query(
      'UPDATE modules SET level_id=$1,title=$2,title_kz=$3,description=$4,order_num=$5,required_xp=$6 WHERE id=$7 RETURNING *',
      [level_id, title, title_kz, description, order_num, required_xp || 0, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/modules/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM modules WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── UNITS ────────────────────────────────────────────────
router.get('/units', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.*, m.title as module_title,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', lm.id,
                    'image_url', lm.image_url,
                    'alt_text', lm.alt_text,
                    'position', lm.position
                  )
                  ORDER BY lm.created_at, lm.id
                ) FILTER (WHERE lm.id IS NOT NULL),
                '[]'::json
              ) as landmarks
       FROM units u
       JOIN modules m ON u.module_id=m.id
       LEFT JOIN landmarks lm ON lm.unit_id=u.id
       GROUP BY u.id, m.title
       ORDER BY m.order_num, u.order_num`
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/units', async (req, res) => {
  const { module_id, title, title_kz, subtitle, icon, order_num } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO units (module_id,title,title_kz,subtitle,icon,order_num,lesson_count) VALUES ($1,$2,$3,$4,$5,$6,0) RETURNING *',
      [module_id, title, title_kz, subtitle, icon || 'book', order_num]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/units/:id', async (req, res) => {
  const { module_id, title, title_kz, subtitle, icon, order_num } = req.body;
  try {
    const result = await pool.query(
      'UPDATE units SET module_id=$1,title=$2,title_kz=$3,subtitle=$4,icon=$5,order_num=$6 WHERE id=$7 RETURNING *',
      [module_id, title, title_kz, subtitle, icon || 'book', order_num, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/units/:id', async (req, res) => {
  try {
    const unit = await pool.query('SELECT path_image_url FROM units WHERE id=$1', [req.params.id]);
    if (unit.rows[0]?.path_image_url) removeUploadedFile(unit.rows[0].path_image_url);
    await pool.query('DELETE FROM units WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/units/:id/layout', async (req, res) => {
  const { path_points, landmark_position, landmarks } = req.body;
  try {
    const normalizedPathPoints = normalizePathPoints(path_points);
    const normalizedLandmarkPoint = normalizeLayoutPoint(landmark_position);
    const normalizedLandmarkLayouts = normalizeLandmarkLayouts(landmarks);
    const result = await pool.query(
      'UPDATE units SET path_points=$1, landmark_position=$2 WHERE id=$3 RETURNING *',
      [serializeJsonValue(normalizedPathPoints), serializeJsonValue(normalizedLandmarkPoint), req.params.id]
    );

    for (const landmark of normalizedLandmarkLayouts) {
      await pool.query(
        'UPDATE landmarks SET position=$1 WHERE id=$2 AND unit_id=$3',
        [serializeJsonValue(landmark.position), landmark.id, req.params.id]
      );
    }

    const landmarksResult = await pool.query(
      'SELECT * FROM landmarks WHERE unit_id=$1 ORDER BY created_at, id',
      [req.params.id]
    );

    res.json({
      ...result.rows[0],
      landmarks: landmarksResult.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/units/:id/path-image', upload.single('path_image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

  const imageUrl = `/uploads/path-maps/${req.file.filename}`;
  try {
    const existing = await pool.query('SELECT path_image_url FROM units WHERE id=$1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Раздел не найден' });

    if (existing.rows[0].path_image_url) removeUploadedFile(existing.rows[0].path_image_url);

    const result = await pool.query(
      'UPDATE units SET path_image_url=$1 WHERE id=$2 RETURNING *',
      [imageUrl, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/units/:id/path-image', async (req, res) => {
  try {
    const existing = await pool.query('SELECT path_image_url FROM units WHERE id=$1', [req.params.id]);
    if (existing.rows[0]?.path_image_url) {
      removeUploadedFile(existing.rows[0].path_image_url);
      await pool.query('UPDATE units SET path_image_url=NULL WHERE id=$1', [req.params.id]);
    }
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
    const result = await pool.query(
      'INSERT INTO landmarks (unit_id, image_url, alt_text) VALUES ($1,$2,$3) RETURNING *',
      [unitId, imageUrl, altText]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (req.file) removeUploadedFile(`/uploads/landmarks/${req.file.filename}`);
    res.status(500).json({ error: err.message });
  }
});

router.put('/units/:unitId/landmarks/:landmarkId', upload.single('image'), async (req, res) => {
  const { unitId, landmarkId } = req.params;
  const altText = String(req.body.alt_text || '').trim();

  try {
    const existing = await pool.query(
      'SELECT * FROM landmarks WHERE id=$1 AND unit_id=$2',
      [landmarkId, unitId]
    );

    if (!existing.rows[0]) return res.status(404).json({ error: 'Достопримечательность не найдена' });
    if (!altText) return res.status(400).json({ error: 'Введите описание достопримечательности' });

    const nextImageUrl = req.file ? `/uploads/landmarks/${req.file.filename}` : existing.rows[0].image_url;
    if (req.file && existing.rows[0].image_url) removeUploadedFile(existing.rows[0].image_url);

    const result = await pool.query(
      'UPDATE landmarks SET image_url=$1, alt_text=$2 WHERE id=$3 AND unit_id=$4 RETURNING *',
      [nextImageUrl, altText, landmarkId, unitId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (req.file) removeUploadedFile(`/uploads/landmarks/${req.file.filename}`);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/units/:unitId/landmarks/:landmarkId', async (req, res) => {
  try {
    const existing = await pool.query(
      'SELECT image_url FROM landmarks WHERE id=$1 AND unit_id=$2',
      [req.params.landmarkId, req.params.unitId]
    );
    if (existing.rows.length > 0) {
      removeUploadedFile(existing.rows[0].image_url);
      await pool.query('DELETE FROM landmarks WHERE id=$1 AND unit_id=$2', [req.params.landmarkId, req.params.unitId]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LESSONS ──────────────────────────────────────────────
router.get('/lessons', async (req, res) => {
  const { unit_id } = req.query;
  try {
    const q = unit_id
      ? 'SELECT l.*, u.title_kz as unit_title FROM lessons l JOIN units u ON l.unit_id=u.id WHERE l.unit_id=$1 ORDER BY l.order_num'
      : 'SELECT l.*, u.title_kz as unit_title FROM lessons l JOIN units u ON l.unit_id=u.id ORDER BY l.unit_id, l.order_num';
    const result = await pool.query(q, unit_id ? [unit_id] : []);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/lessons', async (req, res) => {
  const { unit_id, title, type, xp_reward, order_num } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO lessons (unit_id,title,type,xp_reward,order_num) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [unit_id, title, type, xp_reward || 10, order_num]
    );
    await pool.query('UPDATE units SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE unit_id=$1) WHERE id=$1', [unit_id]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/lessons/:id', async (req, res) => {
  const { unit_id, title, type, xp_reward, order_num } = req.body;
  try {
    const result = await pool.query(
      'UPDATE lessons SET unit_id=$1,title=$2,type=$3,xp_reward=$4,order_num=$5 WHERE id=$6 RETURNING *',
      [unit_id, title, type, xp_reward || 10, order_num, req.params.id]
    );
    await pool.query('UPDATE units SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE unit_id=$1) WHERE id=$1', [unit_id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/lessons/:id', async (req, res) => {
  try {
    const lesson = await pool.query('SELECT unit_id FROM lessons WHERE id=$1', [req.params.id]);
    await pool.query('DELETE FROM lessons WHERE id=$1', [req.params.id]);
    if (lesson.rows[0]) {
      await pool.query('UPDATE units SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE unit_id=$1) WHERE id=$1', [lesson.rows[0].unit_id]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EXERCISES ────────────────────────────────────────────
router.get('/exercises', async (req, res) => {
  const { lesson_id } = req.query;
  try {
    const q = lesson_id
      ? 'SELECT e.*, l.title as lesson_title FROM exercises e JOIN lessons l ON e.lesson_id=l.id WHERE e.lesson_id=$1 ORDER BY e.order_num'
      : 'SELECT e.*, l.title as lesson_title FROM exercises e JOIN lessons l ON e.lesson_id=l.id ORDER BY e.lesson_id, e.order_num';
    const result = await pool.query(q, lesson_id ? [lesson_id] : []);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/exercises', async (req, res) => {
  const { lesson_id, type, question, options, correct_answer, explanation, order_num } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO exercises (lesson_id,type,question,options,correct_answer,explanation,order_num) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [lesson_id, type, question, options ? JSON.stringify(options) : null, correct_answer, explanation, order_num]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/exercises/:id', async (req, res) => {
  const { lesson_id, type, question, options, correct_answer, explanation, order_num } = req.body;
  try {
    const result = await pool.query(
      'UPDATE exercises SET lesson_id=$1,type=$2,question=$3,options=$4,correct_answer=$5,explanation=$6,order_num=$7 WHERE id=$8 RETURNING *',
      [lesson_id, type, question, options ? JSON.stringify(options) : null, correct_answer, explanation, order_num, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/exercises/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM exercises WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── STATS ────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [levels, modules, units, lessons, exercises, users] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM levels'),
      pool.query('SELECT COUNT(*) FROM modules'),
      pool.query('SELECT COUNT(*) FROM units'),
      pool.query('SELECT COUNT(*) FROM lessons'),
      pool.query('SELECT COUNT(*) FROM exercises'),
      pool.query('SELECT COUNT(*) FROM users'),
    ]);
    res.json({
      levels: parseInt(levels.rows[0].count),
      modules: parseInt(modules.rows[0].count),
      units: parseInt(units.rows[0].count),
      lessons: parseInt(lessons.rows[0].count),
      exercises: parseInt(exercises.rows[0].count),
      users: parseInt(users.rows[0].count),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
