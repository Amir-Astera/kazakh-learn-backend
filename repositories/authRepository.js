require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

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
    age: user.age != null ? user.age : null,
    weekly_study_minutes: user.weeklyStudyMinutes != null ? user.weeklyStudyMinutes : null,
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
  age = null,
  weeklyStudyMinutes = null,
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
    age: age != null && Number.isFinite(Number(age)) ? Math.round(Number(age)) : null,
    weeklyStudyMinutes: weeklyStudyMinutes != null && Number.isFinite(Number(weeklyStudyMinutes))
      ? Math.round(Number(weeklyStudyMinutes))
      : null,
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
    age: normalized.age,
    weekly_study_minutes: normalized.weekly_study_minutes,
    onboarding_completed: normalized.onboarding_completed,
    created_at: normalized.created_at,
  };
}

async function setUserAvatarUrl(userId, relativeUrl) {
  const { User } = await getMongoModels();
  const criteria = buildUserIdCriteria(userId);
  if (!criteria) return null;

  await User.updateOne(criteria, {
    $set: { avatarUrl: relativeUrl ? String(relativeUrl).trim() : null },
  });

  return getCurrentUserById(userId);
}

async function updateUserProfile(userId, payload) {
  const { User } = await getMongoModels();
  const criteria = buildUserIdCriteria(userId);
  if (!criteria) return null;

  const $set = {};
  if (payload.name !== undefined) {
    $set.name = String(payload.name || '').trim();
  }
  if (payload.avatar_url !== undefined) {
    $set.avatarUrl = payload.avatar_url ? String(payload.avatar_url).trim() : null;
  }
  if (payload.language_pair !== undefined) {
    $set.languagePair = ['ru-kz', 'en-kz'].includes(String(payload.language_pair || '').trim().toLowerCase())
      ? String(payload.language_pair).trim().toLowerCase()
      : 'ru-kz';
  }
  if (payload.learning_goal !== undefined) {
    $set.learningGoal = ['general', 'travel', 'study', 'work'].includes(String(payload.learning_goal || '').trim().toLowerCase())
      ? String(payload.learning_goal).trim().toLowerCase()
      : 'general';
  }
  if (payload.proficiency_level !== undefined && payload.proficiency_level !== null) {
    $set.proficiencyLevel = ['beginner', 'elementary', 'intermediate'].includes(String(payload.proficiency_level || '').trim().toLowerCase())
      ? String(payload.proficiency_level).trim().toLowerCase()
      : 'beginner';
  }

  if (Object.keys($set).length === 0) {
    return getCurrentUserById(userId);
  }

  const user = await User.findOneAndUpdate(
    criteria,
    {
      $set: $set,
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
    age: normalized.age,
    weekly_study_minutes: normalized.weekly_study_minutes,
    onboarding_completed: normalized.onboarding_completed,
    created_at: normalized.created_at,
  };
}

async function completeOnboardingSurvey(userId, payload) {
  const { User } = await getMongoModels();
  const criteria = buildUserIdCriteria(userId);
  if (!criteria) return null;

  const languagePair = ['ru-kz', 'en-kz'].includes(String(payload.language_pair || '').trim().toLowerCase())
    ? String(payload.language_pair).trim().toLowerCase()
    : 'ru-kz';
  const learningGoal = ['general', 'travel', 'study', 'work'].includes(String(payload.learning_goal || '').trim().toLowerCase())
    ? String(payload.learning_goal).trim().toLowerCase()
    : 'general';
  const proficiencyLevel = ['beginner', 'elementary', 'intermediate'].includes(String(payload.proficiency_level || '').trim().toLowerCase())
    ? String(payload.proficiency_level).trim().toLowerCase()
    : 'beginner';

  const ageNum = Number(payload.age);
  const weeklyNum = Number(payload.weekly_study_minutes);

  await User.updateOne(criteria, {
    $set: {
      languagePair,
      learningGoal,
      proficiencyLevel,
      age: Number.isFinite(ageNum) && ageNum >= 5 && ageNum <= 120 ? Math.round(ageNum) : null,
      weeklyStudyMinutes: [5, 10, 15, 20].includes(weeklyNum) ? weeklyNum : null,
      onboardingCompleted: true,
    },
  });

  return getCurrentUserById(userId);
}

async function findOrCreateGoogleUser({ googleId, email, name, avatarUrl }) {
  const { User, UserSkill, UserQuest, UserUnitProgress, Unit } = await getMongoModels();

  let user = await User.findOne({ googleId }).lean();
  if (user) {
    const fromGoogle = avatarUrl ? String(avatarUrl).trim() : '';
    const nextAvatar = fromGoogle || (user.avatarUrl ? String(user.avatarUrl).trim() : '') || null;
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          lastActivity: new Date(),
          ...(nextAvatar ? { avatarUrl: nextAvatar } : {}),
        },
      }
    );
    return normalizeAuthUser({
      ...user,
      lastActivity: new Date(),
      avatarUrl: nextAvatar || user.avatarUrl,
    });
  }

  user = await User.findOne({ email: String(email).trim().toLowerCase() }).lean();
  if (user) {
    await User.updateOne({ _id: user._id }, { $set: { googleId, lastActivity: new Date(), avatarUrl: avatarUrl || user.avatarUrl } });
    return normalizeAuthUser({ ...user, googleId, lastActivity: new Date() });
  }

  const newUser = await User.create({
    email: String(email).trim().toLowerCase(),
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

async function createPasswordResetForEmail(email) {
  const { User } = await getMongoModels();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) {
    return { rawToken: null };
  }

  const user = await User.findOne({ email: normalized }).lean();
  if (!user || !user.passwordHash) {
    return { rawToken: null };
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordResetTokenHash: hash,
        passwordResetExpires: expires,
      },
    }
  );

  return { rawToken };
}

async function resetPasswordWithToken(rawToken, newPassword) {
  const { User } = await getMongoModels();
  const token = String(rawToken || '').trim();
  const password = String(newPassword || '');
  if (!token || password.length < 6) {
    return { ok: false, error: 'invalid' };
  }

  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    passwordResetTokenHash: hash,
    passwordResetExpires: { $gt: new Date() },
  }).lean();

  if (!user) {
    return { ok: false, error: 'token' };
  }

  const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash },
      $unset: { passwordResetTokenHash: '', passwordResetExpires: '' },
    }
  );

  return { ok: true };
}

module.exports = {
  findUserByEmail,
  createUserWithDefaults,
  updateUserLoginState,
  getCurrentUserById,
  updateUserProfile,
  setUserAvatarUrl,
  findOrCreateGoogleUser,
  completeOnboardingSurvey,
  createPasswordResetForEmail,
  resetPasswordWithToken,
};
