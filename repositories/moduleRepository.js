const { getDbProvider } = require('../config/dbProvider');

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

function serializeUnit(unitDoc, progressDoc, actualLessonCount = 0) {
  const storedCount = unitDoc.lessonCount || 0;
  const lesson_count = Math.max(storedCount, actualLessonCount || 0);
  const rawCompleted = progressDoc?.completedLessons || 0;
  const completed_lessons = lesson_count > 0 ? Math.min(rawCompleted, lesson_count) : rawCompleted;

  return {
    id: unitDoc.legacyId ?? String(unitDoc._id),
    module_id: unitDoc.moduleId?.legacyId ?? String(unitDoc.moduleId?._id || unitDoc.moduleId),
    title: unitDoc.title,
    title_kz: unitDoc.titleKz,
    subtitle: unitDoc.subtitle || '',
    icon: unitDoc.icon || 'book',
    order_num: unitDoc.orderNum,
    lesson_count,
    path_image_url: unitDoc.pathImageUrl || null,
    path_points: unitDoc.pathPoints || null,
    landmark_position: unitDoc.landmarkPosition || null,
    status: progressDoc?.status || 'locked',
    completed_lessons,
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
  const Lesson = require('../models/Lesson');
  const UserUnitProgress = require('../models/UserUnitProgress');
  const { getMongoose } = require('../config/mongo');
  return {
    Level,
    Module,
    Unit,
    Lesson,
    UserUnitProgress,
    mongoose: getMongoose(),
  };
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
  const { Module, Unit, Lesson, UserUnitProgress, mongoose } = await getMongoModels();
  const moduleDoc = await findMongoModuleByIdentifier(Module, mongoose, moduleId);

  if (!moduleDoc) {
    return null;
  }

  const units = await Unit.find({ moduleId: moduleDoc._id }).sort({ orderNum: 1 }).lean();
  const unitObjectIds = units.map((unit) => unit._id);
  const lessonCountByUnit = new Map();
  if (unitObjectIds.length > 0) {
    const counts = await Lesson.aggregate([
      { $match: { unitId: { $in: unitObjectIds } } },
      { $group: { _id: '$unitId', n: { $sum: 1 } } },
    ]);
    for (const row of counts) {
      if (row._id) {
        lessonCountByUnit.set(String(row._id), row.n || 0);
      }
    }
  }
  const userProgressCriteria = buildMongoUserProgressCriteria(userId);
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
  const hasAnyUnitProgress = userProgressCriteria
    ? await UserUnitProgress.exists(userProgressCriteria)
    : false;

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
    const actualLessonCount = lessonCountByUnit.get(String(unit._id)) || 0;
    return serializeUnit(unit, progress, actualLessonCount);
  });

  if (!hasAnyUnitProgress) {
    applyCurrentUnitFallback(serializedUnits);
  }

  return {
    ...serializeModule(moduleDoc, moduleDoc.levelId),
    units: serializedUnits,
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
  return getLevelsWithModulesMongo();
}

async function getModuleByIdForUser(moduleId, userId) {
  return getModuleByIdForUserMongo(moduleId, userId);
}

async function getNextModulePreview(moduleId) {
  return getNextModulePreviewMongo(moduleId);
}

module.exports = {
  getDbProvider,
  getLevelsWithModules,
  getModuleByIdForUser,
  getNextModulePreview,
};
