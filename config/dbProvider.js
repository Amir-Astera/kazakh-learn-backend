require('dotenv').config();

const SUPPORTED_PROVIDERS = new Set(['postgres', 'mongo']);

function getDbProvider() {
  const rawProvider = String(process.env.DB_PROVIDER || 'postgres').trim().toLowerCase();
  return SUPPORTED_PROVIDERS.has(rawProvider) ? rawProvider : 'postgres';
}

function isPostgresProvider() {
  return getDbProvider() === 'postgres';
}

function isMongoProvider() {
  return getDbProvider() === 'mongo';
}

module.exports = {
  getDbProvider,
  isPostgresProvider,
  isMongoProvider,
};
