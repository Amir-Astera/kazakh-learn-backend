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

async function getMongoModels() {
  const User = require('../models/User');
  const Level = require('../models/Level');
  const Unit = require('../models/Unit');
  const Module = require('../models/Module');
  const Lesson = require('../models/Lesson');
  const Exercise = require('../models/Exercise');
  const UserLessonProgress = require('../models/UserLessonProgress');
  const UserUnitProgress = require('../models/UserUnitProgress');
  const UserSkill = require('../models/UserSkill');
  const UserQuest = require('../models/UserQuest');

  return {
    User,
    Level,
    Unit,
    Module,
    Lesson,
    Exercise,
    UserLessonProgress,
    UserUnitProgress,
    UserSkill,
    UserQuest,
    mongoose: getMongooseModule(),
  };
}

function buildUserCriteriaFromUserDoc(userDoc) {
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

function unitDocMatches(a, b) {
  if (!a || !b) {
    return false;
  }
  if (String(a._id) === String(b._id)) {
    return true;
  }
  if (a.legacyId != null && b.legacyId != null && a.legacyId === b.legacyId) {
    return true;
  }
  return false;
}

async function getGloballyOrderedUnitsLean() {
  const { Level, Module, Unit } = await getMongoModels();
  const [levels, modules, units] = await Promise.all([
    Level.find().sort({ orderNum: 1 }).lean(),
    Module.find().lean(),
    Unit.find().lean(),
  ]);

  const levelOrder = new Map(levels.map((level) => [String(level._id), level.orderNum ?? 0]));
  const modulesSorted = [...modules].sort((a, b) => {
    const la = levelOrder.get(String(a.levelId)) ?? 0;
    const lb = levelOrder.get(String(b.levelId)) ?? 0;
    if (la !== lb) {
      return la - lb;
    }
    return (a.orderNum || 0) - (b.orderNum || 0);
  });

  const orderedUnits = [];
  for (const mod of modulesSorted) {
    const modUnits = units
      .filter((u) => String(u.moduleId) === String(mod._id))
      .sort((a, b) => (a.orderNum || 0) - (b.orderNum || 0));
    for (const u of modUnits) {
      orderedUnits.push(u);
    }
  }

  return orderedUnits;
}

async function tryUnlockFromGlobalPriorUnit(userId, unitDoc) {
  const { User, UserUnitProgress } = await getMongoModels();
  const userDoc = await findUserByIdentifier(User, userId);
  if (!userDoc) {
    return;
  }

  const userMatch = buildUserCriteriaFromUserDoc(userDoc);
  if (!userMatch) {
    return;
  }

  const chain = await getGloballyOrderedUnitsLean();
  const idx = chain.findIndex((u) => unitDocMatches(u, unitDoc));
  if (idx === -1) {
    return;
  }

  if (idx === 0) {
    const unitCrit = buildLinkedCriteria('unitId', 'legacyUnitId', [unitDoc._id], [unitDoc.legacyId]);
    await UserUnitProgress.updateOne(
      combineCriteria(userMatch, unitCrit),
      {
        $set: {
          userId: userDoc._id,
          legacyUserId: userDoc.legacyId ?? null,
          unitId: unitDoc._id,
          legacyUnitId: unitDoc.legacyId ?? null,
          status: 'current',
          completedLessons: 0,
          stars: 0,
        },
      },
      { upsert: true }
    );
    return;
  }

  const prev = chain[idx - 1];
  const prevCrit = buildLinkedCriteria('unitId', 'legacyUnitId', [prev._id], [prev.legacyId]);
  const prevProg = await UserUnitProgress.findOne(combineCriteria(userMatch, prevCrit)).lean();
  if (prevProg?.status !== 'completed') {
    return;
  }

  const unitCrit = buildLinkedCriteria('unitId', 'legacyUnitId', [unitDoc._id], [unitDoc.legacyId]);
  await UserUnitProgress.updateOne(
    combineCriteria(userMatch, unitCrit),
    {
      $set: {
        userId: userDoc._id,
        legacyUserId: userDoc.legacyId ?? null,
        unitId: unitDoc._id,
        legacyUnitId: unitDoc.legacyId ?? null,
        status: 'current',
      },
      $setOnInsert: {
        completedLessons: 0,
        stars: 0,
      },
    },
    { upsert: true }
  );
}

async function findFirstUnitOfNextModuleGlobally(currentModuleId) {
  const { Module, Unit, Level } = await getMongoModels();
  const currentModule = await Module.findById(currentModuleId).lean();
  if (!currentModule) {
    return null;
  }

  const [levels, modules] = await Promise.all([
    Level.find().sort({ orderNum: 1 }).lean(),
    Module.find().lean(),
  ]);

  const levelOrder = new Map(levels.map((level) => [String(level._id), level.orderNum ?? 0]));
  const sorted = [...modules].sort((a, b) => {
    const la = levelOrder.get(String(a.levelId)) ?? 0;
    const lb = levelOrder.get(String(b.levelId)) ?? 0;
    if (la !== lb) {
      return la - lb;
    }
    return (a.orderNum || 0) - (b.orderNum || 0);
  });

  const curIdx = sorted.findIndex((m) => String(m._id) === String(currentModule._id));
  if (curIdx === -1 || curIdx + 1 >= sorted.length) {
    return null;
  }

  const nextMod = sorted[curIdx + 1];
  return Unit.findOne({ moduleId: nextMod._id }).sort({ orderNum: 1 }).lean();
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

function buildLinkedCriteria(objectField, legacyField, objectIds, legacyIds) {
  const conditions = [];
  if (Array.isArray(objectIds) && objectIds.length > 0) {
    conditions.push({ [objectField]: { $in: objectIds.filter(Boolean) } });
  }
  if (Array.isArray(legacyIds) && legacyIds.length > 0) {
    conditions.push({ [legacyField]: { $in: legacyIds.filter((value) => value != null) } });
  }

  if (conditions.length === 0) {
    return null;
  }

  return conditions.length === 1 ? conditions[0] : { $or: conditions };
}

function combineCriteria(...criteriaList) {
  const filtered = criteriaList.filter(Boolean);
  if (filtered.length === 0) {
    return {};
  }

  return filtered.length === 1 ? filtered[0] : { $and: filtered };
}

function clampScore(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeMistakes(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.max(0, Math.round(numeric));
}

function calculateLessonXp(baseXp, score, mistakes) {
  if (score >= 95 && mistakes === 0) return baseXp;
  if (score >= 85 && mistakes <= 1) return Math.max(1, Math.round(baseXp * 0.9));
  if (score >= 70 && mistakes <= 3) return Math.max(1, Math.round(baseXp * 0.75));
  return Math.max(1, Math.round(baseXp * 0.6));
}

/** Base XP = lesson xpReward from content (no curriculum-wide scaling). */
function baseXpFromLessonReward(lessonDoc) {
  const raw = Number(lessonDoc?.xpReward);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  return 10;
}

async function findUserByIdentifier(User, userId) {
  const criteria = buildRootIdCriteria(userId);
  if (!criteria) {
    return null;
  }

  return User.findOne(criteria).lean();
}

async function findUnitByIdentifier(Unit, mongoose, unitId) {
  const legacyId = parseLegacyId(unitId);
  if (legacyId != null) {
    const legacyDoc = await Unit.findOne({ legacyId }).lean();
    if (legacyDoc) return legacyDoc;
  }

  if (mongoose.Types.ObjectId.isValid(String(unitId))) {
    return Unit.findById(unitId).lean();
  }

  return null;
}

async function findLessonByIdentifier(Lesson, mongoose, lessonId) {
  const legacyId = parseLegacyId(lessonId);
  if (legacyId != null) {
    const legacyDoc = await Lesson.findOne({ legacyId }).lean();
    if (legacyDoc) return legacyDoc;
  }

  if (mongoose.Types.ObjectId.isValid(String(lessonId))) {
    return Lesson.findById(lessonId).lean();
  }

  return null;
}

function serializeLesson(lessonDoc, progressDoc) {
  return {
    id: lessonDoc.legacyId ?? String(lessonDoc._id),
    unit_id: lessonDoc.unitId?.legacyId ?? String(lessonDoc.unitId?._id || lessonDoc.unitId),
    title: lessonDoc.title,
    type: lessonDoc.type,
    xp_reward: lessonDoc.xpReward || 0,
    order_num: lessonDoc.orderNum,
    content: lessonDoc.content || null,
    completed: progressDoc?.completed || false,
    score: progressDoc?.score || 0,
    mistakes: progressDoc?.mistakes || 0,
  };
}

function serializeExercise(exerciseDoc) {
  return {
    id: exerciseDoc.legacyId ?? String(exerciseDoc._id),
    lesson_id: exerciseDoc.lessonId?.legacyId ?? String(exerciseDoc.lessonId?._id || exerciseDoc.lessonId),
    type: exerciseDoc.type,
    question: exerciseDoc.question,
    question_audio: exerciseDoc.questionAudio || null,
    options: exerciseDoc.options,
    correct_answer: exerciseDoc.correctAnswer,
    explanation: exerciseDoc.explanation,
    order_num: exerciseDoc.orderNum,
  };
}

async function getUnitProgressForUser(UserUnitProgress, userId, unitDoc) {
  const { User } = await getMongoModels();
  const userDoc = await findUserByIdentifier(User, userId);
  if (!userDoc) {
    return null;
  }

  const userCriteria = buildUserCriteriaFromUserDoc(userDoc);
  if (!userCriteria || !unitDoc) {
    return null;
  }

  const unitCriteria = buildLinkedCriteria('unitId', 'legacyUnitId', [unitDoc._id], [unitDoc.legacyId]);
  return UserUnitProgress.findOne(combineCriteria(userCriteria, unitCriteria)).lean();
}

async function assertUnitAccessForUser(userId, unitDoc) {
  const { UserUnitProgress } = await getMongoModels();
  let progressDoc = await getUnitProgressForUser(UserUnitProgress, userId, unitDoc);
  if (!progressDoc || !['current', 'completed'].includes(progressDoc.status)) {
    await tryUnlockFromGlobalPriorUnit(userId, unitDoc);
    progressDoc = await getUnitProgressForUser(UserUnitProgress, userId, unitDoc);
  }
  if (!progressDoc || !['current', 'completed'].includes(progressDoc.status)) {
    const error = new Error('UNIT_LOCKED');
    error.code = 'UNIT_LOCKED';
    throw error;
  }

  return progressDoc;
}

async function getLessonsForUnitMongo(unitId, userId) {
  const { Unit, Lesson, UserLessonProgress, User, mongoose } = await getMongoModels();
  const unitDoc = await findUnitByIdentifier(Unit, mongoose, unitId);
  if (!unitDoc) {
    return [];
  }

  await assertUnitAccessForUser(userId, unitDoc);

  const lessons = await Lesson.find({ unitId: unitDoc._id }).sort({ orderNum: 1 }).lean();
  const userDoc = await findUserByIdentifier(User, userId);
  const userCriteria = buildUserCriteriaFromUserDoc(userDoc);
  const lessonObjectIds = lessons.map((lesson) => lesson._id);
  const legacyLessonIds = lessons.map((lesson) => lesson.legacyId).filter((value) => value != null);
  const lessonCriteria = buildLinkedCriteria('lessonId', 'legacyLessonId', lessonObjectIds, legacyLessonIds);

  const progressDocs = userCriteria
    ? await UserLessonProgress.find(combineCriteria(userCriteria, lessonCriteria)).lean()
    : [];

  const progressByLesson = new Map();
  for (const progress of progressDocs) {
    if (progress.legacyLessonId != null) {
      progressByLesson.set(`legacy:${progress.legacyLessonId}`, progress);
    }
    if (progress.lessonId) {
      progressByLesson.set(`mongo:${String(progress.lessonId)}`, progress);
    }
  }

  return lessons.map((lesson) => {
    const progress = progressByLesson.get(`legacy:${lesson.legacyId}`) || progressByLesson.get(`mongo:${String(lesson._id)}`) || null;
    return serializeLesson(lesson, progress);
  });
}

async function getLessonByIdWithExercisesMongo(lessonId, userId) {
  const { Lesson, Exercise, Unit, mongoose } = await getMongoModels();
  const lesson = await findLessonByIdentifier(Lesson, mongoose, lessonId);
  if (!lesson) {
    return null;
  }

  const unitDoc = await Unit.findById(lesson.unitId).lean();
  if (!unitDoc) {
    return null;
  }

  await assertUnitAccessForUser(userId, unitDoc);

  const exerciseDocs = await Exercise.find({ lessonId: lesson._id }).sort({ orderNum: 1 }).lean();

  return {
    ...serializeLesson(lesson, null),
    exercises: exerciseDocs.map(serializeExercise),
  };
}

async function getExerciseAnswerContextMongo(lessonId, exerciseId, userId) {
  const { Lesson, Exercise, Unit, mongoose } = await getMongoModels();
  const lesson = await findLessonByIdentifier(Lesson, mongoose, lessonId);
  if (!lesson) {
    return null;
  }

  const unitDoc = await Unit.findById(lesson.unitId).lean();
  if (!unitDoc) {
    return null;
  }

  await assertUnitAccessForUser(userId, unitDoc);

  const legacyExerciseId = parseLegacyId(exerciseId);
  if (legacyExerciseId != null) {
    const byLegacy = await Exercise.findOne({ legacyId: legacyExerciseId, lessonId: lesson._id }).lean();
    if (byLegacy) {
      return serializeExercise(byLegacy);
    }
  }

  if (mongoose.Types.ObjectId.isValid(String(exerciseId))) {
    const byObjectId = await Exercise.findOne({ _id: exerciseId, lessonId: lesson._id }).lean();
    if (byObjectId) {
      return serializeExercise(byObjectId);
    }
  }

  return null;
}

async function completeLessonForUserMongo(lessonId, userId, payload) {
  const { User, Unit, Lesson, UserLessonProgress, UserUnitProgress, UserSkill, UserQuest, mongoose } = await getMongoModels();
  const normalizedScore = clampScore(payload.score ?? 100);
  const normalizedMistakes = normalizeMistakes(payload.mistakes ?? 0);
  const normalizedTimeSpent = Math.max(0, Math.round(Number(payload.timeSpent) || 0));

  const [userDoc, lessonDoc] = await Promise.all([
    findUserByIdentifier(User, userId),
    findLessonByIdentifier(Lesson, mongoose, lessonId),
  ]);

  if (!userDoc || !lessonDoc) {
    return null;
  }

  const unitDoc = await Unit.findById(lessonDoc.unitId).lean();
  if (!unitDoc) {
    return null;
  }

  await assertUnitAccessForUser(userId, unitDoc);

  const userCriteria = buildUserCriteriaFromUserDoc(userDoc);
  const lessonProgressCriteria = buildLinkedCriteria('lessonId', 'legacyLessonId', [lessonDoc._id], [lessonDoc.legacyId]);
  const existingProgress = await UserLessonProgress.findOne(combineCriteria(userCriteria, lessonProgressCriteria)).lean();

  const baseXp = baseXpFromLessonReward(lessonDoc);
  const awardedLessonXp = calculateLessonXp(baseXp, normalizedScore, normalizedMistakes);
  const previousLessonXp = existingProgress?.xpEarned || 0;
  const xpDelta = Math.max(0, awardedLessonXp - previousLessonXp);

  await UserLessonProgress.updateOne(
    combineCriteria(userCriteria, lessonProgressCriteria),
    {
      $set: {
        userId: userDoc._id,
        legacyUserId: userDoc.legacyId,
        lessonId: lessonDoc._id,
        legacyLessonId: lessonDoc.legacyId,
        completed: true,
        score: normalizedScore,
        mistakes: normalizedMistakes,
        timeSpent: normalizedTimeSpent,
        completedAt: new Date(),
      },
      $max: {
        xpEarned: awardedLessonXp,
      },
    },
    { upsert: true }
  );

  if (xpDelta > 0) {
    await User.updateOne(
      { _id: userDoc._id },
      {
        $inc: { xp: xpDelta },
        $set: { lastActivity: new Date() },
      }
    );
  } else {
    await User.updateOne(
      { _id: userDoc._id },
      {
        $set: { lastActivity: new Date() },
      }
    );
  }

  const unitLessons = await Lesson.find({ unitId: unitDoc._id }).select('_id legacyId').lean();
  const completedLessonsCriteria = buildLinkedCriteria(
    'lessonId',
    'legacyLessonId',
    unitLessons.map((item) => item._id),
    unitLessons.map((item) => item.legacyId)
  );

  const completed = await UserLessonProgress.countDocuments(
    combineCriteria(userCriteria, completedLessonsCriteria, { completed: true })
  );

  const totalLessons = Math.max(unitLessons.length, unitDoc.lessonCount || 0);
  const completedCapped = Math.min(completed, totalLessons);
  const stars = completedCapped >= totalLessons ? 3 : completedCapped >= totalLessons * 0.6 ? 2 : 1;
  const status = completedCapped >= totalLessons ? 'completed' : 'current';
  const unitProgressCriteria = buildLinkedCriteria('unitId', 'legacyUnitId', [unitDoc._id], [unitDoc.legacyId]);

  await UserUnitProgress.updateOne(
    combineCriteria(userCriteria, unitProgressCriteria),
    {
      $set: {
        userId: userDoc._id,
        legacyUserId: userDoc.legacyId,
        unitId: unitDoc._id,
        legacyUnitId: unitDoc.legacyId,
        status,
        completedLessons: completedCapped,
        stars,
      },
    },
    { upsert: true }
  );

  if (status === 'completed') {
    const nextUnit = await Unit.findOne({
      moduleId: unitDoc.moduleId,
      orderNum: { $gt: unitDoc.orderNum },
    }).sort({ orderNum: 1 }).lean();

    if (nextUnit) {
      const nextUnitProgressCriteria = buildLinkedCriteria('unitId', 'legacyUnitId', [nextUnit._id], [nextUnit.legacyId]);
      const existingNextProgress = await UserUnitProgress.findOne(combineCriteria(userCriteria, nextUnitProgressCriteria)).lean();

      if (!existingNextProgress || existingNextProgress.status === 'locked') {
        await UserUnitProgress.updateOne(
          combineCriteria(userCriteria, nextUnitProgressCriteria),
          {
            $set: {
              userId: userDoc._id,
              legacyUserId: userDoc.legacyId,
              unitId: nextUnit._id,
              legacyUnitId: nextUnit.legacyId,
              status: 'current',
            },
            $setOnInsert: {
              completedLessons: 0,
              stars: 0,
            },
          },
          { upsert: true }
        );
      }
    } else {
      const firstNextModuleUnit = await findFirstUnitOfNextModuleGlobally(unitDoc.moduleId);
      if (firstNextModuleUnit) {
        const nextModUnitCrit = buildLinkedCriteria(
          'unitId',
          'legacyUnitId',
          [firstNextModuleUnit._id],
          [firstNextModuleUnit.legacyId]
        );
        const existingNextModProgress = await UserUnitProgress.findOne(combineCriteria(userCriteria, nextModUnitCrit)).lean();

        if (!existingNextModProgress || existingNextModProgress.status === 'locked') {
          await UserUnitProgress.updateOne(
            combineCriteria(userCriteria, nextModUnitCrit),
            {
              $set: {
                userId: userDoc._id,
                legacyUserId: userDoc.legacyId,
                unitId: firstNextModuleUnit._id,
                legacyUnitId: firstNextModuleUnit.legacyId,
                status: 'current',
              },
              $setOnInsert: {
                completedLessons: 0,
                stars: 0,
              },
            },
            { upsert: true }
          );
        }
      }
    }
  }

  const skillMap = {
    translation: 'vocabulary',
    choice: 'vocabulary',
    theory: 'vocabulary',
    grammar: 'grammar',
    sentence: 'grammar',
    listening: 'listening',
    speaking: 'speaking',
  };
  const skillName = skillMap[lessonDoc.type] || 'vocabulary';
  const previousSkillScore = existingProgress?.score || 0;
  const currentSkillIncrease = Math.max(1, Math.floor(normalizedScore / 20));
  const previousSkillIncrease = existingProgress?.completed ? Math.max(1, Math.floor(previousSkillScore / 20)) : 0;
  const skillIncreaseDelta = Math.max(0, currentSkillIncrease - previousSkillIncrease);

  if (skillIncreaseDelta > 0) {
    const skillDoc = await UserSkill.findOne(combineCriteria(userCriteria, { skillName })).lean();
    const nextProgress = Math.min(100, (skillDoc?.progress || 0) + skillIncreaseDelta);

    await UserSkill.updateOne(
      combineCriteria(userCriteria, { skillName }),
      {
        $set: {
          userId: userDoc._id,
          legacyUserId: userDoc.legacyId,
          skillName,
          progress: nextProgress,
        },
      },
      { upsert: true }
    );
  }

  if (!existingProgress?.completed) {
    const questDocs = await UserQuest.find(combineCriteria(userCriteria, { questType: 'lessons', completed: false })).lean();
    for (const quest of questDocs) {
      const nextCurrent = (quest.current || 0) + 1;
      await UserQuest.updateOne(
        { _id: quest._id },
        {
          $set: {
            current: nextCurrent,
            completed: nextCurrent >= quest.target,
          },
        }
      );
    }
  }

  return {
    xp_earned: xpDelta,
    total_lesson_xp: awardedLessonXp,
    message: 'Урок завершён!',
  };
}

async function getLessonsForUnit(unitId, userId) {
  return getLessonsForUnitMongo(unitId, userId);
}

async function getLessonByIdWithExercises(lessonId, userId) {
  return getLessonByIdWithExercisesMongo(lessonId, userId);
}

async function getExerciseAnswerContext(lessonId, exerciseId, userId) {
  return getExerciseAnswerContextMongo(lessonId, exerciseId, userId);
}

async function completeLessonForUser(lessonId, userId, payload) {
  return completeLessonForUserMongo(lessonId, userId, payload);
}

module.exports = {
  getLessonsForUnit,
  getLessonByIdWithExercises,
  getExerciseAnswerContext,
  completeLessonForUser,
};
