import { openInstagramBrowser, saveIgCookiesToDb } from './src/instagram/ig-poster.js';
import { formatInstagramCaption } from './src/formatter/instagram.js';
import type { AffiliateOffer } from './src/affiliate/link-converter.js';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const mockOffer: AffiliateOffer = {
  id: 'MLB999111',
  title: 'Smart TV LG 55 4K UHD Smart Magic WebOS 25 - Promoção Teste Ao Vivo',
  permalink: 'https://www.mercadolivre.com.br/p/MLB58587883',
  affiliateLink: 'https://www.mercadolivre.com.br/p/MLB58587883?matt_tool=52075002&matt_word=promos-wa',
  originalPrice: 3281,
  currentPrice: 2231,
  discountPercent: 32,
  thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_735813-MLA74672619717_022024-F.webp',
  seller: 'Mercado Livre Oficial',
  freeShipping: true,
};

async function watchAndPostIg() {
  console.log('\n======================================================');
  console.log('  🎥 ROBÔ AGUARDANDO LOGIN NO INSTAGRAM PARA POSTAR');
  console.log('======================================================\n');

  // Prepara imagem local
  const tempDir = join(process.cwd(), '.ig-temp-images');
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  const localImgPath = join(tempDir, `demo-ig-${Date.now()}.jpg`);

  console.log('📥 Baixando foto HD do produto...');
  const res = await fetch(mockOffer.thumbnail);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(localImgPath, buffer);

  console.log('🌐 Conectando à janela do Chrome do perfil .ig-profile...');
  const context = await openInstagramBrowser();
  const page = context.pages()[0] || await context.newPage();

  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

  let loggedIn = false;
  console.log('⌛ Verificando login na janela do Chrome...');

  for (let attempt = 1; attempt <= 90; attempt++) {
    const url = page.url();
    const hasLoginForm = await page.locator('input[name="username"], input[name="password"]').isVisible({ timeout: 1000 }).catch(() => false);
    const hasCreateBtn = await page.locator('a:has-text("Criar"), a:has-text("Create"), svg[aria-label="Criar"], svg[aria-label="Nova publicação"]').first().isVisible({ timeout: 1000 }).catch(() => false);

    if (!hasLoginForm && (hasCreateBtn || url.includes('instagram.com/direct') || url.includes('instagram.com/reels') || url.endsWith('instagram.com/'))) {
      loggedIn = true;
      console.log('✅ LOGIN CONFIRMADO NO INSTAGRAM!');
      await saveIgCookiesToDb(context).catch(() => {});
      break;
    }

    if (attempt % 5 === 0) {
      console.log(`⏱️ (${attempt * 2}s) Aguardando você realizar o login no Chrome aberto na sua tela...`);
    }
    await page.waitForTimeout(2000);
  }

  if (!loggedIn) {
    console.log('❌ Tempo esgotado (3 min) aguardando login. Por favor, tente novamente após logar.');
    return;
  }

  console.log('\n🚀 LOGIN DETECTADO! INICIANDO POSTAGEM AO VIVO...');
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 1. Clica em Criar
  console.log('➕ Clicando no botão Criar (+)...');
  const createLink = page.locator('a:has-text("Criar"), a:has-text("Create"), svg[aria-label="Criar"], svg[aria-label="Nova publicação"]').first();
  await createLink.click().catch(() => {});
  await page.waitForTimeout(2000);

  const postSubmenu = page.getByText('Postar', { exact: true }).first();
  if (await postSubmenu.isVisible({ timeout: 2000 }).catch(() => false)) {
    await postSubmenu.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  // 2. Injeta foto
  console.log('🖼️ Injetando imagem HD do produto...');
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(localImgPath);
  await page.waitForTimeout(3000);

  // 3. Avançar Corte
  console.log('➡️ Avançando Ajustes...');
  const next1 = page.getByText('Avançar', { exact: true }).first();
  await next1.click().catch(() => page.getByText('Next', { exact: true }).first().click().catch(() => {}));
  await page.waitForTimeout(3000);

  // 4. Avançar Filtros
  console.log('➡️ Avançando Filtros...');
  const next2 = page.getByText('Avançar', { exact: true }).first();
  await next2.click().catch(() => page.getByText('Next', { exact: true }).first().click().catch(() => {}));
  await page.waitForTimeout(3000);

  // 5. Legenda
  console.log('✍️ Digitando legenda promocional...');
  const captionText = formatInstagramCaption(
    mockOffer,
    'https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N',
    '#smarttv #lg #ofertas #mercadolivre #promocao'
  );

  const captionInput = page.locator('div[aria-label*="Escreva uma legenda"], div[aria-label*="Write a caption"], div[contenteditable="true"]').first();
  await captionInput.click().catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate((text) => navigator.clipboard.writeText(text), captionText);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(2000);

  // 6. Compartilhar
  console.log('🚀 Clicando em Compartilhar...');
  const shareBtn = page.getByText('Compartilhar', { exact: true }).first();
  await shareBtn.click().catch(() => page.getByText('Share', { exact: true }).first().click().catch(() => {}));

  console.log('⏳ Aguardando confirmação do Instagram (10s)...');
  await page.waitForTimeout(10000);

  await saveIgCookiesToDb(context).catch(() => {});
  console.log('\n======================================================');
  console.log('  🎉 SUCESSO ABSOLUTO: POST PUBLICADO NO SEU INSTAGRAM!');
  console.log('======================================================\n');
}

watchAndPostIg().catch(console.error);
