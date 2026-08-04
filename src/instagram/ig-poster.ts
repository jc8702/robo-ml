import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatInstagramCaption } from '../formatter/instagram.js';
import { findBrowserPath, isCloudEnvironment } from '../config/browser.js';

export const IG_PROFILE_DIR = resolve(process.cwd(), '.ig-profile');
const TEMP_IMG_DIR = resolve(process.cwd(), '.ig-temp-images');

if (!existsSync(IG_PROFILE_DIR)) {
  mkdirSync(IG_PROFILE_DIR, { recursive: true });
}
if (!existsSync(TEMP_IMG_DIR)) {
  mkdirSync(TEMP_IMG_DIR, { recursive: true });
}

function cleanProfileLock(profileDir: string) {
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
  for (const lockFile of lockFiles) {
    const lockPath = join(profileDir, lockFile);
    if (existsSync(lockPath)) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Se estiver bloqueado por outro processo, ignora
      }
    }
  }
}

let activeIgContext: BrowserContext | null = null;

export async function openInstagramBrowser(): Promise<BrowserContext> {
  if (activeIgContext && activeIgContext.pages().length > 0) {
    try {
      const pages = activeIgContext.pages();
      if (pages.length > 0 && !pages[0].isClosed()) {
        return activeIgContext;
      }
    } catch {
      activeIgContext = null;
    }
  }

  const executablePath = findBrowserPath();
  const isCloud = isCloudEnvironment();

  cleanProfileLock(IG_PROFILE_DIR);

  const contextOptions: any = {
    headless: isCloud,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-notifications',
      '--disable-blink-features=AutomationControlled',
    ],
  };

  if (executablePath && !isCloud) {
    contextOptions.executablePath = executablePath;
  }

  const context = await chromium.launchPersistentContext(IG_PROFILE_DIR, contextOptions);
  activeIgContext = context;
  return context;
}

function randomDelay(minMs = 1500, maxMs = 3500): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadOfferImage(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = `ig-img-${Date.now()}.jpg`;
    const filePath = join(TEMP_IMG_DIR, fileName);
    writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    console.error('[IG] Erro ao baixar imagem da oferta:', err);
    return null;
  }
}

/**
 * Publica uma oferta no Instagram (Feed / Post com Foto)
 */
