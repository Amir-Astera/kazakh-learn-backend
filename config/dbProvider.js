require('dotenv').config();

function getDbProvider() {
  return 'mongo';
}

function isMongoProvider() {
  return true;
}

module.exports = {
  getDbProvider,
  isMongoProvider,
};
