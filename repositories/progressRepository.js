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

function buildUserCriteria(userId) {
  const criteria = [];
  const legacyUserId = parseLegacyId(userId);
  if (legacyUserId != null) {
    criteria.push({ legacyId: legacyUserId });
  }

  const { Types } = getMongooseModule();
  if (Types.ObjectId.isValid(String(userId))) {
    criteria.push({ _id: new Types.ObjectId(String(userId)) });
  }

  if (criteria.length === 0) {
    return null;
  }

  return criteria.length === 1 ? criteria[0] : { $or: criteria };
}

function buildLegacyAwareForeignCriteria(fieldName, legacyFieldName, values) {
  const objectIds = [];
  const legacyIds = [];
  const { Types } = getMongooseModule();

  for (const value of values) {
    if (value == null) continue;
    const legacyId = parseLegacyId(value);
    if (legacyId != null) {
      legacyIds.push(legacyId);
      continue;
    }

    if (Types.ObjectId.isValid(String(value))) {
      objectIds.push(new Types.ObjectId(String(value)));
    }
  }

  const conditions = [];
  if (objectIds.length > 0) {
    conditions.push({ [fieldName]: { $in: objectIds } });
  }
  if (legacyIds.length > 0) {
    conditions.push({ [legacyFieldName]: { $in: legacyIds } });
  }

  if (conditions.length === 0) {
    return null;
  }

  return conditions.length === 1 ? conditions[0] : { $or: conditions };
}

async function getMongoModels() {
  const User = require('../models/User');
  const UserSkill = require('../models/UserSkill');
  const UserQuest = require('../models/UserQuest');
  const UserLessonProgress = require('../models/UserLessonProgress');
  const UserUnitProgress = require('../models/UserUnitProgress');
  const Lesson = require('../models/Lesson');
  const Exercise = require('../models/Exercise');

  return {
    User,
    UserSkill,
    UserQuest,
    UserLessonProgress,
    UserUnitProgress,
    Lesson,
    Exercise,
    mongoose: getMongooseModule(),
  };
}

function serializeDashboardUser(user) {
  if (!user) return null;
  return {
    id: user.legacyId ?? String(user._id),
    name: user.name,
    xp: user.xp || 0,
    streak: user.streak || 0,
    last_activity: user.lastActivity || null,
  };
}

function serializeSkill(skill) {
  return {
    skill_name: skill.skillName,
    progress: skill.progress || 0,
  };
}

function serializeQuest(quest, user) {
  return {
    id: quest.legacyId ?? String(quest._id),
    user_id: quest.legacyUserId ?? user?.legacyId ?? String(quest.userId || user?._id || ''),
    quest_name: quest.questName,
    quest_type: quest.questType,
    target: quest.target,
    current: quest.current,
    xp_reward: quest.xpReward,
    completed: quest.completed,
    created_at: quest.createdAt,
  };
}

function buildReminder(weakestSkill) {
  if (!weakestSkill || (weakestSkill.progress || 0) >= 50) {
    return null;
  }

  return {
    skill_name: weakestSkill.skillName,
  };
}

const DEFAULT_SKILL_NAMES = ['vocabulary', 'grammar', 'listening', 'speaking'];

async function ensureUserSkillsAndQuests(user) {
  const { UserSkill, UserQuest } = await getMongoModels();
  const foreign = buildLegacyAwareForeignCriteria('userId', 'legacyUserId', [user._id, user.legacyId]);
  if (!foreign) {
    return;
  }

  for (const skillName of DEFAULT_SKILL_NAMES) {
    const exists = await UserSkill.findOne({ $and: [foreign, { skillName }] }).lean();
    if (exists) {
      continue;
    }
    try {
      await UserSkill.create({
        userId: user._id,
        legacyUserId: user.legacyId ?? null,
        skillName,
        progress: 0,
      });
    } catch (err) {
      if (err?.code !== 11000) {
        throw err;
      }
    }
  }

  const existingQuests = await UserQuest.find(foreign).lean();
  const hasWords = existingQuests.some((q) => q.questType === 'words');
  const hasLessons = existingQuests.some((q) => q.questType === 'lessons');

  if (!hasWords) {
    try {
      await UserQuest.create({
        userId: user._id,
        legacyUserId: user.legacyId ?? null,
        questName: 'words',
        questType: 'words',
        target: 5,
        xpReward: 15,
        current: 0,
        completed: false,
      });
    } catch (err) {
      if (err?.code !== 11000) {
        throw err;
      }
    }
  }

  if (!hasLessons) {
    try {
      await UserQuest.create({
        userId: user._id,
        legacyUserId: user.legacyId ?? null,
        questName: 'lessons',
        questType: 'lessons',
        target: 3,
        xpReward: 30,
        current: 0,
        completed: false,
      });
    } catch (err) {
      if (err?.code !== 11000) {
        throw err;
      }
    }
  }
}

