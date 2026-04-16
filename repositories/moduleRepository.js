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
  const User = require('../models/User');
  const { getMongoose } = require('../config/mongo');
  return {
    Level,
    Module,
    Unit,
    Lesson,
    UserUnitProgress,
    User,
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

/** Match progress rows for this user whether they were keyed by Mongo userId, legacy user id, or both. */
function buildMongoUserProgressCriteriaFromUserDoc(userDoc) {
  if (!userDoc) {
    return null;
  }

  const parts = [];
  if (userDoc._id) {
    parts.push({ userId: userDoc._id });
  }
  const legacy = userDoc.legacyId != null ? parseLegacyId(userDoc.legacyId) : null;
  if (legacy != null) {
    parts.push({ legacyUserId: legacy });
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.length === 1 ? parts[0] : { $or: parts };
}

function scoreUnitProgressDoc(doc) {
  const statusRank = doc.status === 'completed' ? 3 : doc.status === 'current' ? 2 : 1;
  return statusRank * 1e6 + (doc.completedLessons || 0) * 1e3 + (doc.stars || 0);
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
  const { Module, Unit, Lesson, UserUnitProgress, User, mongoose } = await getMongoModels();
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
  // Only treat as "has progress" when it matches *this module's* units. Otherwise users
  // with orphaned rows (after admin deleted/recreated units) would skip the unlock fallback
  // and every unit would stay locked — lessons never load (403).
  const hasAnyUnitProgress = progressDocs.length > 0;

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

  const everyLocked = serializedUnits.length > 0 && serializedUnits.every((u) => u.status === 'locked');
  if (!hasAnyUnitProgress || everyLocked) {
    applyCurrentUnitFallback(serializedUnits);
    await persistCurrentUnitsFromSerialized(userId, units, serializedUnits, UserUnitProgress, User);
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

function findUnitLeanBySerializedId(units, serializedId) {
  const num = Number(serializedId);
  if (Number.isInteger(num) && num > 0) {
    const byLegacy = units.find((u) => u.legacyId === num);
    if (byLegacy) return byLegacy;
  }

  const { Types } = getMongooseModule();
  const sid = String(serializedId);
  if (Types.ObjectId.isValid(sid)) {
    return units.find((u) => String(u._id) === sid) || null;
  }

  return null;
}

async function persistCurrentUnitsFromSerialized(userId, unitsLean, serializedUnits, UserUnitProgress, User) {
  const userCriteria = buildMongoUserProgressCriteria(userId);
  if (!userCriteria) {
    return;
  }

  const userDoc = await User.findOne(userCriteria).lean();
  if (!userDoc) {
    return;
  }

  const userMatch = buildMongoUserProgressCriteriaFromUserDoc(userDoc);
  if (!userMatch) {
    return;
  }

  const currentSerialized = serializedUnits.filter((u) => u.status === 'current');
  for (const su of currentSerialized) {
    const unitLean = findUnitLeanBySerializedId(unitsLean, su.id);
    if (!unitLean) {
      continue;
    }

    const unitOr = [];
    if (unitLean._id) {
      unitOr.push({ unitId: unitLean._id });
    }
    if (unitLean.legacyId != null) {
      unitOr.push({ legacyUnitId: unitLean.legacyId });
    }
    if (unitOr.length === 0) {
      continue;
    }

    const unitMatch = unitOr.length === 1 ? unitOr[0] : { $or: unitOr };
    const allForUnit = await UserUnitProgress.find({ $and: [userMatch, unitMatch] }).lean();
    if (allForUnit.some((row) => row.status === 'completed')) {
      continue;
    }

    if (allForUnit.length > 1) {
      const keep = [...allForUnit].sort((a, b) => scoreUnitProgressDoc(b) - scoreUnitProgressDoc(a))[0];
      await UserUnitProgress.deleteMany({
        _id: {
          $in: allForUnit.filter((row) => String(row._id) !== String(keep._id)).map((row) => row._id),
        },
      });
    }

    const lessonCount = su.lesson_count || 0;
    const completedLessons = lessonCount > 0 ? Math.min(su.completed_lessons || 0, lessonCount) : su.completed_lessons || 0;
    const stars = Math.min(Math.max(su.stars || 0, 0), 3);

    const setPayload = {
      userId: userDoc._id,
      legacyUserId: userDoc.legacyId ?? null,
      unitId: unitLean._id,
      legacyUnitId: unitLean.legacyId ?? null,
      status: 'current',
      completedLessons,
      stars,
    };

    const [kept] = await UserUnitProgress.find({ $and: [userMatch, unitMatch] }).lean();
    if (kept) {
      await UserUnitProgress.updateOne({ _id: kept._id }, { $set: setPayload });
    } else {
      await UserUnitProgress.updateOne(
        { userId: userDoc._id, unitId: unitLean._id },
        { $set: setPayload },
        { upsert: true }
      );
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
