require('dotenv').config();

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

async function initMongo() {
  const mongoose = getMongoose();

  try {
    await connectMongo();

    await Promise.all([
      User.init(),
      Level.init(),
      Module.init(),
      Unit.init(),
      Lesson.init(),
      Exercise.init(),
      UserUnitProgress.init(),
      UserLessonProgress.init(),
      UserSkill.init(),
      UserQuest.init(),
    ]);

    console.log('MongoDB initialized successfully');
  } catch (error) {
    console.error('MongoDB init error:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

initMongo();
