const pool = require('../config/db');
const { getDbProvider, isMongoProvider } = require('../config/dbProvider');

let mongooseModule = null;

function parseLegacyId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getMongooseModule() {
  if (!mongooseModule) {
    const { getMongoose } = require('../config/mongo');
    mongooseModule = getMongoose();
  }

  return mongooseModule;
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
  const levelId = moduleDoc.levelId?._id || moduleDoc.levelId;
  return {
    id: moduleDoc.legacyId ?? String(moduleDoc._id),
    level_id: levelDoc?.legacyId ?? String(levelId),
    title: moduleDoc.title,
    title_kz: moduleDoc.titleKz,
    description: moduleDoc.description || '',
    order_num: moduleDoc.orderNum,
    required_xp: moduleDoc.requiredXp || 0,
    level_code: levelDoc?.code,
    level_name: levelDoc?.name,
  };
}

function serializeUnit(unitDoc, progressDoc) {
  return {
    id: unitDoc.legacyId ?? String(unitDoc._id),
    module_id: unitDoc.moduleId?.legacyId ?? String(unitDoc.moduleId?._id || unitDoc.moduleId),
    title: unitDoc.title,
    title_kz: unitDoc.titleKz,
    subtitle: unitDoc.subtitle || '',
    icon: unitDoc.icon || 'book',
    order_num: unitDoc.orderNum,
    lesson_count: unitDoc.lessonCount || 0,
    path_image_url: unitDoc.pathImageUrl || null,
    path_points: unitDoc.pathPoints || null,
    landmark_position: unitDoc.landmarkPosition || null,
    status: progressDoc?.status || 'locked',
    completed_lessons: progressDoc?.completedLessons || 0,
    stars: progressDoc?.stars || 0,
    landmarks: Array.isArray(unitDoc.landmarks)
      ? unitDoc.landmarks.map((landmark) => ({
          id: landmark.legacyId ?? String(landmark._id),
          image_url: landmark.imageUrl,
          alt_text: landmark.altText,
          position: landmark.position || null,
        }))
      : [],
  };
}

async function getMongoModels() {
  const Level = require('../models/Level');
  const Module = require('../models/Module');
  const Unit = require('../models/Unit');
  const UserUnitProgress = require('../models/UserUnitProgress');
  const { getMongoose } = require('../config/mongo');
  return {
    Level,
    Module,
    Unit,
    UserUnitProgress,
    mongoose: getMongoose(),
  };
}

async function getLevelsWithModulesPostgres() {
  const levels = await pool.query('SELECT * FROM levels ORDER BY order_num');
  const modules = await pool.query('SELECT * FROM modules ORDER BY order_num');

  return levels.rows.map((level) => ({
    ...level,
    modules: modules.rows.filter((moduleItem) => moduleItem.level_id === level.id),
  }));
}

async function getLevelsWithModulesMongo() {
  const { Level, Module } = await getMongoModels();
  const [levels, modules] = await Promise.all([
    Level.find().sort({ orderNum: 1 }).lean(),
    Module.find().sort({ orderNum: 1 }).populate('levelId').lean(),
  ]);

  return levels.map((level) => {
    const serializedLevel = serializeLevel(level);
    return {
      ...serializedLevel,
      modules: modules
        .filter((moduleItem) => String(moduleItem.levelId?._id || moduleItem.levelId) === String(level._id))
        .map((moduleItem) => serializeModule(moduleItem, moduleItem.levelId)),
    };
  });
}

async function getModuleByIdForUserPostgres(moduleId, userId) {
  const moduleResult = await pool.query(
    `SELECT m.*, l.code as level_code, l.name as level_name 
     FROM modules m 
     JOIN levels l ON m.level_id = l.id 
     WHERE m.id = $1`,
    [moduleId]
  );

  if (moduleResult.rows.length === 0) {
    return null;
  }

  const units = await pool.query(
    `SELECT u.*, 
            COALESCE(up.status, 'locked') as status,
            COALESCE(up.completed_lessons, 0) as completed_lessons,
            COALESCE(up.stars, 0) as stars,
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
     LEFT JOIN user_progress up ON u.id = up.unit_id AND up.user_id = $1
     LEFT JOIN landmarks lm ON lm.unit_id = u.id
     WHERE u.module_id = $2
     GROUP BY u.id
     ORDER BY u.order_num`,
    [userId, moduleId]
  );

  const result = {
    ...moduleResult.rows[0],
    units: units.rows,
  };

  applyCurrentUnitFallback(result.units);
  return result;
}

function buildMongoUserProgressCriteria(userId) {
  const criteria = [];
  const legacyUserId = parseLegacyId(userId);
  if (legacyUserId != null) {
    criteria.push({ legacyUserId });
  }

  const { Types } = getMongooseModule();
  if (Types.ObjectId.isValid(String(userId))) {
    criteria.push({ userId: new Types.ObjectId(String(userId)) });
  }

  if (criteria.length === 0) {
    return null;
  }

  return criteria.length === 1 ? criteria[0] : { $or: criteria };
}

async function findMongoModuleByIdentifier(Module, mongoose, moduleId) {
  const legacyId = parseLegacyId(moduleId);
  if (legacyId != null) {
    const legacyDoc = await Module.findOne({ legacyId }).populate('levelId').lean();
    if (legacyDoc) return legacyDoc;
  }

  if (mongoose.Types.ObjectId.isValid(String(moduleId))) {
    return Module.findById(moduleId).populate('levelId').lean();
  }

  return null;
}

