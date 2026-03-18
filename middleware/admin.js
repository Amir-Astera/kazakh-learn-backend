const jwt = require('jsonwebtoken');
const { isMongoProvider } = require('../config/dbProvider');
require('dotenv').config();

let mongooseModule = null;
let postgresPool = null;

function getMongooseModule() {
  if (!mongooseModule) {
    const { getMongoose } = require('../config/mongo');
    mongooseModule = getMongoose();
  }

  return mongooseModule;
}

function getPostgresPool() {
  if (!postgresPool) {
    postgresPool = require('../config/db');
  }

  return postgresPool;
}

function buildUserIdCriteria(userId) {
  const criteria = [];
  const numericId = Number(userId);
  if (Number.isInteger(numericId) && numericId > 0) {
    criteria.push({ legacyId: numericId });
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

async function isAdminMongo(userId) {
  const User = require('../models/User');
  const criteria = buildUserIdCriteria(userId);
  if (!criteria) return false;

  const user = await User.findOne(criteria).select('isAdmin').lean();
  return Boolean(user?.isAdmin);
}

async function isAdminPostgres(userId) {
  const result = await getPostgresPool().query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  return Boolean(result.rows[0]?.is_admin);
}

async function adminMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });

  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Неверный токен' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Токен недействителен' });
  }

  try {
    const isAdmin = isMongoProvider() ? await isAdminMongo(decoded.id) : await isAdminPostgres(decoded.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Доступ запрещён. Только для администраторов.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.error('Admin middleware error:', err);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
}

module.exports = adminMiddleware;
