const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { getDbProvider } = require('./config/dbProvider');
const { bootstrapDataLayer } = require('./db/bootstrap');
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
  res.json({
    status: 'ok',
    message: 'Kazakh Learn API is running',
    db_provider: getDbProvider(),
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    const { provider } = await bootstrapDataLayer();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} (${provider})`);
    });
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

startServer();