async function getDashboardDataMongo(userId) {
  const { User, UserSkill, UserQuest, UserLessonProgress } = await getMongoModels();
  const userCriteria = buildUserCriteria(userId);
  if (!userCriteria) {
    return {
      user: null,
      skills: [],
      quests: [],
      recent_lessons: 0,
      reminder: null,
    };
  }

  const user = await User.findOne(userCriteria).lean();
  if (!user) {
    return {
      user: null,
      skills: [],
      quests: [],
      recent_lessons: 0,
      reminder: null,
    };
  }

  await ensureUserSkillsAndQuests(user);

  const relatedUserCriteria = buildLegacyAwareForeignCriteria('userId', 'legacyUserId', [user._id, user.legacyId]);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [skills, quests, recentLessons, weakestSkill] = await Promise.all([
    UserSkill.find(relatedUserCriteria || {}).sort({ skillName: 1 }).lean(),
    UserQuest.find(relatedUserCriteria || {}).sort({ completed: 1, createdAt: -1 }).limit(5).lean(),
    UserLessonProgress.countDocuments({
      ...(relatedUserCriteria || {}),
      completedAt: { $gt: sevenDaysAgo },
    }),
    UserSkill.findOne(relatedUserCriteria || {}).sort({ progress: 1, skillName: 1 }).lean(),
  ]);

  return {
    user: serializeDashboardUser(user),
    skills: skills.map(serializeSkill),
    quests: quests.map((quest) => serializeQuest(quest, user)),
    recent_lessons: recentLessons,
    reminder: buildReminder(weakestSkill),
  };
}

async function getUserStatsMongo(userId) {
  const { User, UserLessonProgress, UserUnitProgress } = await getMongoModels();
  const userCriteria = buildUserCriteria(userId);
  if (!userCriteria) {
    return {
      total_lessons: 0,
      total_xp: 0,
      avg_score: 0,
      completed_units: 0,
    };
  }

  const user = await User.findOne(userCriteria).lean();
  if (!user) {
    return {
      total_lessons: 0,
      total_xp: 0,
      avg_score: 0,
      completed_units: 0,
    };
  }

  const relatedUserCriteria = buildLegacyAwareForeignCriteria('userId', 'legacyUserId', [user._id, user.legacyId]) || {};
  const lessonProgress = await UserLessonProgress.find({
    ...relatedUserCriteria,
    completed: true,
  }).select('score').lean();

  const completedUnits = await UserUnitProgress.countDocuments({
    ...relatedUserCriteria,
    status: 'completed',
  });

  const totalLessons = lessonProgress.length;
  const avgScore = totalLessons > 0
    ? Math.round(lessonProgress.reduce((sum, item) => sum + (item.score || 0), 0) / totalLessons)
    : 0;

  return {
    total_lessons: totalLessons,
    total_xp: user.xp || 0,
    avg_score: avgScore,
    completed_units: completedUnits,
  };
}

async function getReviewWordsForUserMongo(userId) {
  const { User, UserLessonProgress, Lesson, Exercise, mongoose } = await getMongoModels();
  const userCriteria = buildUserCriteria(userId);
  if (!userCriteria) {
    return { words: [] };
  }

  const user = await User.findOne(userCriteria).lean();
  if (!user) {
    return { words: [] };
  }

  const relatedUserCriteria = buildLegacyAwareForeignCriteria('userId', 'legacyUserId', [user._id, user.legacyId]) || {};
  const completed = await UserLessonProgress.find({
    ...relatedUserCriteria,
    completed: true,
  })
    .select('lessonId legacyLessonId')
    .lean();

  const mongoIds = [];
  const legacyIds = [];
  for (const row of completed) {
    if (row.lessonId) mongoIds.push(row.lessonId);
    if (row.legacyLessonId != null) legacyIds.push(row.legacyLessonId);
  }

  if (legacyIds.length > 0) {
    const resolved = await Lesson.find({ legacyId: { $in: legacyIds } }).select('_id').lean();
    for (const lesson of resolved) {
      mongoIds.push(lesson._id);
    }
  }

  const { Types } = mongoose;
  const uniqueStrings = [...new Set(mongoIds.map((id) => String(id)))];
  const uniqueLessonIds = uniqueStrings
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  if (uniqueLessonIds.length === 0) {
    return { words: [] };
  }

  const exercises = await Exercise.find({
    lessonId: { $in: uniqueLessonIds },
    type: { $in: ['speaking', 'translation', 'choice', 'listening'] },
  })
    .select('correctAnswer')
    .lean();

  const out = new Set();
  for (const ex of exercises) {
    const text = String(ex.correctAnswer || '').trim();
    if (!text || text.length > 80) continue;
    out.add(text);
  }

  return { words: [...out].slice(0, 100) };
}

async function getRatingMongo() {
  const { User } = await getMongoModels();
  const users = await User.find({ isAdmin: false })
    .sort({ xp: -1, createdAt: 1 })
    .limit(50)
    .lean();

  return users.map((user) => ({
    id: user.legacyId ?? String(user._id),
    name: user.name,
    xp: user.xp || 0,
    streak: user.streak || 0,
  }));
}

async function getDashboardData(userId) {
  return getDashboardDataMongo(userId);
}

async function getUserStats(userId) {
  return getUserStatsMongo(userId);
}

async function getRating() {
  return getRatingMongo();
}

async function getReviewWordsForUser(userId) {
  return getReviewWordsForUserMongo(userId);
}

module.exports = {
  getDashboardData,
  getUserStats,
  getRating,
  getReviewWordsForUser,
};
