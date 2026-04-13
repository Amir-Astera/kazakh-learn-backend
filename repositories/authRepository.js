require('dotenv').config();

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
    language_pair: user.languagePair || 'ru-kz',
    learning_goal: user.learningGoal || 'general',
    proficiency_level: user.proficiencyLevel || 'beginner',
    onboarding_completed: Boolean(user.onboardingCompleted),
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

async function findUserByEmail(email) {
  const { User } = await getMongoModels();
  const user = await User.findOne({ email: String(email).trim().toLowerCase() }).lean();
  return normalizeAuthUser(user);
}

async function createUserWithDefaults({
  email,
  passwordHash,
  name,
  avatarUrl = null,
  languagePair = 'ru-kz',
  learningGoal = 'general',
  proficiencyLevel = 'beginner',
}) {
  const { User, UserSkill, UserQuest, UserUnitProgress, Unit } = await getMongoModels();
  const user = await User.create({
    email: String(email).trim().toLowerCase(),
    passwordHash,
    name,
    avatarUrl,
    lastActivity: new Date(),
    streak: 1,
    xp: 0,
    isAdmin: false,
    languagePair,
    learningGoal,
    proficiencyLevel,
    onboardingCompleted: true,
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

  return normalizeAuthUser(user);
}

async function updateUserLoginState(userId, streak) {
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

async function getCurrentUserById(userId) {
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
    is_admin: normalized.is_admin,
    language_pair: normalized.language_pair,
    learning_goal: normalized.learning_goal,
    proficiency_level: normalized.proficiency_level,
    onboarding_completed: normalized.onboarding_completed,
    created_at: normalized.created_at,
  };
}

async function updateUserProfile(userId, payload) {
  const { User } = await getMongoModels();
  const criteria = buildUserIdCriteria(userId);
  if (!criteria) return null;

  const update = {
    name: String(payload.name || '').trim(),
    avatarUrl: payload.avatar_url ? String(payload.avatar_url).trim() : null,
    languagePair: payload.language_pair,
    learningGoal: payload.learning_goal,
    proficiencyLevel: payload.proficiency_level,
    onboardingCompleted: true,
  };

  const user = await User.findOneAndUpdate(
    criteria,
    {
      $set: update,
    },
    { new: true }
  ).lean();

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
    is_admin: normalized.is_admin,
    language_pair: normalized.language_pair,
    learning_goal: normalized.learning_goal,
    proficiency_level: normalized.proficiency_level,
    onboarding_completed: normalized.onboarding_completed,
    created_at: normalized.created_at,
  };
}

async function findOrCreateGoogleUser({ googleId, email, name, avatarUrl }) {
  const { User, UserSkill, UserQuest, UserUnitProgress, Unit } = await getMongoModels();

  let user = await User.findOne({ googleId }).lean();
  if (user) {
    await User.updateOne({ _id: user._id }, { $set: { lastActivity: new Date() } });
    return normalizeAuthUser({ ...user, lastActivity: new Date() });
  }

  user = await User.findOne({ email: String(email).trim().toLowerCase() }).lean();
  if (user) {
    await User.updateOne({ _id: user._id }, { $set: { googleId, lastActivity: new Date(), avatarUrl: avatarUrl || user.avatarUrl } });
    return normalizeAuthUser({ ...user, googleId, lastActivity: new Date() });
  }

  const newUser = await User.create({
    email: String(email).trim().toLowerCase(),
    passwordHash: null,
    name: name || email.split('@')[0],
    avatarUrl: avatarUrl || null,
    googleId,
    lastActivity: new Date(),
    streak: 1,
    xp: 0,
    isAdmin: false,
    languagePair: 'ru-kz',
    learningGoal: 'general',
    proficiencyLevel: 'beginner',
    onboardingCompleted: false,
  });

  const skills = ['vocabulary', 'grammar', 'listening', 'speaking'];
  await UserSkill.insertMany(
    skills.map((skillName) => ({
      userId: newUser._id,
      legacyUserId: newUser.legacyId,
      skillName,
      progress: 0,
    }))
  );

  const firstUnit = await findFirstUnitMongo(Unit);
  if (firstUnit) {
    await UserUnitProgress.create({
      userId: newUser._id,
      legacyUserId: newUser.legacyId,
      unitId: firstUnit._id,
      legacyUnitId: firstUnit.legacyId,
      status: 'current',
      completedLessons: 0,
      stars: 0,
    });
  }

  await UserQuest.insertMany([
    { userId: newUser._id, legacyUserId: newUser.legacyId, questName: 'Выучить 5 новых слов', questType: 'words', target: 5, xpReward: 15, current: 0, completed: false },
    { userId: newUser._id, legacyUserId: newUser.legacyId, questName: 'Пройти 3 микроурока', questType: 'lessons', target: 3, xpReward: 30, current: 0, completed: false },
  ]);

  return normalizeAuthUser(newUser);
}

module.exports = {
  findUserByEmail,
  createUserWithDefaults,
  updateUserLoginState,
  getCurrentUserById,
  updateUserProfile,
  findOrCreateGoogleUser,
};
