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

  const contextOptions: any = {
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
  };

  if (executablePath && !isCloud) {
    contextOptions.executablePath = executablePath;
  }

  try {
    context = await chromium.launchPersistentContext(WA_PROFILE_DIR, contextOptions);
  } catch (launchErr) {
    console.warn('[WA-PLAYWRIGHT] Aviso ao abrir com Chrome do sistema. Expurgando lock e relançando...', launchErr);
    delete contextOptions.executablePath;
    context = await chromium.launchPersistentContext(WA_PROFILE_DIR, contextOptions);
  }

  const pages = context.pages();
  waPage = pages.length > 0 ? pages[0] : await context.newPage();

  // Interceptor global: fecha automaticamente qualquer janela de seleção de arquivo nativa do SO
  waPage.on('filechooser', async (fileChooser) => {
    console.log('[WA-PLAYWRIGHT] 🛡️ Interceptado FileChooser do SO no WhatsApp Web. Fechando janela nativa automaticamente...');
    await fileChooser.setFiles([]).catch(() => {});
  });

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
    const searchSelector = '#side div[contenteditable="true"], [aria-label*="Pesquisar"], [aria-placeholder*="Pesquisar"], [data-tab="3"], [title*="Pesquisar"]';
    try {
      const searchBox = await page.waitForSelector(searchSelector, { timeout: 7000 });
      if (searchBox) {
        await searchBox.click();
        await page.waitForTimeout(300);
        await searchBox.fill('').catch(() => {});
        await searchBox.type(targetSearchTerm, { delay: 100 });
        await page.waitForTimeout(2000);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
      }
    } catch {
      console.log('[WA-PLAYWRIGHT] Barra de pesquisa não alterada, prosseguindo com a conversa ativa...');
    }

    // Se tiver imagem, baixa localmente para fazer upload
    if (offer.thumbnail && offer.thumbnail.startsWith('http')) {
      const tempImgPath = join(process.cwd(), `temp_offer_${Date.now()}.jpg`);
      try {
        // Limpeza preventiva da caixa de mensagem principal do chat para não reter legendas anteriores
        try {
          const mainChatBox = page.locator('#main div[contenteditable="true"]').first();
          if ((await mainChatBox.count()) > 0) {
            await mainChatBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});
          }
        } catch { /* ignora */ }

        const response = await fetch(offer.thumbnail);
        const buffer = await response.arrayBuffer();
        writeFileSync(tempImgPath, Buffer.from(buffer));

        // 1. Clica no botão de anexar (+) se necessário para expandir os inputs do WhatsApp Web
        const attachSelector = '[aria-label*="Anexar"], [title*="Anexar"], [data-icon="plus"], [data-icon="clip"]';
        try {
          const attachBtn = page.locator(attachSelector).first();
          if (await attachBtn.isVisible({ timeout: 2500 })) {
            await attachBtn.click();
            await page.waitForTimeout(600);
          }
        } catch { /* se já estiver expandido */ }

        // 2. Injeta o arquivo diretamente no <input type="file"> do DOM via CDP (NUNCA clica no botão para NUNCA abrir a janela Explorer do Windows)
        let fileUploaded = false;
        const fileInputSelectors = [
          'input[type="file"][accept*="video"]',
          'input[type="file"][accept*="image"]',
          'input[type="file"]',
        ];

        for (const selector of fileInputSelectors) {
          try {
            const fileInput = page.locator(selector).first();
            if ((await fileInput.count()) > 0) {
              await fileInput.setInputFiles(tempImgPath);
              fileUploaded = true;
              console.log(`[WA-PLAYWRIGHT] ✅ Foto carregada via injetor direto de DOM sem abrir Explorer (${selector})!`);
              break;
            }
          } catch { /* tenta próximo */ }
        }

        if (!fileUploaded) {
          // Se o botão '+' não estava aberto, forçar expansão e injetar diretamente
          try {
            const attachBtn = page.locator(attachSelector).first();
            await attachBtn.click().catch(() => {});
            await page.waitForTimeout(500);
            const photoInput = page.locator('input[type="file"]').first();
            await photoInput.setInputFiles(tempImgPath);
            fileUploaded = true;
            console.log('[WA-PLAYWRIGHT] ✅ Foto carregada via injetor DOM (fallback)!');
          } catch (err) {
            console.warn('[WA-PLAYWRIGHT] ⚠️ Falha ao injetar foto no input:', err);
          }
        }

        await page.waitForTimeout(2000);

        // 3. Digita a legenda ESTRITAMENTE dentro do modal de pré-visualização da imagem (div[role="dialog"])
        const captionBox = page.locator('div[role="dialog"] div[contenteditable="true"]').first();

        if (await captionBox.isVisible({ timeout: 4000 })) {
          console.log(`[WA-PLAYWRIGHT] 📝 Inserindo legenda exata para: "${offer.title.substring(0, 25)}..."`);
          const titleSnippet = offer.title.substring(0, 15);
          const targetLink = offer.affiliateLink || offer.permalink || '';
          let textConfirmed = false;

          for (let attempt = 1; attempt <= 3; attempt++) {
            // Limpa o modal totalmente antes da colagem para não misturar legendas
            await captionBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});
            await captionBox.click({ force: true }).catch(() => captionBox.focus().catch(() => {}));
            await page.waitForTimeout(300);

            // Método 1: Escreve no Clipboard e cola com Control+V
            try {
              await page.evaluate((textToPaste) => {
                navigator.clipboard.writeText(textToPaste);
              }, caption);
              await page.keyboard.press('Control+v');
              await page.waitForTimeout(800);
            } catch { /* se clipboard falhar */ }

            const currentText = (await captionBox.textContent().catch(() => '')) || '';
            const hasCorrectTitle = currentText.toLowerCase().includes(titleSnippet.toLowerCase());
            const hasCorrectLink = targetLink ? currentText.includes(targetLink) : currentText.length > 80;

            if (currentText && hasCorrectTitle && hasCorrectLink) {
              textConfirmed = true;
              console.log(`[WA-PLAYWRIGHT] ✅ Legenda exata pareada com sucesso (tentativa ${attempt})!`);
              break;
            }

            // Método 2 (Fallback): execCommand insertText
            console.warn(`[WA-PLAYWRIGHT] ⚠️ Tentativa ${attempt}: legenda desalinhada. Re-inserindo via execCommand...`);
            await captionBox.focus().catch(() => {});
            await page.evaluate((textToInsert) => {
              const activeEl = document.activeElement as HTMLElement;
              if (activeEl) {
                document.execCommand('insertText', false, textToInsert);
              }
            }, caption);
            await page.waitForTimeout(800);

            const fallbackText = (await captionBox.textContent().catch(() => '')) || '';
            if (fallbackText && fallbackText.toLowerCase().includes(titleSnippet.toLowerCase())) {
              textConfirmed = true;
              console.log(`[WA-PLAYWRIGHT] ✅ Legenda validada via execCommand na tentativa ${attempt}!`);
              break;
            }
          }

          if (!textConfirmed) {
            console.warn('[WA-PLAYWRIGHT] ⚠️ Digitação direta de segurança para parear a oferta...');
            await captionBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});
            await page.keyboard.insertText(caption);
            await page.waitForTimeout(1000);
          }
        } else {
          console.warn('[WA-PLAYWRIGHT] ⚠️ Legenda do modal não localizada.');
        }

        // Clica no botão de enviar (ícone de avião/seta)
        const sendBtnSelectors = [
          'div[role="dialog"] [data-icon="send"]',
          'div[role="dialog"] [aria-label*="Enviar"]',
          'div[role="dialog"] [aria-label*="Send"]',
          '[data-icon="send"]',
          '[aria-label*="Enviar"]',
        ];

        let sentOk = false;
        for (const sel of sendBtnSelectors) {
          try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click({ force: true });
              sentOk = true;
              break;
            }
          } catch { /* próximo */ }
        }

        if (!sentOk) {
          await page.keyboard.press('Enter');
        }

        // Aguarda a destruição completa do modal de mídia antes de avançar
        try {
          await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 10000 });
        } catch { /* ignorar */ }

        // Esvazia os inputs de arquivo para não interferir na oferta subsequente
        try {
          const photoInput = page.locator('input[type="file"]').first();
          if ((await photoInput.count()) > 0) {
            await photoInput.setInputFiles([]).catch(() => {});
          }
        } catch { /* ignora */ }

        console.log(`[WA-PLAYWRIGHT] ✅ Foto + Oferta enviada no WhatsApp: "${offer.title.substring(0, 30)}..."`);
        if (existsSync(tempImgPath)) rmSync(tempImgPath);

        // Pausa de segurança de 4s para o WhatsApp registrar a mensagem isolada
        await page.waitForTimeout(4000);
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

export function checkWhatsAppSessionStatus(): { connected: boolean; profileExists: boolean } {
  const profileExists = existsSync(WA_PROFILE_DIR);
  if (!profileExists) return { connected: false, profileExists: false };
  const hasCookies = existsSync(join(WA_PROFILE_DIR, 'Default', 'Cookies')) || 
                     existsSync(join(WA_PROFILE_DIR, 'Default', 'Network', 'Cookies')) ||
                     existsSync(join(WA_PROFILE_DIR, 'Default', 'Storage'));
  return { connected: hasCookies, profileExists };
}

