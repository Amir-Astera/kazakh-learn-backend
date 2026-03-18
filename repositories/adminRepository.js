const pool = require('../config/db');
const { isMongoProvider } = require('../config/dbProvider');

let mongooseModule = null;

function getMongooseModule() {
  if (!mongooseModule) {
    const { getMongoose } = require('../config/mongo');
    mongooseModule = getMongoose();
  }

  return mongooseModule;
}

function parseLegacyId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildRootIdCriteria(id) {
  const criteria = [];
  const legacyId = parseLegacyId(id);

  if (legacyId != null) {
    criteria.push({ legacyId });
  }

  const { Types } = getMongooseModule();
  if (Types.ObjectId.isValid(String(id))) {
    criteria.push({ _id: new Types.ObjectId(String(id)) });
  }

  if (criteria.length === 0) {
    return null;
  }

  return criteria.length === 1 ? criteria[0] : { $or: criteria };
}

async function getNextLegacyId(Model) {
  const latest = await Model.findOne({ legacyId: { $ne: null } }).sort({ legacyId: -1 }).select('legacyId').lean();
  return (latest?.legacyId || 0) + 1;
}

async function getNextLandmarkLegacyId(Unit) {
  const result = await Unit.aggregate([
    { $unwind: '$landmarks' },
    { $match: { 'landmarks.legacyId': { $ne: null } } },
    { $group: { _id: null, maxLegacyId: { $max: '$landmarks.legacyId' } } },
  ]);

  return (result[0]?.maxLegacyId || 0) + 1;
}

function normalizeOptions(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  return null;
}

async function getMongoModels() {
  const User = require('../models/User');
  const Level = require('../models/Level');
  const Module = require('../models/Module');
  const Unit = require('../models/Unit');
  const Lesson = require('../models/Lesson');
  const Exercise = require('../models/Exercise');
  const UserUnitProgress = require('../models/UserUnitProgress');
  const UserLessonProgress = require('../models/UserLessonProgress');

  return {
    User,
    Level,
    Module,
    Unit,
    Lesson,
    Exercise,
    UserUnitProgress,
    UserLessonProgress,
  };
}

function serializeLevel(level) {
  return {
    id: level.legacyId ?? String(level._id),
    code: level.code,
    name: level.name,
    description: level.description || '',
    order_num: level.orderNum,
  };
}

function serializeModule(moduleDoc, levelDoc) {
  const resolvedLevelId = levelDoc?._id || moduleDoc.levelId;

  return {
    id: moduleDoc.legacyId ?? String(moduleDoc._id),
    level_id: levelDoc?.legacyId ?? String(resolvedLevelId),
    title: moduleDoc.title,
    title_kz: moduleDoc.titleKz,
    description: moduleDoc.description || '',
    order_num: moduleDoc.orderNum,
    required_xp: moduleDoc.requiredXp || 0,
    level_code: levelDoc?.code,
  };
}

function serializeUnit(unitDoc, moduleDoc) {
  const resolvedModuleId = moduleDoc?._id || unitDoc.moduleId;

  return {
    id: unitDoc.legacyId ?? String(unitDoc._id),
    module_id: moduleDoc?.legacyId ?? String(resolvedModuleId),
    title: unitDoc.title,
    title_kz: unitDoc.titleKz,
    subtitle: unitDoc.subtitle || '',
    icon: unitDoc.icon || 'book',
    order_num: unitDoc.orderNum,
    lesson_count: unitDoc.lessonCount || 0,
    path_image_url: unitDoc.pathImageUrl || null,
    path_points: unitDoc.pathPoints || null,
    landmark_position: unitDoc.landmarkPosition || null,
    module_title: moduleDoc?.title,
    landmarks: Array.isArray(unitDoc.landmarks)
      ? unitDoc.landmarks.map((landmark) => serializeLandmark(landmark, unitDoc.legacyId ?? String(unitDoc._id)))
      : [],
  };
}

function serializeLandmark(landmark, unitId) {
  return {
    id: landmark.legacyId ?? String(landmark._id),
    unit_id: unitId,
    image_url: landmark.imageUrl,
    alt_text: landmark.altText,
    position: landmark.position || null,
  };
}

function serializeLesson(lessonDoc, unitDoc) {
  const resolvedUnitId = unitDoc?._id || lessonDoc.unitId;

  return {
    id: lessonDoc.legacyId ?? String(lessonDoc._id),
    unit_id: unitDoc?.legacyId ?? String(resolvedUnitId),
    title: lessonDoc.title,
    type: lessonDoc.type,
    xp_reward: lessonDoc.xpReward || 0,
    order_num: lessonDoc.orderNum,
    unit_title: unitDoc?.titleKz,
  };
}

function serializeExercise(exerciseDoc, lessonDoc) {
  const resolvedLessonId = lessonDoc?._id || exerciseDoc.lessonId;

  return {
    id: exerciseDoc.legacyId ?? String(exerciseDoc._id),
    lesson_id: lessonDoc?.legacyId ?? String(resolvedLessonId),
    type: exerciseDoc.type,
    question: exerciseDoc.question,
    question_audio: exerciseDoc.questionAudio || null,
    options: exerciseDoc.options || null,
    correct_answer: exerciseDoc.correctAnswer,
    explanation: exerciseDoc.explanation,
    order_num: exerciseDoc.orderNum,
    lesson_title: lessonDoc?.title,
  };
}