async function getModuleByIdForUserMongo(moduleId, userId) {
  const { Module, Unit, UserUnitProgress, mongoose } = await getMongoModels();
  const moduleDoc = await findMongoModuleByIdentifier(Module, mongoose, moduleId);

  if (!moduleDoc) {
    return null;
  }

  const units = await Unit.find({ moduleId: moduleDoc._id }).sort({ orderNum: 1 }).lean();
  const userProgressCriteria = buildMongoUserProgressCriteria(userId);
  const unitObjectIds = units.map((unit) => unit._id);
  const legacyUnitIds = units.map((unit) => unit.legacyId).filter((value) => value != null);
  const unitCriteria = [];
  if (unitObjectIds.length > 0) {
    unitCriteria.push({ unitId: { $in: unitObjectIds } });
  }
  if (legacyUnitIds.length > 0) {
    unitCriteria.push({ legacyUnitId: { $in: legacyUnitIds } });
  }

  const progressDocs = userProgressCriteria
    ? await UserUnitProgress.find(
        unitCriteria.length > 0
          ? {
              $and: [
                userProgressCriteria,
                unitCriteria.length === 1 ? unitCriteria[0] : { $or: unitCriteria },
              ],
            }
          : userProgressCriteria
      ).lean()
    : [];

  const progressByUnitId = new Map();
  for (const progress of progressDocs) {
    if (progress.legacyUnitId != null) {
      progressByUnitId.set(`legacy:${progress.legacyUnitId}`, progress);
    }
    if (progress.unitId) {
      progressByUnitId.set(`mongo:${String(progress.unitId)}`, progress);
    }
  }

  const serializedUnits = units.map((unit) => {
    const progress = progressByUnitId.get(`legacy:${unit.legacyId}`) || progressByUnitId.get(`mongo:${String(unit._id)}`) || null;
    return serializeUnit(unit, progress);
  });

  applyCurrentUnitFallback(serializedUnits);

  return {
    ...serializeModule(moduleDoc, moduleDoc.levelId),
    units: serializedUnits,
  };
}

async function getNextModulePreviewPostgres(moduleId) {
  const current = await pool.query('SELECT * FROM modules WHERE id = $1', [moduleId]);
  if (current.rows.length === 0) {
    return undefined;
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
    return null;
  }

  const units = await pool.query(
    'SELECT title_kz FROM units WHERE module_id = $1 ORDER BY order_num LIMIT 3',
    [next.rows[0].id]
  );

  return {
    ...next.rows[0],
    preview_units: units.rows.map((unit) => unit.title_kz),
  };
}

async function getNextModulePreviewMongo(moduleId) {
  const { Level, Module, Unit, mongoose } = await getMongoModels();
  const currentModule = await findMongoModuleByIdentifier(Module, mongoose, moduleId);
  if (!currentModule) {
    return undefined;
  }

  const [levels, modules] = await Promise.all([
    Level.find().sort({ orderNum: 1 }).lean(),
    Module.find().populate('levelId').lean(),
  ]);

  const levelOrder = new Map(levels.map((level) => [String(level._id), level.orderNum]));
  const sortedModules = modules.sort((left, right) => {
    const leftLevelOrder = levelOrder.get(String(left.levelId?._id || left.levelId)) || 0;
    const rightLevelOrder = levelOrder.get(String(right.levelId?._id || right.levelId)) || 0;
    if (leftLevelOrder !== rightLevelOrder) return leftLevelOrder - rightLevelOrder;
    return (left.orderNum || 0) - (right.orderNum || 0);
  });

  const currentIndex = sortedModules.findIndex((moduleItem) => String(moduleItem._id) === String(currentModule._id));
  if (currentIndex === -1 || currentIndex === sortedModules.length - 1) {
    return null;
  }

  const nextModule = sortedModules[currentIndex + 1];
  const previewUnits = await Unit.find({ moduleId: nextModule._id }).sort({ orderNum: 1 }).limit(3).lean();

  return {
    ...serializeModule(nextModule, nextModule.levelId),
    preview_units: previewUnits.map((unit) => unit.titleKz),
  };
}

function applyCurrentUnitFallback(units) {
  const allLocked = units.every((unit) => unit.status === 'locked');
  if (allLocked && units.length > 0) {
    units[0].status = 'current';
  }

  for (let index = 0; index < units.length - 1; index += 1) {
    if (units[index].status === 'completed' && units[index + 1].status === 'locked') {
      units[index + 1].status = 'current';
      break;
    }
  }
}

async function getLevelsWithModules() {
  return isMongoProvider() ? getLevelsWithModulesMongo() : getLevelsWithModulesPostgres();
}

async function getModuleByIdForUser(moduleId, userId) {
  return isMongoProvider() ? getModuleByIdForUserMongo(moduleId, userId) : getModuleByIdForUserPostgres(moduleId, userId);
}

async function getNextModulePreview(moduleId) {
  return isMongoProvider() ? getNextModulePreviewMongo(moduleId) : getNextModulePreviewPostgres(moduleId);
}

module.exports = {
  getDbProvider,
  getLevelsWithModules,
  getModuleByIdForUser,
  getNextModulePreview,
};
