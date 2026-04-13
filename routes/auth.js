const express = require('express');
const https = require('https');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  findUserByEmail,
  createUserWithDefaults,
  updateUserLoginState,
  getCurrentUserById,
  updateUserProfile,
  findOrCreateGoogleUser,
  completeOnboardingSurvey,
} = require('../repositories/authRepository');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const WEEKLY_STUDY_OPTIONS = [5, 10, 15, 20];

function parseAllowedWeeklyMinutes(value) {
  const n = Number(value);
  return WEEKLY_STUDY_OPTIONS.includes(n) ? n : null;
}

// Register
router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      language_pair,
      learning_goal,
      proficiency_level,
      age,
      weekly_study_minutes,
    } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    const ageNum = Number(age);
    const weeklyNum = parseAllowedWeeklyMinutes(weekly_study_minutes);
    if (!Number.isFinite(ageNum) || ageNum < 7 || ageNum > 100) {
      return res.status(400).json({ error: 'Укажите возраст от 7 до 100 лет' });
    }
    if (weeklyNum == null) {
      return res.status(400).json({ error: 'Выберите 5, 10, 15 или 20 минут в неделю' });
    }

    const normalizedLanguagePair = ['ru-kz', 'en-kz'].includes(String(language_pair || '').trim().toLowerCase())
      ? String(language_pair).trim().toLowerCase()
      : 'ru-kz';
    const normalizedLearningGoal = ['general', 'travel', 'study', 'work'].includes(String(learning_goal || '').trim().toLowerCase())
      ? String(learning_goal).trim().toLowerCase()
      : 'general';
    const normalizedProficiencyLevel = ['beginner', 'elementary', 'intermediate'].includes(String(proficiency_level || '').trim().toLowerCase())
      ? String(proficiency_level).trim().toLowerCase()
      : 'beginner';

    // Check if user exists
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const user = await createUserWithDefaults({
      email,
      passwordHash: password_hash,
      name,
      languagePair: normalizedLanguagePair,
      learningGoal: normalizedLearningGoal,
      proficiencyLevel: normalizedProficiencyLevel,
      age: ageNum,
      weeklyStudyMinutes: weeklyNum,
    });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const safeUser = await getCurrentUserById(user.id);

    res.status(201).json({ token, user: safeUser });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: 'Неверный email или пароль' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Неверный email или пароль' });
    }

    // Update streak
    const today = new Date().toISOString().split('T')[0];
    const lastActivity = user.last_activity ? new Date(user.last_activity).toISOString().split('T')[0] : null;

    let newStreak = user.streak;
    if (lastActivity) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      if (lastActivity === yesterday) {
        newStreak = user.streak + 1;
      } else if (lastActivity !== today) {
        newStreak = 1;
      }
    } else {
      newStreak = 1;
    }

    await updateUserLoginState(user.id, newStreak);

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const fullUser = await getCurrentUserById(user.id);
    if (!fullUser) {
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    res.json({
      token,
      user: { ...fullUser, streak: newStreak },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/onboarding', authMiddleware, async (req, res) => {
  try {
    const { age, weekly_study_minutes } = req.body || {};
    const ageNum = Number(age);
    const weeklyNum = parseAllowedWeeklyMinutes(weekly_study_minutes);
    if (!Number.isFinite(ageNum) || ageNum < 7 || ageNum > 100) {
      return res.status(400).json({ error: 'Укажите возраст от 7 до 100 лет' });
    }
    if (weeklyNum == null) {
      return res.status(400).json({ error: 'Выберите 5, 10, 15 или 20 минут в неделю' });
    }

    const user = await completeOnboardingSurvey(req.user.id, { ...req.body, weekly_study_minutes: weeklyNum });
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(user);
  } catch (err) {
    console.error('Onboarding error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await getCurrentUserById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(user);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, avatar_url, language_pair, learning_goal, proficiency_level } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Имя обязательно' });
    }

    const normalizedLanguagePair = ['ru-kz', 'en-kz'].includes(String(language_pair || '').trim().toLowerCase())
      ? String(language_pair).trim().toLowerCase()
      : 'ru-kz';
    const normalizedLearningGoal = ['general', 'travel', 'study', 'work'].includes(String(learning_goal || '').trim().toLowerCase())
      ? String(learning_goal).trim().toLowerCase()
      : 'general';
    const normalizedProficiencyLevel = ['beginner', 'elementary', 'intermediate'].includes(String(proficiency_level || '').trim().toLowerCase())
      ? String(proficiency_level).trim().toLowerCase()
      : 'beginner';

    const user = await updateUserProfile(req.user.id, {
      name,
      avatar_url,
      language_pair: normalizedLanguagePair,
      learning_goal: normalizedLearningGoal,
      proficiency_level: normalizedProficiencyLevel,
    });

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(user);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Google OAuth – redirect to Google
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

  if (!clientId) {
    return res.status(503).json({ error: 'Google OAuth не настроен' });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Google OAuth – callback
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!code) {
    return res.redirect(`${frontendUrl}/login?error=google_failed`);
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

    // Exchange code for tokens
    const tokenData = await new Promise((resolve, reject) => {
      const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString();

      const options = {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      request.on('error', reject);
      request.write(body);
      request.end();
    });

    if (!tokenData.access_token) {
      return res.redirect(`${frontendUrl}/login?error=google_failed`);
    }

    // Fetch user info
    const userInfo = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'www.googleapis.com',
        path: '/oauth2/v2/userinfo',
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      };

      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      request.on('error', reject);
      request.end();
    });

    if (!userInfo.email) {
      return res.redirect(`${frontendUrl}/login?error=google_failed`);
    }

    const user = await findOrCreateGoogleUser({
      googleId: userInfo.id,
      email: userInfo.email,
      name: userInfo.name || userInfo.email.split('@')[0],
      avatarUrl: userInfo.picture || null,
    });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Redirect to frontend with token
    res.redirect(`${frontendUrl}/auth/google/success?token=${token}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect(`${frontendUrl}/login?error=google_failed`);
  }
});

module.exports = router;