async function findLevelByIdentifier(Level, id) {
  const criteria = buildRootIdCriteria(id);
  if (!criteria) return null;
  return Level.findOne(criteria).lean();
}

async function findModuleByIdentifier(Module, id) {
  const criteria = buildRootIdCriteria(id);
  if (!criteria) return null;
  return Module.findOne(criteria).lean();
}

async function findUnitByIdentifier(Unit, id) {
  const criteria = buildRootIdCriteria(id);
  if (!criteria) return null;
  return Unit.findOne(criteria).lean();
}

async function findLessonByIdentifier(Lesson, id) {
  const criteria = buildRootIdCriteria(id);
  if (!criteria) return null;
  return Lesson.findOne(criteria).lean();
}

async function updateUnitLessonCount(Unit, Lesson, unitDoc) {
  if (!unitDoc) return 0;
  const count = await Lesson.countDocuments({ unitId: unitDoc._id });
  await Unit.updateOne({ _id: unitDoc._id }, { $set: { lessonCount: count } });
  return count;
}

async function deleteLessonsCascade(Lesson, Exercise, UserLessonProgress, lessonIds) {
  if (!Array.isArray(lessonIds) || lessonIds.length === 0) {
    return;
  }

  await Promise.all([
    Exercise.deleteMany({ lessonId: { $in: lessonIds } }),
    UserLessonProgress.deleteMany({ lessonId: { $in: lessonIds } }),
    Lesson.deleteMany({ _id: { $in: lessonIds } }),
  ]);
}

async function deleteUnitsCascade(models, unitIds) {
  if (!Array.isArray(unitIds) || unitIds.length === 0) {
    return;
  }

  const { Unit, Lesson, Exercise, UserUnitProgress, UserLessonProgress } = models;
  const lessons = await Lesson.find({ unitId: { $in: unitIds } }).select('_id').lean();
  const lessonIds = lessons.map((lesson) => lesson._id);

  await deleteLessonsCascade(Lesson, Exercise, UserLessonProgress, lessonIds);
  await Promise.all([
    UserUnitProgress.deleteMany({ unitId: { $in: unitIds } }),
    Unit.deleteMany({ _id: { $in: unitIds } }),
  ]);
}

async function getAdminLevelsPostgres() {
  const result = await pool.query('SELECT * FROM levels ORDER BY order_num');
  return result.rows;
}

async function getAdminLevelsMongo() {
  const { Level } = await getMongoModels();
  const levels = await Level.find().sort({ orderNum: 1 }).lean();
  return levels.map(serializeLevel);
}

async function createLevelPostgres(payload) {
  const result = await pool.query(
    'INSERT INTO levels (code, name, description, order_num) VALUES ($1,$2,$3,$4) RETURNING *',
    [payload.code, payload.name, payload.description, payload.order_num]
  );

  return result.rows[0];
}

async function createLevelMongo(payload) {
  const { Level } = await getMongoModels();
  const level = await Level.create({
    legacyId: await getNextLegacyId(Level),
    code: payload.code,
    name: payload.name,
    description: payload.description || '',
    orderNum: payload.order_num,
  });

  return serializeLevel(level);
}

async function updateLevelPostgres(id, payload) {
  const result = await pool.query(
    'UPDATE levels SET code=$1, name=$2, description=$3, order_num=$4 WHERE id=$5 RETURNING *',
    [payload.code, payload.name, payload.description, payload.order_num, id]
  );

  return result.rows[0] || null;
}

async function updateLevelMongo(id, payload) {
  const { Level } = await getMongoModels();
  const criteria = buildRootIdCriteria(id);

  if (!criteria) return null;

  const level = await Level.findOneAndUpdate(
    criteria,
    {
      $set: {
        code: payload.code,
        name: payload.name,
        description: payload.description || '',
        orderNum: payload.order_num,
      },
    },
    { new: true }
  ).lean();

  return level ? serializeLevel(level) : null;
}

async function deleteLevelPostgres(id) {
  await pool.query('DELETE FROM levels WHERE id=$1', [id]);
  return { success: true };
}

async function deleteLevelMongo(id) {
  const models = await getMongoModels();
  const { Level, Module, Unit, Lesson, Exercise, UserUnitProgress, UserLessonProgress } = models;
  const level = await findLevelByIdentifier(Level, id);

  if (!level) {
    return { success: true };
  }

  const modules = await Module.find({ levelId: level._id }).select('_id').lean();
  const moduleIds = modules.map((moduleDoc) => moduleDoc._id);
  const units = await Unit.find({ moduleId: { $in: moduleIds } }).select('_id').lean();

  await deleteUnitsCascade({ Unit, Lesson, Exercise, UserUnitProgress, UserLessonProgress }, units.map((unit) => unit._id));
  await Module.deleteMany({ _id: { $in: moduleIds } });
  await Level.deleteOne({ _id: level._id });

  return { success: true };
}

