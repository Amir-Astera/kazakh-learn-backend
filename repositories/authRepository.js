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

function normalizeAuthUser(user) {
  if (!user) return null;

  return {
    id: user.legacyId ?? String(user._id),
    email: user.email,
    password_hash: user.passwordHash,
    name: user.name,
    avatar_url: user.avatarUrl || null,
    xp: user.xp || 0,
    streak: user.streak || 0,
    last_activity: user.lastActivity || null,
    is_admin: Boolean(user.isAdmin),
    created_at: user.createdAt || null,
  };
}

async function getMongoModels() {
  const User = require('../models/User');
  const UserSkill = require('../models/UserSkill');
  const UserQuest = require('../models/UserQuest');
  const UserUnitProgress = require('../models/UserUnitProgress');
  const Level = require('../models/Level');
  const Module = require('../models/Module');
  const Unit = require('../models/Unit');

  return {
    User,
    UserSkill,
    UserQuest,
    UserUnitProgress,
    Level,
    Module,
    Unit,
    mongoose: getMongooseModule(),
  };
}

function buildUserIdCriteria(userId) {
  const criteria = [];
  const legacyId = parseLegacyId(userId);
  if (legacyId != null) {
    criteria.push({ legacyId });
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

async function findFirstUnitMongo(Unit) {
  const Module = require('../models/Module');
  const Level = require('../models/Level');

  const [units, modules, levels] = await Promise.all([
    Unit.find().lean(),
    Module.find().lean(),
    Level.find().lean(),
  ]);

  if (units.length === 0) {
    return null;
  }

  const levelMap = new Map(levels.map((level) => [String(level._id), level]));
  const moduleMap = new Map(
    modules.map((moduleDoc) => [
      String(moduleDoc._id),
      {
        ...moduleDoc,
        levelId: levelMap.get(String(moduleDoc.levelId)) || null,
      },
    ])
  );

  const hydratedUnits = units.map((unit) => ({
    ...unit,
    moduleId: moduleMap.get(String(unit.moduleId)) || null,
  }));

  hydratedUnits.sort((left, right) => {
    const leftLevelOrder = left.moduleId?.levelId?.orderNum || 0;
    const rightLevelOrder = right.moduleId?.levelId?.orderNum || 0;
    if (leftLevelOrder !== rightLevelOrder) return leftLevelOrder - rightLevelOrder;

    const leftModuleOrder = left.moduleId?.orderNum || 0;
    const rightModuleOrder = right.moduleId?.orderNum || 0;
    if (leftModuleOrder !== rightModuleOrder) return leftModuleOrder - rightModuleOrder;

    return (left.orderNum || 0) - (right.orderNum || 0);
  });

  return hydratedUnits[0];
}

async function findUserByEmailPostgres(email) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

async function findUserByEmailMongo(email) {
  const { User } = await getMongoModels();
  const user = await User.findOne({ email: String(email).trim().toLowerCase() }).lean();
  return normalizeAuthUser(user);
}

async function createUserWithDefaultsPostgres({ email, passwordHash, name }) {
  const result = await pool.query(
    'INSERT INTO users (email, password_hash, name, last_activity) VALUES ($1, $2, $3, CURRENT_DATE) RETURNING id, email, name, xp, streak',
    [email, passwordHash, name]
  );

  const user = result.rows[0];
  const skills = ['vocabulary', 'grammar', 'listening', 'speaking'];
  for (const skill of skills) {
    await pool.query(
      'INSERT INTO user_skills (user_id, skill_name, progress) VALUES ($1, $2, 0)',
      [user.id, skill]
    );
  }

  const firstUnit = await pool.query(
    'SELECT u.id FROM units u JOIN modules m ON u.module_id = m.id JOIN levels l ON m.level_id = l.id ORDER BY l.order_num, m.order_num, u.order_num LIMIT 1'
  );
  if (firstUnit.rows.length > 0) {
    await pool.query(
      "INSERT INTO user_progress (user_id, unit_id, status) VALUES ($1, $2, 'current')",
      [user.id, firstUnit.rows[0].id]
    );
  }

  await pool.query(
    "INSERT INTO user_quests (user_id, quest_name, quest_type, target, xp_reward) VALUES ($1, 'Выучить 5 новых слов', 'words', 5, 15), ($1, 'Пройти 3 микроурока', 'lessons', 3, 30)",
    [user.id]
  );

  return user;
}

async function createUserWithDefaultsMongo({ email, passwordHash, name }) {
  const { User, UserSkill, UserQuest, UserUnitProgress, Unit } = await getMongoModels();
  const user = await User.create({
    email: String(email).trim().toLowerCase(),
    passwordHash,
    name,
    lastActivity: new Date(),
    streak: 1,
    xp: 0,
    isAdmin: false,
  });

  const skills = ['vocabulary', 'grammar', 'listening', 'speaking'];
  await UserSkill.insertMany(
    skills.map((skillName) => ({
      userId: user._id,
      legacyUserId: user.legacyId,
      skillName,
      progress: 0,
    }))
  );

  const firstUnit = await findFirstUnitMongo(Unit);
  if (firstUnit) {
    await UserUnitProgress.create({
      userId: user._id,
      legacyUserId: user.legacyId,
      unitId: firstUnit._id,
      legacyUnitId: firstUnit.legacyId,
      status: 'current',
      completedLessons: 0,
      stars: 0,
    });
  }

  await UserQuest.insertMany([
    {
      userId: user._id,
      legacyUserId: user.legacyId,
      questName: 'Выучить 5 новых слов',
      questType: 'words',
      target: 5,
      xpReward: 15,
      current: 0,
      completed: false,
    },
    {
      userId: user._id,
      legacyUserId: user.legacyId,
      questName: 'Пройти 3 микроурока',
      questType: 'lessons',
      target: 3,
      xpReward: 30,
      current: 0,
      completed: false,
    },
  ]);

  return {
    id: user.legacyId ?? String(user._id),
    email: user.email,
    name: user.name,
    xp: user.xp || 0,
    streak: user.streak || 0,
  };
}

async function updateUserLoginStatePostgres(userId, streak) {
  await pool.query(
    'UPDATE users SET last_activity = CURRENT_DATE, streak = $1 WHERE id = $2',
    [streak, userId]
  );
}

async function updateUserLoginStateMongo(userId, streak) {
  const { User } = await getMongoModels();
  const criteria = buildUserIdCriteria(userId);
  if (!criteria) return;

  await User.updateOne(criteria, {
    $set: {
      lastActivity: new Date(),
      streak,
    },
  });
}

async function getCurrentUserByIdPostgres(userId) {
  const result = await pool.query(
    'SELECT id, email, name, avatar_url, xp, streak, last_activity, created_at FROM users WHERE id = $1',
    [userId]
  );

  return result.rows[0] || null;
}

async function getCurrentUserByIdMongo(userId) {
  const { User } = await getMongoModels();
  const criteria = buildUserIdCriteria(userId);
  if (!criteria) return null;

  const user = await User.findOne(criteria).lean();
  if (!user) return null;

  const normalized = normalizeAuthUser(user);
  return {
    id: normalized.id,
    email: normalized.email,
    name: normalized.name,
    avatar_url: normalized.avatar_url,
    xp: normalized.xp,
    streak: normalized.streak,
    last_activity: normalized.last_activity,
    created_at: normalized.created_at,
  };
}

async function findUserByEmail(email) {
  return isMongoProvider() ? findUserByEmailMongo(email) : findUserByEmailPostgres(email);
}

async function createUserWithDefaults(payload) {
  return isMongoProvider() ? createUserWithDefaultsMongo(payload) : createUserWithDefaultsPostgres(payload);
}

async function updateUserLoginState(userId, streak) {
  return isMongoProvider() ? updateUserLoginStateMongo(userId, streak) : updateUserLoginStatePostgres(userId, streak);
}

async function getCurrentUserById(userId) {
  return isMongoProvider() ? getCurrentUserByIdMongo(userId) : getCurrentUserByIdPostgres(userId);
}

module.exports = {
  findUserByEmail,
  createUserWithDefaults,
  updateUserLoginState,
  getCurrentUserById,
};
