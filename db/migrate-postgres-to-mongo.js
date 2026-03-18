require('dotenv').config();

const pool = require('../config/db');
const { connectMongo, getMongoose } = require('../config/mongo');
const User = require('../models/User');
const Level = require('../models/Level');
const Module = require('../models/Module');
const Unit = require('../models/Unit');
const Lesson = require('../models/Lesson');
const Exercise = require('../models/Exercise');
const UserUnitProgress = require('../models/UserUnitProgress');
const UserLessonProgress = require('../models/UserLessonProgress');
const UserSkill = require('../models/UserSkill');
const UserQuest = require('../models/UserQuest');

function normalizePoint(point) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    return null;
  }

  return {
    x: Number(point.x),
    y: Number(point.y),
  };
}

function normalizePointArray(points) {
  if (!Array.isArray(points)) {
    return [];
  }

  return points.map(normalizePoint).filter(Boolean);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.map((item) => String(item));
}

async function resetMongoCollections() {
  await Promise.all([
    UserQuest.deleteMany({}),
    UserSkill.deleteMany({}),
    UserLessonProgress.deleteMany({}),
    UserUnitProgress.deleteMany({}),
    Exercise.deleteMany({}),
    Lesson.deleteMany({}),
    Unit.deleteMany({}),
    Module.deleteMany({}),
    Level.deleteMany({}),
    User.deleteMany({}),
  ]);
}

async function loadPostgresData() {
  const [
    usersResult,
    levelsResult,
    modulesResult,
    unitsResult,
    lessonsResult,
    exercisesResult,
    landmarksResult,
    userProgressResult,
    userLessonProgressResult,
    userSkillsResult,
    userQuestsResult,
  ] = await Promise.all([
    pool.query('SELECT * FROM users ORDER BY id'),
    pool.query('SELECT * FROM levels ORDER BY order_num, id'),
    pool.query('SELECT * FROM modules ORDER BY level_id, order_num, id'),
    pool.query('SELECT * FROM units ORDER BY module_id, order_num, id'),
    pool.query('SELECT * FROM lessons ORDER BY unit_id, order_num, id'),
    pool.query('SELECT * FROM exercises ORDER BY lesson_id, order_num, id'),
    pool.query('SELECT * FROM landmarks ORDER BY unit_id, created_at, id'),
    pool.query('SELECT * FROM user_progress ORDER BY user_id, unit_id'),
    pool.query('SELECT * FROM user_lesson_progress ORDER BY user_id, lesson_id'),
    pool.query('SELECT * FROM user_skills ORDER BY user_id, skill_name'),
    pool.query('SELECT * FROM user_quests ORDER BY user_id, created_at, id'),
  ]);

  return {
    users: usersResult.rows,
    levels: levelsResult.rows,
    modules: modulesResult.rows,
    units: unitsResult.rows,
    lessons: lessonsResult.rows,
    exercises: exercisesResult.rows,
    landmarks: landmarksResult.rows,
    userProgress: userProgressResult.rows,
    userLessonProgress: userLessonProgressResult.rows,
    userSkills: userSkillsResult.rows,
    userQuests: userQuestsResult.rows,
  };
}

