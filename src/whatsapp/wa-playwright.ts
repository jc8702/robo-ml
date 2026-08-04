import { chromium, BrowserContext, Page } from 'playwright-core';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { findBrowserPath, isCloudEnvironment } from '../config/browser.js';
import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatIndividualOffer } from '../formatter/whatsapp.js';

const WA_PROFILE_DIR = join(process.cwd(), '.wa-profile');

let context: BrowserContext | null = null;
let waPage: Page | null = null;

export async function openWhatsAppBrowser(): Promise<{ context: BrowserContext; page: Page }> {
  if (context && waPage && !waPage.isClosed()) {
    return { context, page: waPage };
  }

  if (!existsSync(WA_PROFILE_DIR)) {
    mkdirSync(WA_PROFILE_DIR, { recursive: true });
  }

  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
  for (const lockFile of lockFiles) {
    const lockPath = join(WA_PROFILE_DIR, lockFile);
    if (existsSync(lockPath)) {
      try { unlinkSync(lockPath); } catch {}
    }
  }

  const isCloud = isCloudEnvironment();
  const executablePath = findBrowserPath();

  console.log(`[WA-PLAYWRIGHT] Iniciando navegador Chrome (Headless: ${isCloud})...`);

  context = await chromium.launchPersistentContext(WA_PROFILE_DIR, {
    executablePath,
    headless: isCloud,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const pages = context.pages();
  waPage = pages.length > 0 ? pages[0] : await context.newPage();

  console.log('[WA-PLAYWRIGHT] Navegando para https://web.whatsapp.com...');
  await waPage.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  return { context, page: waPage };
}

export async function isWhatsAppLoggedIn(page: Page): Promise<boolean> {
  try {
    const loggedInSelector = '#pane-side, [aria-label="Lista de conversas"], [data-icon="chat"], div[contenteditable="true"]';
    const element = await page.waitForSelector(loggedInSelector, { timeout: 8000 });
    return element !== null;
  } catch {
    return false;
  }
}

export async function ensureWhatsAppLoggedIn(): Promise<Page> {
  const { page } = await openWhatsAppBrowser();

  const loggedIn = await isWhatsAppLoggedIn(page);

  if (loggedIn) {
    console.log('[WA-PLAYWRIGHT] ✅ WhatsApp Web já está logado!');
    return page;
  }

  console.log('\n========================================');
  console.log('  📱 VINCULAR WHATSAPP - PLAYWRIGHT (CHROME)');
  console.log('========================================');
  console.log('  Uma janela do Chrome foi aberta com o WhatsApp Web!');
  console.log('  1. No seu celular: WhatsApp ➔ Configurações ➔ Dispositivos vinculados');
  console.log('  2. Escaneie o QR Code na tela do Chrome (ou clique em "Vincular com número de telefone")');
  console.log('========================================\n');

  try {
    // Tenta capturar screenshot do QR code para o servidor web /qr
    const qrCanvas = await page.$('canvas');
    if (qrCanvas) {
      await page.screenshot({ path: join(process.cwd(), 'wa-qr-screenshot.png') });
    }
  } catch {}

  try {
    await page.waitForSelector('#pane-side, [aria-label="Lista de conversas"], div[contenteditable="true"]', {
      timeout: 180000,
    });
    console.log('[WA-PLAYWRIGHT] ✅ Login efetuado com sucesso! Sessão salva em .wa-profile/');
  } catch {
    console.error('[WA-PLAYWRIGHT] ⏰ Tempo limite de 3 min excedido para efetuar login.');
  }

  return page;
}

/**
 * Envia uma oferta com foto via Playwright WhatsApp Web.
 */
export async function sendOfferWithPhotoPlaywright(
  offer: AffiliateOffer,
  targetGroupOrPhone: string
): Promise<boolean> {
  try {
    const page = await ensureWhatsAppLoggedIn();
    const caption = formatIndividualOffer(offer);

    const targetSearchTerm = process.env.WHATSAPP_GROUP_NAME || targetGroupOrPhone;
    console.log(`[WA-PLAYWRIGHT] Selecionando conversa/grupo: "${targetSearchTerm}"...`);

    // Procura a barra de pesquisa de conversas
    const searchSelector = '#side div[contenteditable="true"], [aria-label="Caixa de texto de pesquisa"], [aria-label="Pesquisar ou começar uma nova conversa"]';
    const searchBox = await page.waitForSelector(searchSelector, { timeout: 15000 });

    if (searchBox) {
      await searchBox.click();
      await searchBox.fill('');
      await searchBox.type(targetSearchTerm, { delay: 100 });
      await page.waitForTimeout(2000);

      // Pressiona Enter para abrir a conversa encontrada
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
    }

    // Se tiver imagem, baixa localmente para fazer upload
    if (offer.thumbnail && offer.thumbnail.startsWith('http')) {
      const tempImgPath = join(process.cwd(), `temp_offer_${Date.now()}.jpg`);
      try {
        const response = await fetch(offer.thumbnail);
        const buffer = await response.arrayBuffer();
        writeFileSync(tempImgPath, Buffer.from(buffer));

        // Clica no botão de anexar (+)
        const attachSelector = '[data-icon="plus"], [data-icon="clip"], [title="Anexar"]';
        const attachBtn = await page.$(attachSelector);
        if (attachBtn) {
          await attachBtn.click();
          await page.waitForTimeout(1000);
        }

        // Faz o upload no input de foto/vídeo
        const fileInput = await page.waitForSelector('input[type="file"][accept*="image"], input[type="file"]', {
          timeout: 10000,
        });

        if (fileInput) {
          await fileInput.setInputFiles(tempImgPath);
          await page.waitForTimeout(2000);

          // Digita a legenda no modal de pré-visualização
          const captionBox = await page.$('div[contenteditable="true"][aria-placeholder*="legenda"], div[contenteditable="true"]');
          if (captionBox) {
            await captionBox.click();
            await page.keyboard.insertText(caption);
            await page.waitForTimeout(1000);
          }

          // Clica no botão de enviar (ícone de avião/seta)
          const sendBtn = await page.waitForSelector('[data-icon="send"]', { timeout: 10000 });
          if (sendBtn) {
            await sendBtn.click();
            console.log(`[WA-PLAYWRIGHT] ✅ Foto + Oferta enviada: "${offer.title.substring(0, 30)}..."`);
          }
        }

        // Limpa arquivo temporário
        if (existsSync(tempImgPath)) rmSync(tempImgPath);
        return true;
      } catch (err) {
        console.error('[WA-PLAYWRIGHT] Erro ao carregar foto, enviando apenas texto:', err);
        if (existsSync(tempImgPath)) rmSync(tempImgPath);
      }
    }

    // Envio apenas texto caso não haja foto
    const messageBox = await page.waitForSelector('#main div[contenteditable="true"]', { timeout: 10000 });
    if (messageBox) {
      await messageBox.click();
      await page.keyboard.insertText(caption);
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      console.log(`[WA-PLAYWRIGHT] ✅ Oferta (texto) enviada: "${offer.title.substring(0, 30)}..."`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[WA-PLAYWRIGHT] Erro ao enviar mensagem:', error);
    return false;
  }
}
