/**
 * Источник данных для npm run db:seed (парсится db/seed-mongo.js через regex).
 * Файл не запускается Node: нужны только строковые литералы в формате pool.query + шаблонная строка.
 */

await pool.query(`
INSERT INTO levels (id, code, name, description, order_num) VALUES
(1, 'A1', 'Бастауыш деңгей', 'Демо-контент репозитория', 1);
`);

await pool.query(`
INSERT INTO modules (id, level_id, title, title_kz, description, order_num, required_xp) VALUES
(1, 1, 'Танысу', 'Танысу', '', 1, 0);
`);

await pool.query(`
INSERT INTO units (id, module_id, title, title_kz, subtitle, icon, order_num, lesson_count, path_image_url) VALUES
(1, 1, 'Алғашқы сабақтар', 'Первые уроки', '', 'book', 1, 1, NULL);
`);

await pool.query(`
INSERT INTO lessons (id, unit_id, title, type, xp_reward, order_num) VALUES
(1, 1, 'Сәлеметсіз бе', 'translation', 10, 1);
`);

await pool.query(`
INSERT INTO exercises (id, lesson_id, type, question, question_audio, options, correct_answer, explanation, order_num) VALUES
(1, 1, 'choice', 'How do you say hello in Kazakh?', NULL, '["Сәлем", "Рахмет", "Кешіріңіз"]', 'Сәлем', NULL, 1);
`);
