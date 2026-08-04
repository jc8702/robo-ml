import 'dotenv/config';
import { initDb, getDbPool } from './src/db/index.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

async function syncWaCreds() {
  await initDb();
  const db = getDbPool();
  if (!db) {
    console.error('❌ Falha ao conectar ao banco Neon DB.');
    process.exit(1);
  }

  const authDir = join(process.cwd(), '.wa-auth');

  if (!existsSync(authDir)) {
    console.error('❌ Diretório .wa-auth/ não localizado.');
    process.exit(1);
  }

  const files = readdirSync(authDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('❌ Nenhum arquivo de sessão .json localizado em .wa-auth/');
    process.exit(1);
  }

  try {
    for (const file of files) {
      const content = readFileSync(join(authDir, file), 'utf-8');
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [`WA_AUTH_${file}`, content]
      );
    }
    console.log(`✅ ${files.length} arquivos de sessão do WhatsApp (.wa-auth/*.json) sincronizados com SUCESSO no Neon PostgreSQL Cloud!`);
  } catch (err) {
    console.error('❌ Erro ao salvar credenciais do WhatsApp no Neon DB:', err);
  } finally {
    await db.end();
  }
}

syncWaCreds();
