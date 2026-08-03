/**
 * Script de Reset Completo da Conexão WhatsApp.
 *
 * Uso: npm run wa:reset
 *
 * Limpa completamente as pastas de sessão local (.wa-auth/ e .wa-profile/) E a sessão salva no Neon PostgreSQL.
 * Permite começar uma conexão 100% limpa a partir do zero.
 */
import 'dotenv/config';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDbPool } from './db/index.js';

const AUTH_DIR = join(process.cwd(), '.wa-auth');
const PROFILE_DIR = join(process.cwd(), '.wa-profile');

async function resetWhatsApp() {
  console.log('\n🧹 ====================================================');
  console.log('🧹 RESET COMPLETO DA CONEXÃO DO WHATSAPP');
  console.log('====================================================\n');

  // 1. Limpa pasta local .wa-auth
  if (existsSync(AUTH_DIR)) {
    try {
      rmSync(AUTH_DIR, { recursive: true, force: true });
      mkdirSync(AUTH_DIR, { recursive: true });
      console.log('✅ Pasta local .wa-auth/ removida e recriada.');
    } catch (err) {
      console.error('⚠️ Erro ao remover .wa-auth/:', err);
    }
  }

  // 2. Limpa perfil de navegador .wa-profile
  if (existsSync(PROFILE_DIR)) {
    try {
      rmSync(PROFILE_DIR, { recursive: true, force: true });
      mkdirSync(PROFILE_DIR, { recursive: true });
      console.log('✅ Perfil Chrome .wa-profile/ removido e recriado.');
    } catch (err) {
      console.error('⚠️ Erro ao remover .wa-profile/:', err);
    }
  }

  // 3. Limpa dados no Neon PostgreSQL (se configurado)
  const db = getDbPool();
  if (db) {
    try {
      await db.query("DELETE FROM app_settings WHERE key LIKE 'WA_AUTH_%'");
      console.log('✅ Sessão antiga removida do banco de dados Neon PostgreSQL.');
    } catch (err) {
      console.log('ℹ️ Aviso banco de dados:', (err as Error)?.message || err);
    }
  } else {
    console.log('ℹ️ PostgreSQL não conectado (apenas limpeza local efetuada).');
  }

  console.log('\n✨ Reset concluído com sucesso!');
  console.log('👉 Agora você pode rodar "npm run wa:connect" para vincular do zero.\n');
  process.exit(0);
}

resetWhatsApp();
