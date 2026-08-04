/**
 * Script de Autenticação e Login do Facebook
 * Uso: npm run fb:connect
 *
 * - Abre o navegador Chrome na tela para efetuar login na sua conta do Facebook.
 * - Salva os cookies de sessão no arquivo local .fb-profile/ e no banco Neon PostgreSQL (FB_COOKIES_JSON).
 * - Permite que as postagens em grupos funcionem 100% logadas na nuvem (Render) e localmente.
 */
import 'dotenv/config';
import { openFacebookBrowser, saveFbCookiesToDb } from './facebook/fb-poster.js';
import { initDb } from './db/index.js';

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     📘  CONECTOR FACEBOOK (LOGIN & PERSISTÊNCIA)        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  await initDb().catch(() => {});
  const context = await openFacebookBrowser();
  const page = context.pages()[0] || await context.newPage();

  console.log('📘 Navegando para https://www.facebook.com...');
  await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });

  console.log('\n📌 Faça login na sua conta do Facebook na janela aberta do navegador.');
  console.log('⏳ Aguardando confirmação de login (tempo limite 5 minutos)...\n');

  try {
    await page.waitForSelector('[aria-label="Facebook"], [aria-label="Página inicial"], [role="banner"], [aria-label="Home"]', { timeout: 300000 });
    console.log('✅ Login no Facebook detectado com sucesso!');
    await saveFbCookiesToDb(context);
    console.log('💾 Sessão e cookies salvos no Neon PostgreSQL e no perfil local com sucesso!');
  } catch (err) {
    console.log('⚠️ Limite de tempo de login atingido. Salvando estado de cookies atual...');
    await saveFbCookiesToDb(context);
  }

  await context.close();
  console.log('📌 Conexão concluída. Agora a postagem em grupos do Facebook funcionará 100% autônoma.');
  process.exit(0);
}

main().catch(console.error);