async function getAdminModulesPostgres() {
  const result = await pool.query(
    `SELECT m.*, l.code as level_code FROM modules m JOIN levels l ON m.level_id=l.id ORDER BY l.order_num, m.order_num`
  );
  return result.rows;
}

async function getAdminModulesMongo() {
  const { Module } = await getMongoModels();
  const modules = await Module.find().populate('levelId').lean();

  modules.sort((left, right) => {
    const leftLevelOrder = left.levelId?.orderNum || 0;
    const rightLevelOrder = right.levelId?.orderNum || 0;
    if (leftLevelOrder !== rightLevelOrder) return leftLevelOrder - rightLevelOrder;
    return (left.orderNum || 0) - (right.orderNum || 0);
  });

  return modules.map((moduleDoc) => serializeModule(moduleDoc, moduleDoc.levelId));
}

async function createModulePostgres(payload) {
  const result = await pool.query(
    'INSERT INTO modules (level_id,title,title_kz,description,order_num,required_xp) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [payload.level_id, payload.title, payload.title_kz, payload.description, payload.order_num, payload.required_xp || 0]
  );

  return result.rows[0];
}

async function createModuleMongo(payload) {
  const { Level, Module } = await getMongoModels();
  const level = await findLevelByIdentifier(Level, payload.level_id);

  if (!level) return null;

  const moduleDoc = await Module.create({
    legacyId: await getNextLegacyId(Module),
    levelId: level._id,
    title: payload.title,
    titleKz: payload.title_kz || payload.title,
    description: payload.description || '',
    orderNum: payload.order_num,
    requiredXp: payload.required_xp || 0,
  });

  return serializeModule(moduleDoc, level);
}

async function updateModulePostgres(id, payload) {
  const result = await pool.query(
    'UPDATE modules SET level_id=$1,title=$2,title_kz=$3,description=$4,order_num=$5,required_xp=$6 WHERE id=$7 RETURNING *',
    [payload.level_id, payload.title, payload.title_kz, payload.description, payload.order_num, payload.required_xp || 0, id]
  );

  return result.rows[0] || null;
}

async function updateModuleMongo(id, payload) {
  const { Level, Module } = await getMongoModels();
  const level = await findLevelByIdentifier(Level, payload.level_id);
  const criteria = buildRootIdCriteria(id);

  if (!level || !criteria) return null;

  const moduleDoc = await Module.findOneAndUpdate(
    criteria,
    {
      $set: {
        levelId: level._id,
        title: payload.title,
        titleKz: payload.title_kz || payload.title,
        description: payload.description || '',
        orderNum: payload.order_num,
        requiredXp: payload.required_xp || 0,
      },
    },
    { new: true }
  ).lean();

  return moduleDoc ? serializeModule(moduleDoc, level) : null;
}

async function deleteModulePostgres(id) {
  await pool.query('DELETE FROM modules WHERE id=$1', [id]);
  return { success: true };
}

async function deleteModuleMongo(id) {
  const models = await getMongoModels();
  const { Module, Unit, Lesson, Exercise, UserUnitProgress, UserLessonProgress } = models;
  const moduleDoc = await findModuleByIdentifier(Module, id);

  if (!moduleDoc) {
    return { success: true };
  }

  const units = await Unit.find({ moduleId: moduleDoc._id }).select('_id').lean();
  await deleteUnitsCascade({ Unit, Lesson, Exercise, UserUnitProgress, UserLessonProgress }, units.map((unit) => unit._id));
  await Module.deleteOne({ _id: moduleDoc._id });

  return { success: true };
}

async function getAdminUnitsPostgres() {
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
  return result.rows;
}

async function getAdminUnitsMongo() {
  const { Unit } = await getMongoModels();
  const units = await Unit.find().populate('moduleId').lean();

  units.sort((left, right) => {
    const leftModuleOrder = left.moduleId?.orderNum || 0;
    const rightModuleOrder = right.moduleId?.orderNum || 0;
    if (leftModuleOrder !== rightModuleOrder) return leftModuleOrder - rightModuleOrder;
    return (left.orderNum || 0) - (right.orderNum || 0);
  });

  return units.map((unitDoc) => serializeUnit(unitDoc, unitDoc.moduleId));
}

async function createUnitPostgres(payload) {
  const result = await pool.query(
    'INSERT INTO units (module_id,title,title_kz,subtitle,icon,order_num,lesson_count) VALUES ($1,$2,$3,$4,$5,$6,0) RETURNING *',
    [payload.module_id, payload.title, payload.title_kz, payload.subtitle, payload.icon || 'book', payload.order_num]
  );

  return result.rows[0];
}

async function createUnitMongo(payload) {
  const { Module, Unit } = await getMongoModels();
  const moduleDoc = await findModuleByIdentifier(Module, payload.module_id);

  if (!moduleDoc) return null;

  const unitDoc = await Unit.create({
    legacyId: await getNextLegacyId(Unit),
    moduleId: moduleDoc._id,
    title: payload.title,
    titleKz: payload.title_kz || payload.title,
    subtitle: payload.subtitle || '',
    icon: payload.icon || 'book',
    orderNum: payload.order_num,
    lessonCount: 0,
    pathImageUrl: null,
    pathPoints: null,
    landmarkPosition: null,
    landmarks: [],
  });

  return serializeUnit(unitDoc, moduleDoc);
}

