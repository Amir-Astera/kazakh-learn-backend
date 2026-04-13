const express = require('express');
const { GoogleGenAI } = require('@google/genai');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const KAZAKH_SYSTEM_PROMPT = `Ты — умный помощник по казахскому языку. Твоя единственная задача — помогать пользователям изучать казахский язык.

Ты можешь:
- Объяснять грамматику казахского языка
- Переводить слова и фразы с/на казахский язык
- Рассказывать о казахском алфавите и произношении
- Давать примеры использования слов и конструкций
- Объяснять культурный контекст казахских выражений
- Проверять правильность написания на казахском
- Составлять диалоги для практики

Если пользователь задаёт вопрос НЕ по казахскому языку, вежливо откажи и предложи вернуться к теме казахского языка. Отвечай на том языке, на котором задан вопрос (русский или английский), если это помогает объяснению.`;

/** Порядок моделей: сначала лёгкие/актуальные для бесплатного tier, затем запасные варианты. */
const DEFAULT_MODEL_ORDER = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

/**
 * Список моделей: переменная GEMINI_MODELS (через запятую) или одна GEMINI_MODEL.
 * Пример: GEMINI_MODELS=gemini-2.5-flash-lite,gemini-2.5-flash
 */
function resolveModelOrder() {
  const raw = process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || '';
  if (typeof raw === 'string' && raw.trim()) {
    const parts = raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      const rest = DEFAULT_MODEL_ORDER.filter((m) => !parts.includes(m));
      return [...parts, ...rest];
    }
  }
  return [...DEFAULT_MODEL_ORDER];
}

function shouldTryNextModel(err) {
  const msg = err && err.message != null ? String(err.message) : String(err);
  return /quota|exceeded|limit:\s*0|RESOURCE_EXHAUSTED|\b429\b|not found|NOT_FOUND|unsupported|UNIMPLEMENTED|PERMISSION_DENIED/i.test(msg);
}

async function generateReply(apiKey, validMessages) {
  const ai = new GoogleGenAI({ apiKey });
  const modelOrder = resolveModelOrder();
  const contents = validMessages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  let lastErr = null;
  for (const model of modelOrder) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: KAZAKH_SYSTEM_PROMPT,
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      });
      const text = response && typeof response.text === 'string' ? response.text.trim() : '';
      if (text) {
        return text;
      }
      lastErr = new Error('Пустой ответ от модели');
    } catch (err) {
      lastErr = err;
      if (shouldTryNextModel(err)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Не удалось получить ответ ни от одной модели');
}

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Необходимо передать массив сообщений' });
    }

    const validMessages = messages.filter(
      (m) => m && typeof m.role === 'string' && typeof m.content === 'string' && m.content.trim()
    );

    if (validMessages.length === 0) {
      return res.status(400).json({ error: 'Нет валидных сообщений' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Сервис чата временно недоступен' });
    }

    const reply = await generateReply(apiKey, validMessages);
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    const msg = err && err.message != null ? String(err.message) : '';

    if (/quota|exceeded|limit:\s*0|RESOURCE_EXHAUSTED/i.test(msg)) {
      return res.status(503).json({
        error:
          'Исчерпана квота запросов к Google Gemini на бесплатном тарифе или для выбранных моделей. Включите оплату в Google AI Studio, смените ключ или задайте список моделей в GEMINI_MODELS. Справка: https://ai.google.dev/gemini-api/docs/rate-limits',
      });
    }

    res.status(500).json({ error: 'Ошибка при обращении к AI-ассистенту' });
  }
});

module.exports = router;
