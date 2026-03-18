const { Pool } = require('pg');
require('dotenv').config();

let poolInstance = null;

function createPool() {
  if (poolInstance) return poolInstance;

  poolInstance = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  poolInstance.on('connect', () => {
    console.log('Connected to PostgreSQL');
  });

  return poolInstance;
}

module.exports = {
  query(...args) {
    return createPool().query(...args);
  },

  connect(...args) {
    return createPool().connect(...args);
  },

  end(...args) {
    if (!poolInstance) return Promise.resolve();
    return poolInstance.end(...args);
  },

  getPool() {
    return createPool();
  },
};