async function updateUnitPostgres(id, payload) {
  const result = await pool.query(
    'UPDATE units SET module_id=$1,title=$2,title_kz=$3,subtitle=$4,icon=$5,order_num=$6 WHERE id=$7 RETURNING *',
    [payload.module_id, payload.title, payload.title_kz, payload.subtitle, payload.icon || 'book', payload.order_num, id]
  );

  return result.rows[0] || null;
}

async function updateUnitMongo(id, payload) {
  const { Module, Unit } = await getMongoModels();
  const moduleDoc = await findModuleByIdentifier(Module, payload.module_id);
  const criteria = buildRootIdCriteria(id);

  if (!moduleDoc || !criteria) return null;

  const unitDoc = await Unit.findOneAndUpdate(
    criteria,
    {
      $set: {
        moduleId: moduleDoc._id,
        title: payload.title,
        titleKz: payload.title_kz || payload.title,
        subtitle: payload.subtitle || '',
        icon: payload.icon || 'book',
        orderNum: payload.order_num,
      },
    },
    { new: true }
  ).lean();

  return unitDoc ? serializeUnit(unitDoc, moduleDoc) : null;
}

async function deleteUnitPostgres(id) {
  const existing = await pool.query('SELECT path_image_url FROM units WHERE id=$1', [id]);
  await pool.query('DELETE FROM units WHERE id=$1', [id]);

  return {
    success: true,
    path_image_url: existing.rows[0]?.path_image_url || null,
  };
}

async function deleteUnitMongo(id) {
  const models = await getMongoModels();
  const { Unit, Lesson, Exercise, UserUnitProgress, UserLessonProgress } = models;
  const unitDoc = await findUnitByIdentifier(Unit, id);

  if (!unitDoc) {
    return { success: true, path_image_url: null };
  }

  await deleteUnitsCascade({ Unit, Lesson, Exercise, UserUnitProgress, UserLessonProgress }, [unitDoc._id]);

  return {
    success: true,
    path_image_url: unitDoc.pathImageUrl || null,
  };
}

function findLandmarkIndex(unitDoc, landmarkId) {
  return unitDoc.landmarks.findIndex((landmark) => {
    if (landmark.legacyId != null && String(landmark.legacyId) === String(landmarkId)) {
      return true;
    }

    return String(landmark._id) === String(landmarkId);
  });
}

async function updateUnitLayoutPostgres(id, payload) {
  const result = await pool.query(
    'UPDATE units SET path_points=$1, landmark_position=$2 WHERE id=$3 RETURNING *',
    [
      payload.path_points == null ? null : JSON.stringify(payload.path_points),
      payload.landmark_position == null ? null : JSON.stringify(payload.landmark_position),
      id,
    ]
  );

  for (const landmark of payload.landmarks || []) {
    await pool.query(
      'UPDATE landmarks SET position=$1 WHERE id=$2 AND unit_id=$3',
      [landmark.position == null ? null : JSON.stringify(landmark.position), landmark.id, id]
    );
  }

  const landmarksResult = await pool.query(
    'SELECT * FROM landmarks WHERE unit_id=$1 ORDER BY created_at, id',
    [id]
  );

  return {
    ...result.rows[0],
    landmarks: landmarksResult.rows,
  };
}

async function updateUnitLayoutMongo(id, payload) {
  const { Unit } = await getMongoModels();
  const criteria = buildRootIdCriteria(id);
  if (!criteria) return null;

  const unitDoc = await Unit.findOne(criteria);
  if (!unitDoc) return null;

  unitDoc.pathPoints = Array.isArray(payload.path_points) ? payload.path_points : [];
  unitDoc.landmarkPosition = payload.landmark_position || null;

  for (const landmark of payload.landmarks || []) {
    const index = findLandmarkIndex(unitDoc, landmark.id);
    if (index >= 0) {
      unitDoc.landmarks[index].position = landmark.position || null;
    }
  }

  await unitDoc.save();
  const moduleDoc = await unitDoc.populate('moduleId');
  return serializeUnit(moduleDoc, moduleDoc.moduleId);
}

async function updateUnitLayout(id, payload) {
  return isMongoProvider() ? updateUnitLayoutMongo(id, payload) : updateUnitLayoutPostgres(id, payload);
}

async function uploadUnitPathImagePostgres(id, imageUrl) {
  const existing = await pool.query('SELECT path_image_url FROM units WHERE id=$1', [id]);
  if (!existing.rows[0]) return null;

  const result = await pool.query(
    'UPDATE units SET path_image_url=$1 WHERE id=$2 RETURNING *',
    [imageUrl, id]
  );

  return {
    item: result.rows[0],
    previous_path_image_url: existing.rows[0].path_image_url || null,
  };
}

async function uploadUnitPathImageMongo(id, imageUrl) {
  const { Unit } = await getMongoModels();
  const criteria = buildRootIdCriteria(id);
  if (!criteria) return null;

  const unitDoc = await Unit.findOne(criteria);
  if (!unitDoc) return null;

  const previousPathImageUrl = unitDoc.pathImageUrl || null;
  unitDoc.pathImageUrl = imageUrl;
  await unitDoc.save();
  const populated = await unitDoc.populate('moduleId');

  return {
    item: serializeUnit(populated, populated.moduleId),
    previous_path_image_url: previousPathImageUrl,
  };
}

