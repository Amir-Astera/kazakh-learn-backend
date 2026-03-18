require('dotenv').config();

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

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

function decodeSqlString(value) {
  return value.replace(/''/g, "'");
}

function splitSqlValues(tupleBody) {
  const parts = [];
  let current = '';
  let inString = false;

  for (let index = 0; index < tupleBody.length; index += 1) {
    const char = tupleBody[index];
    const next = tupleBody[index + 1];

    if (char === "'") {
      current += char;
      if (inString && next === "'") {
        current += next;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (char === ',' && !inString) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function extractSqlTuples(valuesBlock) {
  const tuples = [];
  let current = '';
  let depth = 0;
  let inString = false;

  for (let index = 0; index < valuesBlock.length; index += 1) {
    const char = valuesBlock[index];
    const next = valuesBlock[index + 1];

    if (char === "'") {
      current += char;
      if (inString && next === "'") {
        current += next;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (!inString && char === '(') {
      depth += 1;
      if (depth === 1) {
        current = '';
        continue;
      }
    }

    if (!inString && char === ')') {
      depth -= 1;
      if (depth === 0) {
        tuples.push(current);
        current = '';
        continue;
      }
    }

    if (depth >= 1) {
      current += char;
    }
  }

  return tuples;
}

function parseSqlLiteral(rawValue) {
  const value = rawValue.trim();

  if (/^NULL$/i.test(value)) return null;
  if (/^TRUE$/i.test(value)) return true;
  if (/^FALSE$/i.test(value)) return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  if (value.startsWith("'") && value.endsWith("'")) {
    return decodeSqlString(value.slice(1, -1));
  }

  return value;
}

function parseInsertStatement(sql) {
  const normalizedSql = sql.trim().replace(/;\s*$/, '');
  const match = normalizedSql.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+)$/i);
  if (!match) return null;

  const [, tableName, rawColumns, rawValues] = match;
  const columns = rawColumns.split(',').map((column) => column.trim());
  const tuples = extractSqlTuples(rawValues);

  const rows = tuples.map((tuple) => {
    const values = splitSqlValues(tuple).map(parseSqlLiteral);
    return columns.reduce((accumulator, columnName, index) => {
      accumulator[columnName] = values[index];
      return accumulator;
    }, {});
  });

  return {
    tableName: tableName.toLowerCase(),
    rows,
  };
}

function parseOptions(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : null;
  } catch (error) {
    return null;
  }
}

function loadMongoSeedSource() {
  const seedSourcePath = path.join(__dirname, 'seed.js');
  const source = fs.readFileSync(seedSourcePath, 'utf8');
  const queryRegex = /await pool\.query\(\s*`([\s\S]*?)`\s*\);/g;
  const tables = {
    levels: [],
    modules: [],
    units: [],
    lessons: [],
    exercises: [],
  };
  const counters = {
    levels: 0,
    modules: 0,
    units: 0,
    lessons: 0,
    exercises: 0,
  };

  let match = queryRegex.exec(source);
  while (match) {
    const parsed = parseInsertStatement(match[1]);
    if (parsed && tables[parsed.tableName]) {
      for (const row of parsed.rows) {
        counters[parsed.tableName] += 1;
        tables[parsed.tableName].push({
          id: counters[parsed.tableName],
          ...row,
        });
      }
    }

    match = queryRegex.exec(source);
  }

  return tables;
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

async function seedMongo() {
  const mongoose = getMongoose();

  try {
    await connectMongo();
    console.log('Seeding MongoDB...');

    await resetMongoCollections();

    const seedData = loadMongoSeedSource();
    const levelIdMap = new Map();
    const moduleIdMap = new Map();
    const unitIdMap = new Map();
    const lessonIdMap = new Map();

    const levelDocs = await Level.insertMany(
      seedData.levels.map((level) => ({
        legacyId: level.id,
        code: level.code,
        name: level.name,
        description: level.description || '',
        orderNum: level.order_num,
      }))
    );

    for (const levelDoc of levelDocs) {
      levelIdMap.set(levelDoc.legacyId, levelDoc._id);
    }

    const moduleDocs = await Module.insertMany(
      seedData.modules.map((moduleItem) => ({
        legacyId: moduleItem.id,
        levelId: levelIdMap.get(moduleItem.level_id),
        title: moduleItem.title,
        titleKz: moduleItem.title_kz || moduleItem.title,
        description: moduleItem.description || '',
        orderNum: moduleItem.order_num,
        requiredXp: moduleItem.required_xp || 0,
      }))
    );

    for (const moduleDoc of moduleDocs) {
      moduleIdMap.set(moduleDoc.legacyId, moduleDoc._id);
    }

    const unitDocs = await Unit.insertMany(
      seedData.units.map((unit) => ({
        legacyId: unit.id,
        moduleId: moduleIdMap.get(unit.module_id),
        title: unit.title,
        titleKz: unit.title_kz || unit.title,
        subtitle: unit.subtitle || '',
        icon: unit.icon || 'book',
        orderNum: unit.order_num,
        lessonCount: unit.lesson_count || 0,
        pathImageUrl: unit.path_image_url || null,
        pathPoints: [],
        landmarkPosition: null,
        landmarks: [],
      }))
    );

    for (const unitDoc of unitDocs) {
      unitIdMap.set(unitDoc.legacyId, unitDoc._id);
    }

    const lessonDocs = await Lesson.insertMany(
      seedData.lessons.map((lesson) => ({
        legacyId: lesson.id,
        unitId: unitIdMap.get(lesson.unit_id),
        title: lesson.title,
        type: lesson.type,
        xpReward: lesson.xp_reward || 0,
        orderNum: lesson.order_num,
      }))
    );

    for (const lessonDoc of lessonDocs) {
      lessonIdMap.set(lessonDoc.legacyId, lessonDoc._id);
    }

    await Exercise.insertMany(
      seedData.exercises.map((exercise) => ({
        legacyId: exercise.id,
        lessonId: lessonIdMap.get(exercise.lesson_id),
        type: exercise.type,
        question: exercise.question,
        questionAudio: exercise.question_audio || null,
        options: parseOptions(exercise.options),
        correctAnswer: exercise.correct_answer,
        explanation: exercise.explanation || null,
        orderNum: exercise.order_num,
      }))
    );

    const adminHash = await bcrypt.hash('admin123', 10);
    const testUserHash = await bcrypt.hash('123456', 10);
    await User.insertMany([
      {
        legacyId: 1,
        email: 'admin@kazakh.kz',
        passwordHash: adminHash,
        name: 'Administrator',
        isAdmin: true,
        xp: 0,
        streak: 1,
        lastActivity: null,
      },
      {
        legacyId: 2,
        email: 'test@test.com',
        passwordHash: testUserHash,
        name: 'Test User',
        isAdmin: false,
        xp: 0,
        streak: 1,
        lastActivity: null,
      },
    ]);

    console.log('MongoDB seed completed successfully!');
    console.log('Admin credentials: admin@kazakh.kz / admin123');
    console.log('Test credentials: test@test.com / 123456');
  } catch (error) {
    console.error('MongoDB seed error:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

seedMongo();