export async function postOfferToInstagram(
  offer: AffiliateOffer,
  options?: { bioLink?: string; hashtags?: string }
): Promise<boolean> {
  console.log(`\n📸 [INSTAGRAM] Iniciando postagem da oferta: "${offer.title.slice(0, 40)}..."`);
  let localImagePath: string | null = null;

  try {
    // 1. Baixa a foto do produto em HD
    if (offer.thumbnail) {
      localImagePath = await downloadOfferImage(offer.thumbnail);
    }

    if (!localImagePath || !existsSync(localImagePath)) {
      console.log('  ⚠️ Não foi possível obter imagem em HD para o Instagram. Pulando postagem.');
      return false;
    }

    const context = await openInstagramBrowser();
    const page = context.pages()[0] || await context.newPage();

    // 2. Navega para o Instagram
    console.log('  📷 Acessando Instagram...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay(3000, 5000);

    // Verifica se está logado
    const isLoggedOut = await page.locator('input[name="username"], input[aria-label*="Phone number, username"]').isVisible().catch(() => false);
    if (isLoggedOut) {
      console.log('  ⚠️ Instagram não está logado no navegador. Conecte sua conta usando a ferramenta "Conectar-Instagram.bat" ou acesse a tela visual.');
      return false;
    }

    // 3. Clica no botão de Criar Nova Publicação (+)
    console.log('  ➕ Abrindo criador de nova publicação (+)...');
    const createBtnSelectors = [
      'svg[aria-label="Nova publicação"]',
      'svg[aria-label="New post"]',
      'svg[aria-label="Criar"]',
      'svg[aria-label="Create"]',
      '[aria-label="Nova publicação"]',
      '[aria-label="New post"]',
      '[aria-label="Criar"]',
    ];

    let clickedCreate = false;
    for (const sel of createBtnSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          await el.click();
          clickedCreate = true;
          break;
        }
      } catch { /* próximo */ }
    }

    if (!clickedCreate) {
      const textBtn = page.locator('text="Criar", text="Create"').first();
      if (await textBtn.isVisible({ timeout: 2000 })) {
        await textBtn.click();
        clickedCreate = true;
      }
    }

    if (!clickedCreate) {
      console.log('  ❌ Não foi possível encontrar o botão (+) de criar publicação no Instagram.');
      return false;
    }

    await randomDelay(2000, 3000);

    // 4. Seleciona o arquivo de imagem do computador
    console.log('  🖼️ Selecionando arquivo de imagem...');
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });

    const selectFromComputerBtn = page.locator('button:has-text("Selecionar do computador"), button:has-text("Select from computer")').first();
    if (await selectFromComputerBtn.isVisible({ timeout: 3000 })) {
      await selectFromComputerBtn.click();
    } else {
      await page.locator('div[role="dialog"] input[type="file"]').setInputFiles(localImagePath).catch(() => {});
    }

    const fileChooser = await fileChooserPromise.catch(() => null);
    if (fileChooser) {
      await fileChooser.setFiles(localImagePath);
    }
    await randomDelay(2500, 4000);

    // 5. Clica em "Avançar" / "Next" (Corte/Proporção)
    console.log('  ➡️ Avançando tela de ajuste de foto...');
    const nextBtn1 = page.locator('div[role="dialog"] button:has-text("Avançar"), div[role="dialog"] button:has-text("Next")').first();
    if (await nextBtn1.isVisible({ timeout: 5000 })) {
      await nextBtn1.click();
      await randomDelay(2000, 3000);
    }

    // 6. Clica em "Avançar" / "Next" (Filtros)
    console.log('  ➡️ Avançando tela de filtros...');
    const nextBtn2 = page.locator('div[role="dialog"] button:has-text("Avançar"), div[role="dialog"] button:has-text("Next")').first();
    if (await nextBtn2.isVisible({ timeout: 5000 })) {
      await nextBtn2.click();
      await randomDelay(2000, 3000);
    }

    // 7. Escreve a legenda persuasiva de alto engajamento
    console.log('  ✍️ Digitando legenda formatada...');
    const captionText = formatInstagramCaption(offer, options?.bioLink, options?.hashtags);

    const captionBox = page.locator('div[role="dialog"] div[aria-label*="Escreva uma legenda"], div[role="dialog"] div[aria-label*="Write a caption"], div[role="dialog"] div[contenteditable="true"]').first();
    if (await captionBox.isVisible({ timeout: 5000 })) {
      await captionBox.click();
      await randomDelay(500, 1000);
      await page.keyboard.type(captionText, { delay: 5 });
      await randomDelay(1500, 2500);
    } else {
      console.log('  ⚠️ Caixa de legenda não encontrada no Instagram.');
    }

    // 8. Clica em "Compartilhar" / "Share"
    console.log('  🚀 Compartilhando publicação no Instagram...');
    const shareBtn = page.locator('div[role="dialog"] button:has-text("Compartilhar"), div[role="dialog"] button:has-text("Share")').first();
    if (await shareBtn.isVisible({ timeout: 5000 })) {
      await shareBtn.click();
      console.log('  ⏳ Processando publicação...');
      await randomDelay(6000, 9000);
      console.log('  ✅ Oferta publicada com sucesso no Instagram!');
      return true;
    } else {
      console.log('  ❌ Botão Compartilhar não localizado.');
      return false;
    }
  } catch (err) {
    console.error(`  ❌ Erro ao postar oferta no Instagram: ${err}`);
    return false;
  }
}