async function uploadUnitPathImage(id, imageUrl) {
  return isMongoProvider() ? uploadUnitPathImageMongo(id, imageUrl) : uploadUnitPathImagePostgres(id, imageUrl);
}

async function deleteUnitPathImagePostgres(id) {
  const existing = await pool.query('SELECT path_image_url FROM units WHERE id=$1', [id]);
  if (existing.rows[0]?.path_image_url) {
    await pool.query('UPDATE units SET path_image_url=NULL WHERE id=$1', [id]);
  }

  return {
    success: true,
    previous_path_image_url: existing.rows[0]?.path_image_url || null,
  };
}

async function deleteUnitPathImageMongo(id) {
  const { Unit } = await getMongoModels();
  const criteria = buildRootIdCriteria(id);
  if (!criteria) return { success: true, previous_path_image_url: null };

  const unitDoc = await Unit.findOne(criteria);
  if (!unitDoc) return { success: true, previous_path_image_url: null };

  const previousPathImageUrl = unitDoc.pathImageUrl || null;
  unitDoc.pathImageUrl = null;
  await unitDoc.save();

  return {
    success: true,
    previous_path_image_url: previousPathImageUrl,
  };
}

async function deleteUnitPathImage(id) {
  return isMongoProvider() ? deleteUnitPathImageMongo(id) : deleteUnitPathImagePostgres(id);
}

async function createLandmarkPostgres(unitId, payload) {
  const result = await pool.query(
    'INSERT INTO landmarks (unit_id, image_url, alt_text) VALUES ($1,$2,$3) RETURNING *',
    [unitId, payload.image_url, payload.alt_text]
  );

  return result.rows[0];
}

async function createLandmarkMongo(unitId, payload) {
  const { Unit } = await getMongoModels();
  const criteria = buildRootIdCriteria(unitId);
  if (!criteria) return null;

  const unitDoc = await Unit.findOne(criteria);
  if (!unitDoc) return null;

  const landmark = {
    legacyId: await getNextLandmarkLegacyId(Unit),
    imageUrl: payload.image_url,
    altText: payload.alt_text,
    position: null,
    createdAt: new Date(),
  };

  unitDoc.landmarks.push(landmark);
  await unitDoc.save();
  const createdLandmark = unitDoc.landmarks[unitDoc.landmarks.length - 1];
  return serializeLandmark(createdLandmark, unitDoc.legacyId ?? String(unitDoc._id));
}

async function createLandmark(unitId, payload) {
  return isMongoProvider() ? createLandmarkMongo(unitId, payload) : createLandmarkPostgres(unitId, payload);
}

async function updateLandmarkPostgres(unitId, landmarkId, payload) {
  const existing = await pool.query(
    'SELECT * FROM landmarks WHERE id=$1 AND unit_id=$2',
    [landmarkId, unitId]
  );

  if (!existing.rows[0]) return null;

  const nextImageUrl = payload.image_url || existing.rows[0].image_url;
  const result = await pool.query(
    'UPDATE landmarks SET image_url=$1, alt_text=$2 WHERE id=$3 AND unit_id=$4 RETURNING *',
    [nextImageUrl, payload.alt_text, landmarkId, unitId]
  );

  return {
    item: result.rows[0],
    previous_image_url: payload.image_url ? existing.rows[0].image_url : null,
  };
}

async function updateLandmarkMongo(unitId, landmarkId, payload) {
  const { Unit } = await getMongoModels();
  const criteria = buildRootIdCriteria(unitId);
  if (!criteria) return null;

  const unitDoc = await Unit.findOne(criteria);
  if (!unitDoc) return null;

  const index = findLandmarkIndex(unitDoc, landmarkId);
  if (index < 0) return null;

  const existing = unitDoc.landmarks[index];
  const previousImageUrl = payload.image_url ? existing.imageUrl : null;
  existing.imageUrl = payload.image_url || existing.imageUrl;
  existing.altText = payload.alt_text;
  await unitDoc.save();

  return {
    item: serializeLandmark(existing, unitDoc.legacyId ?? String(unitDoc._id)),
    previous_image_url: previousImageUrl,
  };
}

async function updateLandmark(unitId, landmarkId, payload) {
  return isMongoProvider()
    ? updateLandmarkMongo(unitId, landmarkId, payload)
    : updateLandmarkPostgres(unitId, landmarkId, payload);
}

async function deleteLandmarkPostgres(unitId, landmarkId) {
  const existing = await pool.query(
    'SELECT image_url FROM landmarks WHERE id=$1 AND unit_id=$2',
    [landmarkId, unitId]
  );

  if (existing.rows.length > 0) {
    await pool.query('DELETE FROM landmarks WHERE id=$1 AND unit_id=$2', [landmarkId, unitId]);
  }

  return {
    success: true,
    image_url: existing.rows[0]?.image_url || null,
  };
}

