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

  return {
    User,
    UserSkill,
    UserQuest,
    UserLessonProgress,
    UserUnitProgress,
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

  const skillNames = {
    vocabulary: 'словарный запас',
    grammar: 'грамматику',
    listening: 'аудирование',
    speaking: 'произношение',
  };

  return {
    title: 'Умная подсказка',
    message: `Подтяните ${skillNames[weakestSkill.skillName] || weakestSkill.skillName}. Пройдите 2-минутный урок для закрепления!`,
  };
}

async function getDashboardDataPostgres(userId) {
  const user = await pool.query(
    'SELECT id, name, xp, streak, last_activity FROM users WHERE id = $1',
    [userId]
  );

  const skills = await pool.query(
    'SELECT skill_name, progress FROM user_skills WHERE user_id = $1',
    [userId]
  );

  const quests = await pool.query(
    `SELECT * FROM user_quests
     WHERE user_id = $1
     ORDER BY completed ASC, created_at DESC
     LIMIT 5`,
    [userId]
  );

  const recentLessons = await pool.query(
    "SELECT COUNT(*) as cnt FROM user_lesson_progress WHERE user_id = $1 AND completed_at > NOW() - INTERVAL '7 days'",
    [userId]
  );

  const weakestSkill = await pool.query(
    'SELECT skill_name, progress FROM user_skills WHERE user_id = $1 ORDER BY progress ASC LIMIT 1',
    [userId]
  );

  let reminder = null;
  if (weakestSkill.rows.length > 0 && weakestSkill.rows[0].progress < 50) {
    const skillNames = {
      vocabulary: 'словарный запас',
      grammar: 'грамматику',
      listening: 'аудирование',
      speaking: 'произношение',
    };
    reminder = {
      title: 'Умная подсказка',
      message: `Подтяните ${skillNames[weakestSkill.rows[0].skill_name] || weakestSkill.rows[0].skill_name}. Пройдите 2-минутный урок для закрепления!`,
    };
  }

  return {
    user: user.rows[0],
    skills: skills.rows,
    quests: quests.rows,
    recent_lessons: parseInt(recentLessons.rows[0].cnt, 10),
    reminder,
  };
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

async function getUserStatsPostgres(userId) {
  const totalLessons = await pool.query(
    'SELECT COUNT(*) as cnt FROM user_lesson_progress WHERE user_id = $1 AND completed = true',
    [userId]
  );

  const totalXP = await pool.query(
    'SELECT xp FROM users WHERE id = $1',
    [userId]
  );

  const avgScore = await pool.query(
    'SELECT ROUND(AVG(score)) as avg_score FROM user_lesson_progress WHERE user_id = $1 AND completed = true',
    [userId]
  );

  const completedUnits = await pool.query(
    "SELECT COUNT(*) as cnt FROM user_progress WHERE user_id = $1 AND status = 'completed'",
    [userId]
  );

  return {
    total_lessons: parseInt(totalLessons.rows[0].cnt, 10),
    total_xp: totalXP.rows[0].xp,
    avg_score: parseInt(avgScore.rows[0].avg_score, 10) || 0,
    completed_units: parseInt(completedUnits.rows[0].cnt, 10),
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

async function getRatingPostgres() {
  const result = await pool.query(
    'SELECT id, name, xp, streak FROM users WHERE is_admin = FALSE ORDER BY xp DESC LIMIT 50'
  );

  return result.rows;
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
  return isMongoProvider() ? getDashboardDataMongo(userId) : getDashboardDataPostgres(userId);
}

async function getUserStats(userId) {
  return isMongoProvider() ? getUserStatsMongo(userId) : getUserStatsPostgres(userId);
}

async function getRating() {
  return isMongoProvider() ? getRatingMongo() : getRatingPostgres();
}

module.exports = {
  getDashboardData,
  getUserStats,
  getRating,
};
