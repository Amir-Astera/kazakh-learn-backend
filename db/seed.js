const pool = require('../config/db');

async function seed() {
  try {
    console.log('Seeding database...');

    // Ensure new columns/tables exist
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE units ADD COLUMN IF NOT EXISTS path_image_url VARCHAR(500)');
    await pool.query('ALTER TABLE units ADD COLUMN IF NOT EXISTS path_points JSONB');
    await pool.query('ALTER TABLE units ADD COLUMN IF NOT EXISTS landmark_position JSONB');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS landmarks (
        id SERIAL PRIMARY KEY,
        unit_id INTEGER REFERENCES units(id) ON DELETE CASCADE,
        image_url VARCHAR(500) NOT NULL,
        alt_text VARCHAR(300) NOT NULL,
        position JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('ALTER TABLE landmarks DROP CONSTRAINT IF EXISTS landmarks_unit_id_key');
    await pool.query('ALTER TABLE landmarks ADD COLUMN IF NOT EXISTS position JSONB');

    // Clear existing data
    await pool.query('DELETE FROM user_quests');
    await pool.query('DELETE FROM user_skills');
    await pool.query('DELETE FROM user_lesson_progress');
    await pool.query('DELETE FROM user_progress');
    await pool.query('DELETE FROM landmarks');
    await pool.query('DELETE FROM exercises');
    await pool.query('DELETE FROM lessons');
    await pool.query('DELETE FROM units');
    await pool.query('DELETE FROM modules');
    await pool.query('DELETE FROM levels');
    await pool.query('DELETE FROM users');

    // Reset sequences
    await pool.query("ALTER SEQUENCE levels_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE modules_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE units_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE lessons_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE exercises_id_seq RESTART WITH 1");

    // ─── LEVELS ───
    await pool.query(`
      INSERT INTO levels (code, name, description, order_num) VALUES
      ('A1', 'Beginner', 'Начальный уровень — базовые фразы и слова', 1),
      ('A2', 'Elementary', 'Элементарный уровень — простые предложения', 2),
      ('B1', 'Intermediate', 'Средний уровень — свободное общение', 3)
    `);

    // ─── MODULES ───
    await pool.query(`
      INSERT INTO modules (level_id, title, title_kz, description, order_num, required_xp) VALUES
      (1, 'First Steps', 'Алғашқы қадамдар', 'Базовые приветствия и знакомство', 1, 0),
      (1, 'Beginners Path', 'Бастауыш жол', 'Числа, семья и повседневные темы', 2, 200),
      (2, 'Intermediate Path', 'Орташа жол', 'Время, описания, предложения', 3, 550),
      (2, 'Everyday Life', 'Күнделікті өмір', 'Покупки, транспорт, здоровье', 4, 900),
      (3, 'Advanced Topics', 'Күрделі тақырыптар', 'Культура, традиции, свободное общение', 5, 1500)
    `);

    // ─── UNITS ───
    // Module 1: First Steps
    await pool.query(`
      INSERT INTO units (module_id, title, title_kz, subtitle, icon, lesson_count, order_num) VALUES
      (1, 'Alphabet', 'Әліпби', 'Kazakh Alphabet · 5 lessons', 'alphabet', 5, 1),
      (1, 'Basic Phrases', 'Негізгі сөздер', 'Key Phrases · 4 lessons', 'chat', 4, 2),
      (1, 'Introductions', 'Танысу', 'Meeting People · 5 lessons', 'people', 5, 3)
    `);

    // Module 2: Beginners Path
    await pool.query(`
      INSERT INTO units (module_id, title, title_kz, subtitle, icon, lesson_count, order_num) VALUES
      (2, 'Greetings', 'Сәлемдесу', 'Greetings · 6 lessons', 'wave', 6, 1),
      (2, 'Numbers', 'Сандар', 'Numbers · 5 lessons', 'numbers', 5, 2),
      (2, 'Family', 'Отбасы', 'Family · Grammar · 7 lessons', 'family', 7, 3),
      (2, 'Food', 'Тағам', 'Food & Drinks · 5 lessons', 'food', 5, 4),
      (2, 'Directions', 'Бағыттар', 'Directions · 6 lessons', 'directions', 6, 5)
    `);

    // Module 3: Intermediate Path
    await pool.query(`
      INSERT INTO units (module_id, title, title_kz, subtitle, icon, lesson_count, order_num) VALUES
      (3, 'Time', 'Уақыт', 'Time & Schedule · 5 lessons', 'clock', 5, 1),
      (3, 'Descriptions', 'Сипаттамалар', 'Adjectives & Descriptions · 6 lessons', 'description', 6, 2),
      (3, 'Sentences', 'Сөйлемдер', 'Building Sentences · 5 lessons', 'sentence', 5, 3)
    `);

    // Module 4: Everyday Life
    await pool.query(`
      INSERT INTO units (module_id, title, title_kz, subtitle, icon, lesson_count, order_num) VALUES
      (4, 'Shopping', 'Сауда', 'Shopping · 5 lessons', 'shop', 5, 1),
      (4, 'Transport', 'Көлік', 'Transport · 4 lessons', 'transport', 4, 2),
      (4, 'Health', 'Денсаулық', 'Health · 5 lessons', 'health', 5, 3)
    `);

    // ─── LESSONS for Module 1 units ───

    // Unit 1: Alphabet (Әліпби) — 5 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (1, 'Дауысты дыбыстар — Гласные', 'choice', 10, 1),
      (1, 'Дауыссыз дыбыстар — Согласные', 'choice', 10, 2),
      (1, 'Ерекше әріптер — Особые буквы', 'translation', 10, 3),
      (1, 'Оқу жаттығуы — Читаем слоги', 'choice', 15, 4),
      (1, 'Алфавит тесті — Тест по алфавиту', 'translation', 20, 5)
    `);

    // Unit 2: Basic Phrases (Негізгі сөздер) — 4 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (2, 'Иә / Жоқ — Да / Нет', 'translation', 10, 1),
      (2, 'Мен, Сен, Ол — Я, Ты, Он', 'grammar', 10, 2),
      (2, 'Бұл не? — Что это?', 'translation', 15, 3),
      (2, 'Негізгі сөздер тесті — Тест', 'sentence', 20, 4)
    `);

    // Unit 3: Introductions (Танысу) — 5 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (3, 'Менің атым — Моё имя', 'translation', 10, 1),
      (3, 'Сіздің атыңыз кім? — Как вас зовут?', 'choice', 10, 2),
      (3, 'Мен студентпін — Я студент', 'translation', 10, 3),
      (3, 'Қайдансыз? — Откуда вы?', 'speaking', 15, 4),
      (3, 'Танысу диалогы — Диалог', 'listening', 20, 5)
    `);

    // ─── LESSONS for Module 2 units ───

    // Unit: Greetings (Сәлемдесу) — 6 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (4, 'Сәлем — Привет', 'translation', 10, 1),
      (4, 'Қалыңыз қалай? — Как дела?', 'choice', 10, 2),
      (4, 'Сау болыңыз — До свидания', 'translation', 10, 3),
      (4, 'Кешіріңіз — Извините', 'choice', 15, 4),
      (4, 'Рахмет — Спасибо', 'listening', 15, 5),
      (4, 'Диалог: Знакомство', 'sentence', 20, 6)
    `);

    // Unit: Numbers (Сандар) — 5 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (5, 'Числа 1-10', 'choice', 10, 1),
      (5, 'Числа 11-20', 'choice', 10, 2),
      (5, 'Десятки: 10-100', 'translation', 15, 3),
      (5, 'Сколько стоит?', 'sentence', 15, 4),
      (5, 'Числа в жизни', 'listening', 20, 5)
    `);

    // Unit: Family (Отбасы) — 7 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (6, 'Ана, Әке — Мама, Папа', 'translation', 10, 1),
      (6, 'Аға, Іні — Брат старший, младший', 'choice', 10, 2),
      (6, 'Апа, Сіңлі — Сестра', 'translation', 10, 3),
      (6, 'Ата, Әже — Дедушка, Бабушка', 'choice', 10, 4),
      (6, 'Менің отбасым — Моя семья', 'sentence', 15, 6),
      (6, 'Притяжательные окончания', 'grammar', 15, 5),
      (6, 'Рассказ о семье', 'speaking', 20, 7)
    `);

    // Unit: Food (Тағам) — 5 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (7, 'Нан, Сүт, Ет — Хлеб, Молоко, Мясо', 'translation', 10, 1),
      (7, 'Жемістер — Фрукты', 'choice', 10, 2),
      (7, 'Көкөністер — Овощи', 'choice', 10, 3),
      (7, 'Мәзір — Меню', 'sentence', 15, 4),
      (7, 'Кафеде — В кафе', 'listening', 20, 5)
    `);

    // Unit: Directions (Бағыттар) — 6 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (8, 'Оң, Сол — Право, Лево', 'translation', 10, 1),
      (8, 'Алға, Артқа — Вперёд, Назад', 'choice', 10, 2),
      (8, 'Қайда? — Где?', 'translation', 10, 3),
      (8, 'Жол сұрау — Спросить дорогу', 'sentence', 15, 4),
      (8, 'Қалада — В городе', 'listening', 15, 5),
      (8, 'Маршрут сипаттау — Описание маршрута', 'speaking', 20, 6)
    `);

    // ─── LESSONS for Module 3 units ───

    // Unit 9: Time (Уақыт) — 5 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (9, 'Сағат неше? — Который час?', 'translation', 10, 1),
      (9, 'Таңертең, түс, кеш — Утро, день, вечер', 'choice', 10, 2),
      (9, 'Апта күндері — Дни недели', 'translation', 15, 3),
      (9, 'Айлар — Месяцы', 'choice', 15, 4),
      (9, 'Кесте — Расписание', 'sentence', 20, 5)
    `);

    // Unit 10: Descriptions (Сипаттамалар) — 6 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (10, 'Үлкен, кіші — Большой, маленький', 'translation', 10, 1),
      (10, 'Түстер — Цвета', 'choice', 10, 2),
      (10, 'Сын есім — Прилагательные', 'grammar', 10, 3),
      (10, 'Адамды сипаттау — Описание человека', 'sentence', 15, 4),
      (10, 'Затты сипаттау — Описание предмета', 'listening', 15, 5),
      (10, 'Сипаттама диалогы — Диалог', 'speaking', 20, 6)
    `);

    // Unit 11: Sentences (Сөйлемдер) — 5 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (11, 'Сұраулы сөйлем — Вопросительные', 'grammar', 10, 1),
      (11, 'Болымсыз сөйлем — Отрицательные', 'grammar', 10, 2),
      (11, 'Жалғаулар — Союзы', 'grammar', 15, 3),
      (11, 'Құрмалас сөйлем — Сложные предложения', 'sentence', 15, 4),
      (11, 'Эссе жазу — Написание текста', 'speaking', 20, 5)
    `);

    // ─── LESSONS for Module 4 units ───

    // Unit 12: Shopping (Сауда) — 5 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (12, 'Дүкенде — В магазине', 'translation', 10, 1),
      (12, 'Бағасы қанша? — Сколько стоит?', 'grammar', 10, 2),
      (12, 'Киім — Одежда', 'translation', 15, 3),
      (12, 'Базарда — На базаре', 'sentence', 15, 4),
      (12, 'Сауда диалогы — Диалог покупки', 'listening', 20, 5)
    `);

    // Unit 13: Transport (Көлік) — 4 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (13, 'Көлік түрлері — Виды транспорта', 'choice', 10, 1),
      (13, 'Автобус, такси — Общественный транспорт', 'translation', 10, 2),
      (13, 'Билет алу — Покупка билета', 'sentence', 15, 3),
      (13, 'Жолда — В пути', 'listening', 20, 4)
    `);

    // Unit 14: Health (Денсаулық) — 5 lessons
    await pool.query(`
      INSERT INTO lessons (unit_id, title, type, xp_reward, order_num) VALUES
      (14, 'Дене мүшелері — Части тела', 'translation', 10, 1),
      (14, 'Ауырады — Болит', 'choice', 10, 2),
      (14, 'Дәрігерде — У врача', 'translation', 15, 3),
      (14, 'Дәріхана — Аптека', 'sentence', 15, 4),
      (14, 'Денсаулық диалогы — Диалог о здоровье', 'speaking', 20, 5)
    `);

    // ─── EXERCISES ───

    // === Module 1 Exercises ===

    // Alphabet Lesson 1: Гласные (lesson_id=1)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (1, 'choice', 'Сколько букв в казахском алфавите?', '["33", "42", "38", "26"]', '42', 'Казахский алфавит содержит 42 буквы — 33 русских + 9 специфических', 1),
      (1, 'choice', 'Какая буква есть в казахском, но нет в русском?', '["А", "Ә", "Б", "В"]', 'Ә', 'Ә — специфическая казахская буква, звучит как открытый "э"', 2),
      (1, 'choice', 'Выберите все казахские гласные', '["Ә, Ө, Ү, І", "Б, В, Г, Д", "Қ, Ғ, Ң, Һ", "Ш, Щ, Ч, Ц"]', 'Ә, Ө, Ү, І', 'Специфические казахские гласные: Ә, Ө, Ү, І', 3),
      (1, 'choice', 'Как звучит буква "Ө"?', '["Как О", "Как между О и Ё", "Как У", "Как А"]', 'Как между О и Ё', 'Ө — мягкий звук между О и Ё', 4)
    `);

    // Alphabet Lesson 2: Согласные (lesson_id=2)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (2, 'choice', 'Какая буква обозначает глубокий "К"?', '["К", "Қ", "Г", "Ғ"]', 'Қ', 'Қ — глубокий звук К, произносится в горле', 1),
      (2, 'choice', 'Что за буква "Ң"?', '["Звук НГ", "Звук Н", "Звук М", "Звук Г"]', 'Звук НГ', 'Ң — носовой звук, похожий на английское NG', 2),
      (2, 'choice', 'Выберите специфическую казахскую согласную', '["Б", "Ғ", "Д", "Л"]', 'Ғ', 'Ғ — глубокий звук Г, произносится в горле', 3),
      (2, 'choice', 'Какая буква звучит как мягкий "Г"?', '["Қ", "Ғ", "Ң", "Һ"]', 'Ғ', NULL, 4)
    `);

    // Alphabet Lesson 3: Особые буквы (lesson_id=3)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (3, 'translation', 'Переведите букву: "Ү"', '["Мягкий У", "Жёсткий У", "Звук О", "Звук А"]', 'Мягкий У', 'Ү — мягкий вариант звука У', 1),
      (3, 'translation', 'Как произносится "І"?', '["Как мягкий И", "Как Ы", "Как Э", "Как У"]', 'Как мягкий И', 'І — мягкий звук И', 2),
      (3, 'choice', 'Сколько специфических букв в казахском алфавите?', '["5", "9", "12", "3"]', '9', 'Специфические буквы: Ә, Ғ, Қ, Ң, Ө, Ү, Ұ, І, Һ', 3),
      (3, 'translation', 'Какой звук у буквы "Ұ"?', '["Твёрдый У", "Мягкий У", "Звук О", "Звук А"]', 'Твёрдый У', 'Ұ — твёрдый/глубокий У', 4)
    `);

    // Alphabet Lesson 4: Читаем слоги (lesson_id=4)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (4, 'choice', 'Прочитайте слог: "Ба"', '["Ба", "Па", "Да", "Ма"]', 'Ба', NULL, 1),
      (4, 'choice', 'Какой слог читается как "Кы"?', '["Қы", "Ки", "Ғы", "Гі"]', 'Қы', 'Қ используется с твёрдыми гласными', 2),
      (4, 'choice', 'Прочитайте: "Әке"', '["Аке", "Эке", "Оке", "Уке"]', 'Эке', 'Ә читается как открытый Э', 3),
      (4, 'choice', 'Как правильно прочитать "Көл"?', '["Кол", "Көл (мягкий)", "Гол", "Кул"]', 'Көл (мягкий)', 'Ө делает слог мягким. Көл — озеро', 4)
    `);

    // Alphabet Lesson 5: Тест (lesson_id=5)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (5, 'translation', 'Назовите 9 специфических казахских букв', '["Ә,Ғ,Қ,Ң,Ө,Ү,Ұ,І,Һ", "А,Б,В,Г,Д,Е,Ж,З,И", "Ш,Щ,Ч,Ц,Ъ,Ь,Э,Ю,Я", "К,Л,М,Н,О,П,Р,С,Т"]', 'Ә,Ғ,Қ,Ң,Ө,Ү,Ұ,І,Һ', NULL, 1),
      (5, 'choice', 'Какая буква НЕ является специфической казахской?', '["Ә", "Б", "Қ", "Ғ"]', 'Б', 'Б есть и в русском алфавите', 2),
      (5, 'translation', 'Переведите слово "Ана"', '["Мама", "Папа", "Брат", "Сестра"]', 'Мама', 'Ана — мама', 3),
      (5, 'choice', 'Что означает слово "Су"?', '["Огонь", "Вода", "Земля", "Воздух"]', 'Вода', 'Су — вода', 4)
    `);

    // Basic Phrases Lesson 1: Да/Нет (lesson_id=6)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (6, 'translation', 'Переведите: "Да"', '["Иә", "Жоқ", "Мүмкін", "Білмеймін"]', 'Иә', 'Иә — да', 1),
      (6, 'translation', 'Переведите: "Нет"', '["Жоқ", "Иә", "Бар", "Жақсы"]', 'Жоқ', 'Жоқ — нет', 2),
      (6, 'choice', 'Что означает "Бар"?', '["Нет", "Есть/Имеется", "Был", "Будет"]', 'Есть/Имеется', 'Бар — есть, имеется. Антоним: Жоқ', 3),
      (6, 'choice', 'Как сказать "Не знаю"?', '["Білмеймін", "Иә", "Жоқ", "Түсіндім"]', 'Білмеймін', 'Білмеймін — не знаю', 4)
    `);

    // Basic Phrases Lesson 2: Местоимения (lesson_id=7)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (7, 'choice', 'Как сказать "Я" на казахском?', '["Мен", "Сен", "Ол", "Біз"]', 'Мен', 'Мен — я', 1),
      (7, 'choice', 'Что означает "Сен"?', '["Я", "Ты", "Он", "Мы"]', 'Ты', 'Сен — ты (неформально)', 2),
      (7, 'translation', 'Переведите: "Он/Она"', '["Ол", "Мен", "Сен", "Олар"]', 'Ол', 'Ол — он/она (в казахском нет рода)', 3),
      (7, 'choice', 'Как сказать "Мы"?', '["Мен", "Сен", "Біз", "Олар"]', 'Біз', 'Біз — мы', 4)
    `);

    // Basic Phrases Lesson 3: Что это? (lesson_id=8)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (8, 'translation', 'Переведите: "Что это?"', '["Бұл не?", "Ол кім?", "Қайда?", "Неге?"]', 'Бұл не?', 'Бұл не? — Что это?', 1),
      (8, 'translation', 'Как сказать "Это книга"?', '["Бұл кітап", "Бұл қалам", "Бұл дәптер", "Бұл үстел"]', 'Бұл кітап', 'Кітап — книга', 2),
      (8, 'choice', 'Что означает "Қалам"?', '["Книга", "Ручка", "Стол", "Тетрадь"]', 'Ручка', 'Қалам — ручка', 3),
      (8, 'choice', 'Переведите: "Бұл не? — Бұл үй"', '["Что это? — Это дом", "Кто это? — Это друг", "Где это? — Это здесь", "Когда? — Сейчас"]', 'Что это? — Это дом', 'Үй — дом', 4)
    `);

    // Basic Phrases Lesson 4: Тест (lesson_id=9)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (9, 'choice', 'Как сказать "Пожалуйста"?', '["Өтінемін", "Рахмет", "Кешіріңіз", "Сәлем"]', 'Өтінемін', 'Өтінемін — пожалуйста (просьба)', 1),
      (9, 'translation', 'Переведите: "Я не знаю"', '["Мен білмеймін", "Мен түсінемін", "Мен барамын", "Мен жақсымын"]', 'Мен білмеймін', NULL, 2),
      (9, 'choice', 'Что означает "Түсіндім"?', '["Не понял", "Понял", "Забыл", "Вспомнил"]', 'Понял', 'Түсіндім — понял/поняла', 3),
      (9, 'translation', 'Как сказать "Это мой друг"?', '["Бұл менің досым", "Бұл сенің досың", "Бұл оның досы", "Бұл біздің досымыз"]', 'Бұл менің досым', 'Досым — мой друг', 4)
    `);

    // Introductions Lesson 1: Моё имя (lesson_id=10)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (10, 'translation', 'Переведите: "Моё имя..."', '["Менің атым...", "Сенің атың...", "Оның аты...", "Біздің атымыз..."]', 'Менің атым...', 'Менің атым — моё имя', 1),
      (10, 'translation', 'Как сказать "Меня зовут Айдар"?', '["Менің атым Айдар", "Мен Айдармын", "Айдар менің", "Атым Айдар мен"]', 'Менің атым Айдар', NULL, 2),
      (10, 'choice', 'Что означает "Атыңыз кім?"', '["Сколько вам лет?", "Как вас зовут?", "Откуда вы?", "Где вы живёте?"]', 'Как вас зовут?', 'Атыңыз кім? — Как вас зовут? (вежливо)', 3),
      (10, 'choice', 'Как ответить на "Атыңыз кім?"', '["Менің атым...", "Мен жақсымын", "Иә, рахмет", "Сау болыңыз"]', 'Менің атым...', NULL, 4)
    `);

    // Introductions Lesson 2: Как вас зовут? (lesson_id=11)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (11, 'choice', 'Формальный вопрос "Как вас зовут?"', '["Сіздің атыңыз кім?", "Сенің атың кім?", "Оның аты кім?", "Атың кім?"]', 'Сіздің атыңыз кім?', 'Сіз — вежливая форма "вы"', 1),
      (11, 'choice', 'Неформальный вопрос "Как тебя зовут?"', '["Сенің атың кім?", "Сіздің атыңыз кім?", "Менің атым кім?", "Оның аты кім?"]', 'Сенің атың кім?', 'Сен — ты (неформально)', 2),
      (11, 'translation', 'Переведите: "Приятно познакомиться"', '["Танысқаныма қуаныштымын", "Сәлеметсіз бе", "Қош келдіңіз", "Сау болыңыз"]', 'Танысқаныма қуаныштымын', NULL, 3),
      (11, 'choice', 'Что означает "Танысайық"?', '["До свидания", "Давайте познакомимся", "Как дела", "Спасибо"]', 'Давайте познакомимся', 'Танысайық — давайте познакомимся', 4)
    `);

    // Introductions Lesson 3: Я студент (lesson_id=12)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (12, 'translation', 'Переведите: "Я студент"', '["Мен студентпін", "Мен мұғаліммін", "Мен дәрігермін", "Мен жұмысшымын"]', 'Мен студентпін', 'Студент + пін = я студент', 1),
      (12, 'choice', 'Что означает "Мұғалім"?', '["Студент", "Учитель", "Врач", "Инженер"]', 'Учитель', 'Мұғалім — учитель', 2),
      (12, 'translation', 'Как сказать "Я врач"?', '["Мен дәрігермін", "Мен студентпін", "Мен мұғаліммін", "Мен инженермін"]', 'Мен дәрігермін', 'Дәрігер — врач', 3),
      (12, 'choice', 'Как будет "Инженер" на казахском?', '["Инженер", "Дәрігер", "Мұғалім", "Студент"]', 'Инженер', 'Инженер — заимствованное слово, произносится так же', 4)
    `);

    // Introductions Lesson 4: Откуда вы? (lesson_id=13)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (13, 'speaking', 'Произнесите фразу "Откуда вы?"', NULL, 'Сіз қайдансыз?', 'Қайдансыз — откуда вы', 1),
      (13, 'speaking', 'Произнесите фразу "Я из Алматы"', NULL, 'Мен Алматыданмын', '-дан/-ден — окончание "из"', 2),
      (13, 'speaking', 'Произнесите слово "Город"', NULL, 'Қала', 'Қала — город', 3),
      (13, 'speaking', 'Произнесите слово "Қазақстан"', NULL, 'Қазақстан', 'На казахском пишется через Қ', 4)
    `);

    // Introductions Lesson 5: Диалог (lesson_id=14)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (14, 'choice', 'Что ответить на "Сәлеметсіз бе! Атыңыз кім?"', '["Сәлеметсіз бе! Менің атым...", "Сау болыңыз!", "Рахмет!", "Жоқ"]', 'Сәлеметсіз бе! Менің атым...', NULL, 1),
      (14, 'choice', 'Продолжите диалог: "Танысқаныма қуаныштымын"', '["Мен де қуаныштымын", "Сау болыңыз", "Рахмет", "Жоқ"]', 'Мен де қуаныштымын', 'Мен де — я тоже', 2),
      (14, 'translation', 'Переведите: "Мне 20 лет"', '["Маған 20 жас", "Менің 20 жасым", "Мен 20 жаспын", "Маған 20 жыл"]', 'Маған 20 жас', NULL, 3),
      (14, 'choice', 'Как закончить разговор вежливо?', '["Сау болыңыз, көріскенше!", "Кет!", "Жоқ!", "Білмеймін"]', 'Сау болыңыз, көріскенше!', 'Стандартное вежливое прощание', 4)
    `);

    // === Module 2 Exercises ===
    // Lesson IDs shifted by 14: old 1→15, old 2→16, old 3→17, old 7→21, old 12→26, old 19→33

    // Greetings Lesson 1: Сәлем (lesson_id=15)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (15, 'translation', 'Переведите: "Привет"', '["Сәлем", "Сау бол", "Рахмет", "Кешіріңіз"]', 'Сәлем', 'Сәлем — самое распространённое приветствие на казахском', 1),
      (15, 'translation', 'Переведите: "Здравствуйте"', '["Сәлеметсіз бе", "Сәлем", "Қош келдіңіз", "Сау болыңыз"]', 'Сәлеметсіз бе', 'Сәлеметсіз бе — формальное приветствие', 2),
      (15, 'choice', 'Что означает "Сәлем"?', '["До свидания", "Привет", "Спасибо", "Пожалуйста"]', 'Привет', NULL, 3),
      (15, 'translation', 'Как сказать "Добро пожаловать"?', '["Қош келдіңіз", "Сәлем", "Рахмет", "Кетіңіз"]', 'Қош келдіңіз', 'Қош келдіңіз используют, когда встречают гостей', 4)
    `);

    // Greetings Lesson 2: Қалыңыз қалай? (lesson_id=16)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (16, 'choice', 'Как спросить "Как дела?" на казахском?', '["Қалыңыз қалай?", "Атыңыз кім?", "Қайда барасыз?", "Не істейсіз?"]', 'Қалыңыз қалай?', 'Қалыңыз қалай? — вежливая форма', 1),
      (16, 'choice', 'Выберите правильный ответ на "Қалыңыз қалай?"', '["Жақсы, рахмет", "Сәлем", "Кешіріңіз", "Сау бол"]', 'Жақсы, рахмет', 'Жақсы — хорошо, рахмет — спасибо', 2),
      (16, 'translation', 'Переведите: "Хорошо, спасибо"', '["Жақсы, рахмет", "Жаман, кешіріңіз", "Сәлем, дос", "Сау бол"]', 'Жақсы, рахмет', NULL, 3),
      (16, 'choice', 'Что означает "Жаман"?', '["Хорошо", "Плохо", "Нормально", "Отлично"]', 'Плохо', 'Жаман — плохо. Антоним: Жақсы — хорошо', 4)
    `);

    // Greetings Lesson 3: Сау болыңыз (lesson_id=17)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (17, 'translation', 'Переведите: "До свидания" (вежливо)', '["Сау болыңыз", "Сәлем", "Кешіріңіз", "Рахмет"]', 'Сау болыңыз', 'Сау болыңыз — формальное прощание', 1),
      (17, 'translation', 'Как сказать "Пока" (неформально)?', '["Сау бол", "Сау болыңыз", "Көріскенше", "Кетіңіз"]', 'Сау бол', 'Сау бол — неформальное прощание для друзей', 2),
      (17, 'choice', 'Что означает "Көріскенше"?', '["Привет", "До встречи", "Спасибо", "Извините"]', 'До встречи', 'Көріскенше — до встречи, до скорого', 3),
      (17, 'translation', 'Переведите: "Доброй ночи"', '["Қайырлы түн", "Қайырлы таң", "Қайырлы кеш", "Сау бол"]', 'Қайырлы түн', NULL, 4)
    `);

    // Numbers Lesson 1: 1-10 (lesson_id=21)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (21, 'choice', 'Как будет "один" на казахском?', '["Бір", "Екі", "Үш", "Төрт"]', 'Бір', NULL, 1),
      (21, 'choice', 'Переведите: "Үш"', '["Один", "Два", "Три", "Четыре"]', 'Три', 'Бір, Екі, Үш — 1, 2, 3', 2),
      (21, 'translation', 'Как сказать "пять"?', '["Бес", "Алты", "Жеті", "Сегіз"]', 'Бес', NULL, 3),
      (21, 'choice', 'Что означает "Он"?', '["Пять", "Восемь", "Десять", "Семь"]', 'Десять', 'Он — десять. Не путайте с русским "он"!', 4),
      (21, 'translation', 'Расположите числа: 1, 2, 3', '["Бір, Екі, Үш", "Екі, Бір, Үш", "Үш, Бір, Екі", "Бір, Үш, Екі"]', 'Бір, Екі, Үш', NULL, 5)
    `);

    // Family Lesson 1: Ана, Әке (lesson_id=26)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (26, 'translation', 'Переведите: "Мама"', '["Ана", "Әке", "Апа", "Әже"]', 'Ана', 'Ана — мама, мать', 1),
      (26, 'translation', 'Как сказать "Папа"?', '["Әке", "Ана", "Аға", "Ата"]', 'Әке', 'Әке — папа, отец', 2),
      (26, 'choice', 'Что означает "Ата"?', '["Папа", "Мама", "Дедушка", "Брат"]', 'Дедушка', 'Ата — дедушка. Әке — папа', 3),
      (26, 'choice', 'Что означает "Әже"?', '["Мама", "Бабушка", "Сестра", "Тётя"]', 'Бабушка', 'Әже — бабушка', 4)
    `);

    // Food Lesson 1: Нан, Сүт, Ет (lesson_id=33)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (33, 'translation', 'Переведите: "Хлеб"', '["Нан", "Сүт", "Ет", "Су"]', 'Нан', 'Нан — хлеб, один из основных продуктов казахской кухни', 1),
      (33, 'translation', 'Как сказать "Молоко"?', '["Сүт", "Нан", "Шай", "Ет"]', 'Сүт', 'Сүт — молоко', 2),
      (33, 'choice', 'Что означает "Ет"?', '["Хлеб", "Вода", "Мясо", "Чай"]', 'Мясо', 'Ет — мясо. Основа казахской кухни', 3),
      (33, 'choice', 'Что означает "Су"?', '["Молоко", "Чай", "Вода", "Сок"]', 'Вода', 'Су — вода', 4)
    `);

    // === Module 3 Exercises ===

    // Time Lesson 1: Который час? (lesson_id=44)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (44, 'translation', 'Переведите: "Который час?"', '["Сағат неше?", "Қанша?", "Қашан?", "Неше жас?"]', 'Сағат неше?', 'Сағат неше? — Который час?', 1),
      (44, 'choice', 'Как сказать "3 часа"?', '["Сағат үш", "Сағат бес", "Сағат бір", "Сағат он"]', 'Сағат үш', 'Сағат + число', 2),
      (44, 'translation', 'Переведите: "Сейчас 5 часов"', '["Қазір сағат бес", "Ертең сағат бес", "Кеше сағат бес", "Бүгін сағат бес"]', 'Қазір сағат бес', 'Қазір — сейчас', 3),
      (44, 'choice', 'Что означает "Жарты"?', '["Четверть", "Половина", "Минута", "Секунда"]', 'Половина', 'Жарты — половина. Сағат бес жарты = 5:30', 4)
    `);

    // Time Lesson 2: Время суток (lesson_id=45)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (45, 'choice', 'Как сказать "Утро"?', '["Таңертең", "Түс", "Кеш", "Түн"]', 'Таңертең', 'Таңертең — утро', 1),
      (45, 'choice', 'Что означает "Кеш"?', '["Утро", "День", "Вечер", "Ночь"]', 'Вечер', 'Кеш — вечер', 2),
      (45, 'translation', 'Переведите: "Доброе утро"', '["Қайырлы таң", "Қайырлы кеш", "Қайырлы түн", "Сәлеметсіз"]', 'Қайырлы таң', 'Қайырлы таң — Доброе утро', 3),
      (45, 'choice', 'Как будет "Ночь"?', '["Таңертең", "Түс", "Кеш", "Түн"]', 'Түн', 'Түн — ночь', 4)
    `);

    // Descriptions Lesson 1: Большой/маленький (lesson_id=49)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (49, 'translation', 'Переведите: "Большой"', '["Үлкен", "Кіші", "Ұзын", "Қысқа"]', 'Үлкен', 'Үлкен — большой', 1),
      (49, 'translation', 'Как сказать "Маленький"?', '["Кіші", "Үлкен", "Жаңа", "Ескі"]', 'Кіші', 'Кіші — маленький', 2),
      (49, 'choice', 'Что означает "Жаңа"?', '["Старый", "Новый", "Красивый", "Плохой"]', 'Новый', 'Жаңа — новый. Антоним: Ескі — старый', 3),
      (49, 'choice', 'Антоним слова "Ұзын" (длинный)?', '["Қысқа", "Кіші", "Үлкен", "Жаңа"]', 'Қысқа', 'Қысқа — короткий', 4)
    `);

    // Shopping Lesson 1: В магазине (lesson_id=60)
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (60, 'translation', 'Переведите: "Магазин"', '["Дүкен", "Базар", "Кафе", "Үй"]', 'Дүкен', 'Дүкен — магазин', 1),
      (60, 'choice', 'Как спросить "Сколько стоит?"', '["Бұл қанша тұрады?", "Бұл не?", "Бұл қайда?", "Бұл кімдікі?"]', 'Бұл қанша тұрады?', 'Қанша тұрады? — Сколько стоит?', 2),
      (60, 'translation', 'Переведите: "Мне нужно..."', '["Маған ... керек", "Менде ... бар", "Мен ... білемін", "Мен ... көрдім"]', 'Маған ... керек', 'Керек — нужно, необходимо', 3),
      (60, 'choice', 'Что означает "Арзан"?', '["Дорого", "Дёшево", "Красиво", "Большой"]', 'Дёшево', 'Арзан — дёшево. Антоним: Қымбат — дорого', 4)
    `);

    // ─── SPEAKING EXERCISES ───

    // Family speaking (lesson_id=32): Рассказ о семье
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (32, 'speaking', 'Произнесите слово "Мама"', NULL, 'Ана', 'Ана — мама', 1),
      (32, 'speaking', 'Произнесите слово "Папа"', NULL, 'Әке', 'Әке — папа', 2),
      (32, 'speaking', 'Произнесите слово "Дедушка"', NULL, 'Ата', 'Ата — дедушка', 3),
      (32, 'speaking', 'Произнесите слово "Бабушка"', NULL, 'Әже', 'Әже — бабушка', 4),
      (32, 'speaking', 'Произнесите фразу "Моя семья"', NULL, 'Менің отбасым', 'Менің отбасым — моя семья', 5)
    `);

    // Directions speaking (lesson_id=43): Маршрут сипаттау
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (43, 'speaking', 'Произнесите слово "Направо"', NULL, 'Оң', 'Оң — направо, правая сторона', 1),
      (43, 'speaking', 'Произнесите слово "Налево"', NULL, 'Сол', 'Сол — налево, левая сторона', 2),
      (43, 'speaking', 'Произнесите слово "Вперёд"', NULL, 'Алға', 'Алға — вперёд', 3),
      (43, 'speaking', 'Произнесите вопрос "Где?"', NULL, 'Қайда?', 'Қайда? — где?', 4),
      (43, 'speaking', 'Произнесите фразу "Прямо"', NULL, 'Тура', 'Тура — прямо, прямой путь', 5)
    `);

    // Descriptions speaking (lesson_id=54): Сипаттама диалогы
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (54, 'speaking', 'Произнесите слово "Большой"', NULL, 'Үлкен', 'Үлкен — большой', 1),
      (54, 'speaking', 'Произнесите слово "Маленький"', NULL, 'Кіші', 'Кіші — маленький', 2),
      (54, 'speaking', 'Произнесите слово "Красивый"', NULL, 'Әдемі', 'Әдемі — красивый, красивая', 3),
      (54, 'speaking', 'Произнесите слово "Новый"', NULL, 'Жаңа', 'Жаңа — новый', 4),
      (54, 'speaking', 'Произнесите слово "Хороший"', NULL, 'Жақсы', 'Жақсы — хороший, хорошо', 5)
    `);

    // Sentences speaking (lesson_id=59): Эссе жазу
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (59, 'speaking', 'Произнесите "Привет"', NULL, 'Сәлем', 'Сәлем — привет (неформальное)', 1),
      (59, 'speaking', 'Произнесите "Спасибо"', NULL, 'Рахмет', 'Рахмет — спасибо', 2),
      (59, 'speaking', 'Произнесите "Извините"', NULL, 'Кешіріңіз', 'Кешіріңіз — извините (вежливо)', 3),
      (59, 'speaking', 'Произнесите "До свидания"', NULL, 'Сау болыңыз', 'Сау болыңыз — до свидания (вежливо)', 4),
      (59, 'speaking', 'Произнесите фразу "Я понял"', NULL, 'Түсіндім', 'Түсіндім — понял/поняла', 5)
    `);

    // Health speaking (lesson_id=73): Денсаулық диалогы
    await pool.query(`
      INSERT INTO exercises (lesson_id, type, question, options, correct_answer, explanation, order_num) VALUES
      (73, 'speaking', 'Произнесите слово "Голова"', NULL, 'Бас', 'Бас — голова', 1),
      (73, 'speaking', 'Произнесите слово "Рука"', NULL, 'Қол', 'Қол — рука', 2),
      (73, 'speaking', 'Произнесите слово "Нога"', NULL, 'Аяқ', 'Аяқ — нога', 3),
      (73, 'speaking', 'Произнесите фразу "Болит"', NULL, 'Ауырады', 'Ауырады — болит', 4),
      (73, 'speaking', 'Произнесите слово "Доктор"', NULL, 'Дәрігер', 'Дәрігер — врач, доктор', 5)
    `);

    // ─── ADMIN USER ───
    const bcrypt = require('bcryptjs');
    const adminHash = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, name, is_admin) VALUES ('admin@kazakh.kz', $1, 'Administrator', TRUE)`,
      [adminHash]
    );

    console.log('Seed completed successfully!');
    console.log('Admin credentials: admin@kazakh.kz / admin123');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

seed();