async function deleteLandmarkMongo(unitId, landmarkId) {
  const { Unit } = await getMongoModels();
  const criteria = buildRootIdCriteria(unitId);
  if (!criteria) return { success: true, image_url: null };

  const unitDoc = await Unit.findOne(criteria);
  if (!unitDoc) return { success: true, image_url: null };

  const index = findLandmarkIndex(unitDoc, landmarkId);
  if (index < 0) return { success: true, image_url: null };

  const imageUrl = unitDoc.landmarks[index].imageUrl || null;
  unitDoc.landmarks.splice(index, 1);
  await unitDoc.save();

  return {
    success: true,
    image_url: imageUrl,
  };
}

async function deleteLandmark(unitId, landmarkId) {
  return isMongoProvider()
    ? deleteLandmarkMongo(unitId, landmarkId)
    : deleteLandmarkPostgres(unitId, landmarkId);
}

async function getAdminLessonsPostgres(unitId) {
  const query = unitId
    ? 'SELECT l.*, u.title_kz as unit_title FROM lessons l JOIN units u ON l.unit_id=u.id WHERE l.unit_id=$1 ORDER BY l.order_num'
    : 'SELECT l.*, u.title_kz as unit_title FROM lessons l JOIN units u ON l.unit_id=u.id ORDER BY l.unit_id, l.order_num';
  const result = await pool.query(query, unitId ? [unitId] : []);
  return result.rows;
}

async function getAdminLessonsMongo(unitId) {
  const { Unit, Lesson } = await getMongoModels();
  const query = {};

  if (unitId != null) {
    const unitDoc = await Unit.findOne({ legacyId: unitId });
    if (!unitDoc) return [];
    query.unitId = unitDoc._id;
  }

  const lessons = await Lesson.find(query).populate('unitId').lean();
  lessons.sort((left, right) => {
    const leftUnitOrder = left.unitId?.orderNum || 0;
    const rightUnitOrder = right.unitId?.orderNum || 0;
    if (leftUnitOrder !== rightUnitOrder) return leftUnitOrder - rightUnitOrder;
    return (left.orderNum || 0) - (right.orderNum || 0);
  });

  return lessons.map((lessonDoc) => serializeLesson(lessonDoc, lessonDoc.unitId));
}

async function createLessonPostgres(payload) {
  const result = await pool.query(
    'INSERT INTO lessons (unit_id,title,type,xp_reward,order_num) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [payload.unit_id, payload.title, payload.type, payload.xp_reward || 10, payload.order_num]
  );
  await pool.query('UPDATE units SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE unit_id=$1) WHERE id=$1', [payload.unit_id]);

  return result.rows[0];
}

async function createLessonMongo(payload) {
  const { Unit, Lesson } = await getMongoModels();
  const unitDoc = await findUnitByIdentifier(Unit, payload.unit_id);

  if (!unitDoc) return null;

  const lessonDoc = await Lesson.create({
    legacyId: await getNextLegacyId(Lesson),
    unitId: unitDoc._id,
    title: payload.title,
    type: payload.type,
    xpReward: payload.xp_reward || 10,
    orderNum: payload.order_num,
  });

  await updateUnitLessonCount(Unit, Lesson, unitDoc);

  return serializeLesson(lessonDoc, unitDoc);
}

async function updateLessonPostgres(id, payload) {
  const result = await pool.query(
    'UPDATE lessons SET unit_id=$1,title=$2,type=$3,xp_reward=$4,order_num=$5 WHERE id=$6 RETURNING *',
    [payload.unit_id, payload.title, payload.type, payload.xp_reward || 10, payload.order_num, id]
  );
  await pool.query('UPDATE units SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE unit_id=$1) WHERE id=$1', [payload.unit_id]);

  return result.rows[0] || null;
}

async function updateLessonMongo(id, payload) {
  const { Unit, Lesson } = await getMongoModels();
  const targetUnit = await findUnitByIdentifier(Unit, payload.unit_id);
  const existingLesson = await findLessonByIdentifier(Lesson, id);

  if (!targetUnit || !existingLesson) return null;

  const criteria = buildRootIdCriteria(id);
  const lessonDoc = await Lesson.findOneAndUpdate(
    criteria,
    {
      $set: {
        unitId: targetUnit._id,
        title: payload.title,
        type: payload.type,
        xpReward: payload.xp_reward || 10,
        orderNum: payload.order_num,
      },
    },
    { new: true }
  ).lean();

  const affectedUnitIds = [String(targetUnit._id)];
  if (String(existingLesson.unitId) !== String(targetUnit._id)) {
    affectedUnitIds.push(String(existingLesson.unitId));
  }

  for (const unitId of affectedUnitIds) {
    const unitDoc = await Unit.findById(unitId).lean();
    await updateUnitLessonCount(Unit, Lesson, unitDoc);
  }

  return lessonDoc ? serializeLesson(lessonDoc, targetUnit) : null;
}

async function deleteLessonPostgres(id) {
  const lesson = await pool.query('SELECT unit_id FROM lessons WHERE id=$1', [id]);
  await pool.query('DELETE FROM lessons WHERE id=$1', [id]);
  if (lesson.rows[0]) {
    await pool.query('UPDATE units SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE unit_id=$1) WHERE id=$1', [lesson.rows[0].unit_id]);
  }

  return { success: true };
}

