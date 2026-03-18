const { getDbProvider, isPostgresProvider } = require('../config/dbProvider');
const { connectMongo } = require('../config/mongo');
const { ensurePostgresRuntimeSchema } = require('./runtimeSchema');

async function bootstrapDataLayer() {
  const provider = getDbProvider();

  if (isPostgresProvider()) {
    await ensurePostgresRuntimeSchema();
    return { provider };
  }

  await connectMongo();
  return { provider };
}

module.exports = {
  bootstrapDataLayer,
};
