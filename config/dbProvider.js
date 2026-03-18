require('dotenv').config();

const SUPPORTED_PROVIDERS = new Set(['postgres', 'mongo']);

function getDbProvider() {
  const rawProvider = String(process.env.DB_PROVIDER || 'mongo').trim().toLowerCase();
  return SUPPORTED_PROVIDERS.has(rawProvider) ? rawProvider : 'mongo';
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
