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

async function getMongoModels() {
  const User = require('../models/User');
  const Unit = require('../models/Unit');
  const Lesson = require('../models/Lesson');
  const Exercise = require('../models/Exercise');
  const UserLessonProgress = require('../models/UserLessonProgress');
  const UserUnitProgress = require('../models/UserUnitProgress');
  const UserSkill = require('../models/UserSkill');
  const UserQuest = require('../models/UserQuest');

  return {
    User,
    Unit,
    Lesson,
    Exercise,
    UserLessonProgress,
    UserUnitProgress,
    UserSkill,
    UserQuest,
    mongoose: getMongooseModule(),
  };
}

function buildUserCriteria(userId) {
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

async function getLessonsForUnitPostgres(unitId, userId) {
  const lessons = await pool.query(
    `SELECT l.*,
            COALESCE(ulp.completed, false) as completed,
            COALESCE(ulp.score, 0) as score,
            COALESCE(ulp.mistakes, 0) as mistakes
     FROM lessons l
     LEFT JOIN user_lesson_progress ulp ON l.id = ulp.lesson_id AND ulp.user_id = $1
     WHERE l.unit_id = $2
     ORDER BY l.order_num`,
    [userId, unitId]
  );

  return lessons.rows;
}

async function getLessonsForUnitMongo(unitId, userId) {
  const { Unit, Lesson, UserLessonProgress, mongoose } = await getMongoModels();
  const unitDoc = await findUnitByIdentifier(Unit, mongoose, unitId);
  if (!unitDoc) {
    return [];
  }

  const lessons = await Lesson.find({ unitId: unitDoc._id }).sort({ orderNum: 1 }).lean();
  const userCriteria = buildUserCriteria(userId);
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

async function getLessonByIdWithExercisesPostgres(lessonId) {
  const lesson = await pool.query('SELECT * FROM lessons WHERE id = $1', [lessonId]);
  if (lesson.rows.length === 0) {
    return null;
  }

  const exercises = await pool.query(
    'SELECT * FROM exercises WHERE lesson_id = $1 ORDER BY order_num',
    [lessonId]
  );

  return {
    ...lesson.rows[0],
    exercises: exercises.rows,
  };
}

async function getLessonByIdWithExercisesMongo(lessonId) {
  const { Lesson, Exercise, mongoose } = await getMongoModels();
  const lesson = await findLessonByIdentifier(Lesson, mongoose, lessonId);
  if (!lesson) {
    return null;
  }

  const exerciseDocs = await Exercise.find({ lessonId: lesson._id }).sort({ orderNum: 1 }).lean();

  return {
    ...serializeLesson(lesson, null),
    exercises: exerciseDocs.map(serializeExercise),
  };
}

async function getExerciseAnswerContextPostgres(lessonId, exerciseId) {
  const exercise = await pool.query(
    'SELECT * FROM exercises WHERE id = $1 AND lesson_id = $2',
    [exerciseId, lessonId]
  );

  return exercise.rows[0] || null;
}

async function getExerciseAnswerContextMongo(lessonId, exerciseId) {
  const { Lesson, Exercise, mongoose } = await getMongoModels();
  const lesson = await findLessonByIdentifier(Lesson, mongoose, lessonId);
  if (!lesson) {
    return null;
  }

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

async function completeLessonForUserPostgres(lessonId, userId, payload) {
  const normalizedScore = clampScore(payload.score ?? 100);
  const normalizedMistakes = normalizeMistakes(payload.mistakes ?? 0);
  const normalizedTimeSpent = Math.max(0, Math.round(Number(payload.timeSpent) || 0));

  const existingProgress = await pool.query(
    'SELECT completed, score, xp_earned FROM user_lesson_progress WHERE user_id = $1 AND lesson_id = $2',
    [userId, lessonId]
  );

  const previousProgress = existingProgress.rows[0] || null;
  const lesson = await pool.query('SELECT * FROM lessons WHERE id = $1', [lessonId]);
  if (lesson.rows.length === 0) {
    return null;
  }

  const baseXp = lesson.rows[0].xp_reward;
  const awardedLessonXp = calculateLessonXp(baseXp, normalizedScore, normalizedMistakes);
  const previousLessonXp = previousProgress?.xp_earned || 0;
  const xpDelta = Math.max(0, awardedLessonXp - previousLessonXp);

  await pool.query(
    `INSERT INTO user_lesson_progress (user_id, lesson_id, completed, score, mistakes, xp_earned, time_spent, completed_at)
     VALUES ($1, $2, true, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id, lesson_id)
     DO UPDATE SET completed = true, score = $3, mistakes = $4, xp_earned = GREATEST(user_lesson_progress.xp_earned, $5), time_spent = $6, completed_at = NOW()`,
    [userId, lessonId, normalizedScore, normalizedMistakes, awardedLessonXp, normalizedTimeSpent]
  );

  if (xpDelta > 0) {
    await pool.query(
      'UPDATE users SET xp = xp + $1, last_activity = CURRENT_DATE WHERE id = $2',
      [xpDelta, userId]
    );
  } else {
    await pool.query(
      'UPDATE users SET last_activity = CURRENT_DATE WHERE id = $1',
      [userId]
    );
  }

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

    const completed = parseInt(completedCount.rows[0].cnt, 10);
    const stars = completed >= totalLessons ? 3 : completed >= totalLessons * 0.6 ? 2 : 1;
    const status = completed >= totalLessons ? 'completed' : 'current';

    await pool.query(
      `INSERT INTO user_progress (user_id, unit_id, status, completed_lessons, stars)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, unit_id)
       DO UPDATE SET status = $3, completed_lessons = $4, stars = $5`,
      [userId, unitId, status, completed, stars]
    );

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

  const skillMap = {
    translation: 'vocabulary',
    choice: 'vocabulary',
    grammar: 'grammar',
    sentence: 'grammar',
    listening: 'listening',
    speaking: 'speaking',
  };
  const skillName = skillMap[lesson.rows[0].type] || 'vocabulary';
  const previousSkillScore = previousProgress?.score || 0;
  const currentSkillIncrease = Math.max(1, Math.floor(normalizedScore / 20));
  const previousSkillIncrease = previousProgress?.completed ? Math.max(1, Math.floor(previousSkillScore / 20)) : 0;
  const skillIncreaseDelta = Math.max(0, currentSkillIncrease - previousSkillIncrease);

  if (skillIncreaseDelta > 0) {
    await pool.query(
      `INSERT INTO user_skills (user_id, skill_name, progress)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, skill_name)
       DO UPDATE SET progress = LEAST(100, user_skills.progress + $3)`,
      [userId, skillName, skillIncreaseDelta]
    );
  }

  if (!previousProgress?.completed) {
    await pool.query(
      `UPDATE user_quests SET current = current + 1 
       WHERE user_id = $1 AND quest_type = 'lessons' AND completed = false`,
      [userId]
    );

    await pool.query(
      `UPDATE user_quests SET completed = true 
       WHERE user_id = $1 AND current >= target AND completed = false`,
      [userId]
    );
  }

  return {
    xp_earned: xpDelta,
    total_lesson_xp: awardedLessonXp,
    message: 'Урок завершён!',
  };
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

  const userCriteria = buildUserCriteria(userId);
  const lessonProgressCriteria = buildLinkedCriteria('lessonId', 'legacyLessonId', [lessonDoc._id], [lessonDoc.legacyId]);
  const existingProgress = await UserLessonProgress.findOne(combineCriteria(userCriteria, lessonProgressCriteria)).lean();

  const baseXp = lessonDoc.xpReward || 0;
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

  const unitDoc = await Unit.findById(lessonDoc.unitId).lean();
  if (unitDoc) {
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

    const totalLessons = unitDoc.lessonCount || unitLessons.length;
    const stars = completed >= totalLessons ? 3 : completed >= totalLessons * 0.6 ? 2 : 1;
    const status = completed >= totalLessons ? 'completed' : 'current';
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
          completedLessons: completed,
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
      }
    }
  }

  const skillMap = {
    translation: 'vocabulary',
    choice: 'vocabulary',
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
  return isMongoProvider() ? getLessonsForUnitMongo(unitId, userId) : getLessonsForUnitPostgres(unitId, userId);
}

async function getLessonByIdWithExercises(lessonId) {
  return isMongoProvider() ? getLessonByIdWithExercisesMongo(lessonId) : getLessonByIdWithExercisesPostgres(lessonId);
}

async function getExerciseAnswerContext(lessonId, exerciseId) {
  return isMongoProvider() ? getExerciseAnswerContextMongo(lessonId, exerciseId) : getExerciseAnswerContextPostgres(lessonId, exerciseId);
}

async function completeLessonForUser(lessonId, userId, payload) {
  return isMongoProvider() ? completeLessonForUserMongo(lessonId, userId, payload) : completeLessonForUserPostgres(lessonId, userId, payload);
}

module.exports = {
  getLessonsForUnit,
  getLessonByIdWithExercises,
  getExerciseAnswerContext,
  completeLessonForUser,
};
