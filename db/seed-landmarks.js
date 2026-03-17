const pool = require('../config/db');
const path = require('path');
const fs = require('fs');

async function seedLandmarks() {
  try {
    const uploadDir = path.join(__dirname, '../uploads/landmarks');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const assets = [
      { file: 'Koleso.png',    alt: 'Көк-Төбе — Колесо обозрения' },
      { file: 'panfilov.png',  alt: 'Парк 28 Панфиловцев' },
      { file: 'trk.png',       alt: 'Алматинская телебашня' },
    ];

    const srcDir = path.join(__dirname, '../../kazakh-learn-front/src/assets');

    for (let i = 0; i < assets.length; i++) {
      const { file, alt } = assets[i];
      const src = path.join(srcDir, file);
      const dest = path.join(uploadDir, file);

      if (!fs.existsSync(src)) { console.warn(`Файл не найден: ${src}`); continue; }
      fs.copyFileSync(src, dest);
      console.log(`Скопирован: ${file}`);

      const unitRes = await pool.query(
        'SELECT id FROM units WHERE module_id = 1 ORDER BY order_num LIMIT 1 OFFSET $1',
        [i]
      );
      if (!unitRes.rows[0]) { console.warn(`Юнит ${i} не найден`); continue; }

      const unitId = unitRes.rows[0].id;
      await pool.query(
        `INSERT INTO landmarks (unit_id, image_url, alt_text)
         VALUES ($1, $2, $3)
         ON CONFLICT (unit_id) DO UPDATE SET image_url=$2, alt_text=$3`,
        [unitId, `/uploads/landmarks/${file}`, alt]
      );
      console.log(`Привязан: ${alt} → unit_id=${unitId}`);
    }

    console.log('\nГотово! Достопримечательности добавлены в БД.');
    process.exit(0);
  } catch (err) {
    console.error('Ошибка:', err.message);
    process.exit(1);
  }
}

seedLandmarks();