async function migrateContent(data) {
  const levelIdMap = new Map();
  const moduleIdMap = new Map();
  const unitIdMap = new Map();
  const lessonIdMap = new Map();
  const userIdMap = new Map();

  const landmarksByUnitId = new Map();
  for (const landmark of data.landmarks) {
    const items = landmarksByUnitId.get(landmark.unit_id) || [];
    items.push({
      legacyId: landmark.id,
      imageUrl: landmark.image_url,
      altText: landmark.alt_text,
      position: normalizePoint(landmark.position),
      createdAt: landmark.created_at || new Date(),
    });
    landmarksByUnitId.set(landmark.unit_id, items);
  }

  const userDocs = await User.insertMany(
    data.users.map((user) => ({
      legacyId: user.id,
      email: user.email,
      passwordHash: user.password_hash,
      name: user.name,
      avatarUrl: user.avatar_url || null,
      xp: user.xp || 0,
      streak: user.streak || 0,
      lastActivity: user.last_activity || null,
      isAdmin: Boolean(user.is_admin),
      createdAt: user.created_at || new Date(),
      updatedAt: user.created_at || new Date(),
    }))
  );
  for (const doc of userDocs) {
    userIdMap.set(doc.legacyId, doc._id);
  }

  const levelDocs = await Level.insertMany(
    data.levels.map((level) => ({
      legacyId: level.id,
      code: level.code,
      name: level.name,
      description: level.description || '',
      orderNum: level.order_num,
    }))
  );
  for (const doc of levelDocs) {
    levelIdMap.set(doc.legacyId, doc._id);
  }

  const moduleDocs = await Module.insertMany(
    data.modules.map((moduleItem) => ({
      legacyId: moduleItem.id,
      levelId: levelIdMap.get(moduleItem.level_id),
      title: moduleItem.title,
      titleKz: moduleItem.title_kz || moduleItem.title,
      description: moduleItem.description || '',
      orderNum: moduleItem.order_num,
      requiredXp: moduleItem.required_xp || 0,
    }))
  );
  for (const doc of moduleDocs) {
    moduleIdMap.set(doc.legacyId, doc._id);
  }

  const unitDocs = await Unit.insertMany(
    data.units.map((unit) => ({
      legacyId: unit.id,
      moduleId: moduleIdMap.get(unit.module_id),
      title: unit.title,
      titleKz: unit.title_kz || unit.title,
      subtitle: unit.subtitle || '',
      icon: unit.icon || 'book',
      orderNum: unit.order_num,
      lessonCount: unit.lesson_count || 0,
      pathImageUrl: unit.path_image_url || null,
      pathPoints: normalizePointArray(unit.path_points),
      landmarkPosition: normalizePoint(unit.landmark_position),
      landmarks: landmarksByUnitId.get(unit.id) || [],
    }))
  );
  for (const doc of unitDocs) {
    unitIdMap.set(doc.legacyId, doc._id);
  }

  const lessonDocs = await Lesson.insertMany(
    data.lessons.map((lesson) => ({
      legacyId: lesson.id,
      unitId: unitIdMap.get(lesson.unit_id),
      title: lesson.title,
      type: lesson.type,
      xpReward: lesson.xp_reward || 0,
      orderNum: lesson.order_num,
    }))
  );
  for (const doc of lessonDocs) {
    lessonIdMap.set(doc.legacyId, doc._id);
  }

  await Exercise.insertMany(
    data.exercises.map((exercise) => ({
      legacyId: exercise.id,
      lessonId: lessonIdMap.get(exercise.lesson_id),
      type: exercise.type,
      question: exercise.question,
      questionAudio: exercise.question_audio || null,
      options: normalizeStringArray(exercise.options),
      correctAnswer: exercise.correct_answer,
      explanation: exercise.explanation || null,
      orderNum: exercise.order_num,
    }))
  );

  return {
    userIdMap,
    unitIdMap,
    lessonIdMap,
  };
}

async function migrateProgress(data, ids) {
  await UserUnitProgress.insertMany(
    data.userProgress.map((item) => ({
      legacyUserId: item.user_id,
      userId: ids.userIdMap.get(item.user_id) || null,
      legacyUnitId: item.unit_id,
      unitId: ids.unitIdMap.get(item.unit_id) || null,
      status: item.status || 'locked',
      completedLessons: item.completed_lessons || 0,
      stars: item.stars || 0,
    }))
  );

  await UserLessonProgress.insertMany(
    data.userLessonProgress.map((item) => ({
      legacyUserId: item.user_id,
      userId: ids.userIdMap.get(item.user_id) || null,
      legacyLessonId: item.lesson_id,
      lessonId: ids.lessonIdMap.get(item.lesson_id) || null,
      completed: Boolean(item.completed),
      score: item.score || 0,
      mistakes: item.mistakes || 0,
      xpEarned: item.xp_earned || 0,
      timeSpent: item.time_spent || 0,
      completedAt: item.completed_at || null,
      createdAt: item.completed_at || new Date(),
      updatedAt: item.completed_at || new Date(),
    }))
  );

  await UserSkill.insertMany(
    data.userSkills.map((item) => ({
      legacyUserId: item.user_id,
      userId: ids.userIdMap.get(item.user_id) || null,
      skillName: item.skill_name,
      progress: item.progress || 0,
    }))
  );

  await UserQuest.insertMany(
    data.userQuests.map((item) => ({
      legacyId: item.id,
      legacyUserId: item.user_id,
      userId: ids.userIdMap.get(item.user_id) || null,
      questName: item.quest_name,
      questType: item.quest_type,
      target: item.target,
      current: item.current || 0,
      xpReward: item.xp_reward || 0,
      completed: Boolean(item.completed),
      createdAt: item.created_at || new Date(),
      updatedAt: item.created_at || new Date(),
    }))
  );
}

async function main() {
  try {
    await connectMongo();
    console.log('Loading PostgreSQL data...');
    const data = await loadPostgresData();

    console.log('Resetting MongoDB collections...');
    await resetMongoCollections();

    console.log('Migrating content...');
    const ids = await migrateContent(data);

    console.log('Migrating user progress...');
    await migrateProgress(data, ids);

    console.log('PostgreSQL to MongoDB migration complete');
  } catch (error) {
    console.error('Mongo migration failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
    await getMongoose().disconnect();
  }
}

main();
