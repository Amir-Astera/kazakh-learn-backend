const { getDbProvider } = require('../config/dbProvider');
const { connectMongo } = require('../config/mongo');

async function bootstrapDataLayer() {
  const provider = getDbProvider();

  await connectMongo();
  return { provider };
}

module.exports = {
  bootstrapDataLayer,
};
