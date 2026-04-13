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
    content: lessonDoc.content || null,
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

async function getAdminLevelsMongo() {
  const { Level } = await getMongoModels();
  const levels = await Level.find().sort({ orderNum: 1 }).lean();
  return levels.map(serializeLevel);
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
  return updateUnitLayoutMongo(id, payload);
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
  return uploadUnitPathImageMongo(id, imageUrl);
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
  return deleteUnitPathImageMongo(id);
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
  return createLandmarkMongo(unitId, payload);
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
  return updateLandmarkMongo(unitId, landmarkId, payload);
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
  return deleteLandmarkMongo(unitId, landmarkId);
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
    content: payload.content || null,
  });

  await updateUnitLessonCount(Unit, Lesson, unitDoc);

  return serializeLesson(lessonDoc, unitDoc);
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
        content: payload.content !== undefined ? (payload.content || null) : undefined,
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

async function deleteExerciseMongo(id) {
  const { Exercise } = await getMongoModels();
  const criteria = buildRootIdCriteria(id);

  if (!criteria) return { success: true };

  await Exercise.deleteOne(criteria);
  return { success: true };
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
  return getAdminLevelsMongo();
}

async function createLevel(payload) {
  return createLevelMongo(payload);
}

async function updateLevel(id, payload) {
  return updateLevelMongo(id, payload);
}

async function deleteLevel(id) {
  return deleteLevelMongo(id);
}

async function getAdminModules() {
  return getAdminModulesMongo();
}

async function createModule(payload) {
  return createModuleMongo(payload);
}

async function updateModule(id, payload) {
  return updateModuleMongo(id, payload);
}

async function deleteModule(id) {
  return deleteModuleMongo(id);
}

async function getAdminUnits() {
  return getAdminUnitsMongo();
}

async function createUnit(payload) {
  return createUnitMongo(payload);
}

async function updateUnit(id, payload) {
  return updateUnitMongo(id, payload);
}

async function deleteUnit(id) {
  return deleteUnitMongo(id);
}

async function saveUnitLayout(id, payload) {
  return updateUnitLayoutMongo(id, payload);
}

async function saveUnitPathImage(id, imageUrl) {
  return uploadUnitPathImageMongo(id, imageUrl);
}

async function removeUnitPathImage(id) {
  return deleteUnitPathImageMongo(id);
}

async function createUnitLandmark(unitId, payload) {
  return createLandmarkMongo(unitId, payload);
}

async function updateUnitLandmark(unitId, landmarkId, payload) {
  return updateLandmarkMongo(unitId, landmarkId, payload);
}

async function deleteUnitLandmark(unitId, landmarkId) {
  return deleteLandmarkMongo(unitId, landmarkId);
}

async function getAdminLessons(unitId) {
  return getAdminLessonsMongo(unitId);
}

async function createLesson(payload) {
  return createLessonMongo(payload);
}

async function updateLesson(id, payload) {
  return updateLessonMongo(id, payload);
}

async function deleteLesson(id) {
  return deleteLessonMongo(id);
}

async function getAdminExercises(lessonId) {
  return getAdminExercisesMongo(lessonId);
}

async function createExercise(payload) {
  return createExerciseMongo(payload);
}

async function updateExercise(id, payload) {
  return updateExerciseMongo(id, payload);
}

async function deleteExercise(id) {
  return deleteExerciseMongo(id);
}

async function getAdminStats() {
  return getAdminStatsMongo();
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