async function deleteLessonMongo(id) {
  const { Unit, Lesson, Exercise, UserLessonProgress } = await getMongoModels();
  const lessonDoc = await findLessonByIdentifier(Lesson, id);

  if (!lessonDoc) {
    return { success: true };
  }

  await deleteLessonsCascade(Lesson, Exercise, UserLessonProgress, [lessonDoc._id]);
  const unitDoc = await Unit.findById(lessonDoc.unitId).lean();
  await updateUnitLessonCount(Unit, Lesson, unitDoc);

  return { success: true };
}

async function getAdminExercisesPostgres(lessonId) {
  const query = lessonId
    ? 'SELECT e.*, l.title as lesson_title FROM exercises e JOIN lessons l ON e.lesson_id=l.id WHERE e.lesson_id=$1 ORDER BY e.order_num'
    : 'SELECT e.*, l.title as lesson_title FROM exercises e JOIN lessons l ON e.lesson_id=l.id ORDER BY e.lesson_id, e.order_num';
  const result = await pool.query(query, lessonId ? [lessonId] : []);
  return result.rows;
}

async function getAdminExercisesMongo(lessonId) {
  const { Lesson, Exercise } = await getMongoModels();
  const query = {};

  if (lessonId != null) {
    const lessonDoc = await findLessonByIdentifier(Lesson, lessonId);
    if (!lessonDoc) return [];
    query.lessonId = lessonDoc._id;
  }

  const exercises = await Exercise.find(query).populate('lessonId').lean();
  exercises.sort((left, right) => {
    const leftLessonOrder = left.lessonId?.orderNum || 0;
    const rightLessonOrder = right.lessonId?.orderNum || 0;
    if (leftLessonOrder !== rightLessonOrder) return leftLessonOrder - rightLessonOrder;
    return (left.orderNum || 0) - (right.orderNum || 0);
  });

  return exercises.map((exerciseDoc) => serializeExercise(exerciseDoc, exerciseDoc.lessonId));
}

async function createExercisePostgres(payload) {
  const result = await pool.query(
    'INSERT INTO exercises (lesson_id,type,question,options,correct_answer,explanation,order_num) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [
      payload.lesson_id,
      payload.type,
      payload.question,
      payload.options ? JSON.stringify(payload.options) : null,
      payload.correct_answer,
      payload.explanation,
      payload.order_num,
    ]
  );

  return result.rows[0];
}

async function createExerciseMongo(payload) {
  const { Lesson, Exercise } = await getMongoModels();
  const lessonDoc = await findLessonByIdentifier(Lesson, payload.lesson_id);

  if (!lessonDoc) return null;

  const exerciseDoc = await Exercise.create({
    legacyId: await getNextLegacyId(Exercise),
    lessonId: lessonDoc._id,
    type: payload.type,
    question: payload.question,
    options: normalizeOptions(payload.options),
    correctAnswer: payload.correct_answer,
    explanation: payload.explanation,
    orderNum: payload.order_num,
  });

  return serializeExercise(exerciseDoc, lessonDoc);
}

async function updateExercisePostgres(id, payload) {
  const result = await pool.query(
    'UPDATE exercises SET lesson_id=$1,type=$2,question=$3,options=$4,correct_answer=$5,explanation=$6,order_num=$7 WHERE id=$8 RETURNING *',
    [
      payload.lesson_id,
      payload.type,
      payload.question,
      payload.options ? JSON.stringify(payload.options) : null,
      payload.correct_answer,
      payload.explanation,
      payload.order_num,
      id,
    ]
  );

  return result.rows[0] || null;
}

async function updateExerciseMongo(id, payload) {
  const { Lesson, Exercise } = await getMongoModels();
  const lessonDoc = await findLessonByIdentifier(Lesson, payload.lesson_id);
  const criteria = buildRootIdCriteria(id);

  if (!lessonDoc || !criteria) return null;

  const exerciseDoc = await Exercise.findOneAndUpdate(
    criteria,
    {
      $set: {
        lessonId: lessonDoc._id,
        type: payload.type,
        question: payload.question,
        options: normalizeOptions(payload.options),
        correctAnswer: payload.correct_answer,
        explanation: payload.explanation,
        orderNum: payload.order_num,
      },
    },
    { new: true }
  ).lean();

  return exerciseDoc ? serializeExercise(exerciseDoc, lessonDoc) : null;
}

async function deleteExercisePostgres(id) {
  await pool.query('DELETE FROM exercises WHERE id=$1', [id]);
  return { success: true };
}

async function deleteExerciseMongo(id) {
  const { Exercise } = await getMongoModels();
  const criteria = buildRootIdCriteria(id);

  if (!criteria) return { success: true };

  await Exercise.deleteOne(criteria);
  return { success: true };
}

