const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function initDB() {
  // First connect without database to create it
  const adminPool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    // Create database if not exists
    const dbCheck = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [process.env.DB_NAME]
    );

    if (dbCheck.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${process.env.DB_NAME}`);
      console.log(`Database "${process.env.DB_NAME}" created`);
    } else {
      console.log(`Database "${process.env.DB_NAME}" already exists`);
    }
  } finally {
    await adminPool.end();
  }

  // Now connect to the new database and run schema
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf-8'
    );
    await pool.query(schemaSQL);
    console.log('Schema created successfully');
  } catch (err) {
    console.error('Error creating schema:', err.message);
  } finally {
    await pool.end();
  }
}

initDB();
