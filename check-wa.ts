import 'dotenv/config';
import { getDbPool, dbGetSettings } from './src/db/index.js';

async function check() {
  const db = getDbPool();
  if (!db) {
    console.log('No DB pool');
    return;
  }
  const res = await db.query("SELECT key FROM app_settings");
  console.log('All keys count:', res.rows.length);
  res.rows.forEach(r => console.log(' - key:', r.key));

  const settings = await dbGetSettings();
  console.log('WHATSAPP_GROUP_ID:', settings.WHATSAPP_GROUP_ID);
  console.log('WHATSAPP_GROUP_NAME:', settings.WHATSAPP_GROUP_NAME);
  process.exit(0);
}

check();
