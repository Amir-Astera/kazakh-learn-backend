const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const pool = require('./config/db');
const authRoutes = require('./routes/auth');
const moduleRoutes = require('./routes/modules');
const lessonRoutes = require('./routes/lessons');
const progressRoutes = require('./routes/progress');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Kazakh Learn API is running' });
});

const PORT = process.env.PORT || 5000;

async function ensureRuntimeSchema() {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE');
  await pool.query('ALTER TABLE units ADD COLUMN IF NOT EXISTS path_image_url VARCHAR(500)');
  await pool.query('ALTER TABLE units ADD COLUMN IF NOT EXISTS path_points JSONB');
  await pool.query('ALTER TABLE units ADD COLUMN IF NOT EXISTS landmark_position JSONB');
}

async function startServer() {
  try {
    await ensureRuntimeSchema();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Server startup schema error:', error);
    process.exit(1);
  }
}

startServer();
