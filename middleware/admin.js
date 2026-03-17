const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

async function adminMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });

  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Неверный токен' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [decoded.id]);
    if (!result.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Доступ запрещён. Только для администраторов.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Токен недействителен' });
  }
}

module.exports = adminMiddleware;