async function getAdminStatsPostgres() {
  const [levels, modules, units, lessons, exercises, users] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM levels'),
    pool.query('SELECT COUNT(*) FROM modules'),
    pool.query('SELECT COUNT(*) FROM units'),
    pool.query('SELECT COUNT(*) FROM lessons'),
    pool.query('SELECT COUNT(*) FROM exercises'),
    pool.query('SELECT COUNT(*) FROM users'),
  ]);

  return {
    levels: parseInt(levels.rows[0].count, 10),
    modules: parseInt(modules.rows[0].count, 10),
    units: parseInt(units.rows[0].count, 10),
    lessons: parseInt(lessons.rows[0].count, 10),
    exercises: parseInt(exercises.rows[0].count, 10),
    users: parseInt(users.rows[0].count, 10),
  };
}

async function getAdminStatsMongo() {
  const { User, Level, Module, Unit, Lesson, Exercise } = await getMongoModels();
  const [levels, modules, units, lessons, exercises, users] = await Promise.all([
    Level.countDocuments(),
    Module.countDocuments(),
    Unit.countDocuments(),
    Lesson.countDocuments(),
    Exercise.countDocuments(),
    User.countDocuments(),
  ]);

  return {
    levels,
    modules,
    units,
    lessons,
    exercises,
    users,
  };
}

async function getAdminLevels() {
  return isMongoProvider() ? getAdminLevelsMongo() : getAdminLevelsPostgres();
}

async function createLevel(payload) {
  return isMongoProvider() ? createLevelMongo(payload) : createLevelPostgres(payload);
}

async function updateLevel(id, payload) {
  return isMongoProvider() ? updateLevelMongo(id, payload) : updateLevelPostgres(id, payload);
}

async function deleteLevel(id) {
  return isMongoProvider() ? deleteLevelMongo(id) : deleteLevelPostgres(id);
}

async function getAdminModules() {
  return isMongoProvider() ? getAdminModulesMongo() : getAdminModulesPostgres();
}

async function createModule(payload) {
  return isMongoProvider() ? createModuleMongo(payload) : createModulePostgres(payload);
}

async function updateModule(id, payload) {
  return isMongoProvider() ? updateModuleMongo(id, payload) : updateModulePostgres(id, payload);
}

async function deleteModule(id) {
  return isMongoProvider() ? deleteModuleMongo(id) : deleteModulePostgres(id);
}

async function getAdminUnits() {
  return isMongoProvider() ? getAdminUnitsMongo() : getAdminUnitsPostgres();
}

async function createUnit(payload) {
  return isMongoProvider() ? createUnitMongo(payload) : createUnitPostgres(payload);
}

async function updateUnit(id, payload) {
  return isMongoProvider() ? updateUnitMongo(id, payload) : updateUnitPostgres(id, payload);
}

async function deleteUnit(id) {
  return isMongoProvider() ? deleteUnitMongo(id) : deleteUnitPostgres(id);
}

async function saveUnitLayout(id, payload) {
  return updateUnitLayout(id, payload);
}

async function saveUnitPathImage(id, imageUrl) {
  return uploadUnitPathImage(id, imageUrl);
}

async function removeUnitPathImage(id) {
  return deleteUnitPathImage(id);
}

async function createUnitLandmark(unitId, payload) {
  return createLandmark(unitId, payload);
}

async function updateUnitLandmark(unitId, landmarkId, payload) {
  return updateLandmark(unitId, landmarkId, payload);
}

async function deleteUnitLandmark(unitId, landmarkId) {
  return deleteLandmark(unitId, landmarkId);
}

async function getAdminLessons(unitId) {
  return isMongoProvider() ? getAdminLessonsMongo(unitId) : getAdminLessonsPostgres(unitId);
}

async function createLesson(payload) {
  return isMongoProvider() ? createLessonMongo(payload) : createLessonPostgres(payload);
}

async function updateLesson(id, payload) {
  return isMongoProvider() ? updateLessonMongo(id, payload) : updateLessonPostgres(id, payload);
}

async function deleteLesson(id) {
  return isMongoProvider() ? deleteLessonMongo(id) : deleteLessonPostgres(id);
}

async function getAdminExercises(lessonId) {
  return isMongoProvider() ? getAdminExercisesMongo(lessonId) : getAdminExercisesPostgres(lessonId);
}

async function createExercise(payload) {
  return isMongoProvider() ? createExerciseMongo(payload) : createExercisePostgres(payload);
}

async function updateExercise(id, payload) {
  return isMongoProvider() ? updateExerciseMongo(id, payload) : updateExercisePostgres(id, payload);
}

async function deleteExercise(id) {
  return isMongoProvider() ? deleteExerciseMongo(id) : deleteExercisePostgres(id);
}

async function getAdminStats() {
  return isMongoProvider() ? getAdminStatsMongo() : getAdminStatsPostgres();
}

module.exports = {
  getAdminLevels,
  createLevel,
  updateLevel,
  deleteLevel,
  getAdminModules,
  createModule,
  updateModule,
  deleteModule,
  getAdminUnits,
  createUnit,
  updateUnit,
  deleteUnit,
  saveUnitLayout,
  saveUnitPathImage,
  removeUnitPathImage,
  createUnitLandmark,
  updateUnitLandmark,
  deleteUnitLandmark,
  getAdminLessons,
  createLesson,
  updateLesson,
  deleteLesson,
  getAdminExercises,
  createExercise,
  updateExercise,
  deleteExercise,
  getAdminStats,
};
