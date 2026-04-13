const express = require('express');
const https = require('https');
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

function callGeminiApi(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const contents = messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const body = JSON.stringify({
      system_instruction: { parts: [{ text: KAZAKH_SYSTEM_PROMPT }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return reject(new Error(parsed.error.message || 'Gemini API error'));
          }
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text);
        } catch (err) {
          reject(new Error('Failed to parse Gemini response'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
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

    const reply = await callGeminiApi(apiKey, validMessages);

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Ошибка при обращении к AI-ассистенту' });
  }
});

module.exports = router;
