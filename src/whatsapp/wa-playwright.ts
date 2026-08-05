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
    viewport: { width: 1366, height: 1080 },
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
 * Descarta incondicionalmente qualquer modal de mídia, preview de imagem ou editor travado no WhatsApp Web.
 * REGRA IMUTÁVEL: Se o modal persistir após tentativas de clique e teclas, executa page.reload() para
 * DESTRUIR incondicionalmente a janela de sobreposição e liberar a interface de chats.
 */
export async function selectWaGroupChat(page: Page, targetSearchTerm: string): Promise<boolean> {
  const target = (targetSearchTerm || '').trim();
  if (!target) return false;

  console.log(`[WA-PLAYWRIGHT] Selecionando conversa/grupo: "${target}"...`);

  // Se for um link de convite do WhatsApp (ex: https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N)
  const linkMatch = target.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/);
  if (linkMatch && linkMatch[1]) {
    const inviteCode = linkMatch[1];
    console.log(`[WA-PLAYWRIGHT] 🔗 Detectado link de convite do WhatsApp (Código: ${inviteCode}). Navegando no WhatsApp Web...`);
    try {
      await page.goto(`https://web.whatsapp.com/accept?code=${inviteCode}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);

      // Tenta clicar em botões de confirmação ("Entrar no grupo", "Conversar", "Entrar na conversa") se o modal aparecer
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
        for (const b of btns) {
          const text = (b.textContent || '').toLowerCase();
          if (text.includes('entrar') || text.includes('conversar') || text.includes('join') || text.includes('chat')) {
            (b as HTMLElement).click();
          }
        }
      }).catch(() => {});
      await page.waitForTimeout(2000);
      return true;
    } catch (linkErr) {
      console.warn('[WA-PLAYWRIGHT] Aviso ao abrir grupo por link de convite:', linkErr);
    }
  }

  // Busca padrão por nome ou JID na caixa de pesquisa do WhatsApp Web
  const searchSelector = '#side div[contenteditable="true"], [aria-label*="Pesquisar"], [aria-placeholder*="Pesquisar"], [data-tab="3"], [title*="Pesquisar"]';
  try {
    const searchBox = await page.waitForSelector(searchSelector, { timeout: 6000 });
    if (searchBox) {
      await searchBox.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      await searchBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});
      await searchBox.fill('').catch(() => {});
      await searchBox.type(target, { delay: 80 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(1500);
      return true;
    }
  } catch (err) {
    console.warn('[WA-PLAYWRIGHT] Aviso ao selecionar conversa/grupo:', err);
  }
  return false;
}

/**
 * Descarta incondicionalmente qualquer modal de mídia, preview de imagem ou editor travado no WhatsApp Web.
 * REGRA IMUTÁVEL: Se o modal persistir após tentativas de clique e teclas, executa page.reload() para
 * DESTRUIR incondicionalmente a janela de sobreposição e liberar a interface de chats.
 */
export async function forceClearAllWaModals(page: Page): Promise<void> {
  try {
    const hasModalInDom = await page.evaluate(() => {
      return !!document.querySelector('div[role="dialog"]') || !!document.querySelector('[data-animate-modal-popup="true"]');
    }).catch(() => false);

    if (!hasModalInDom) return;

    console.warn('[WA-PLAYWRIGHT] ⚠️ Modal/Editor detectado no DOM do WhatsApp Web. Executando descarte rigoroso...');

    for (let i = 0; i < 3; i++) {
      try {
        // 1. Tenta clicar no botão "Descartar" no diálogo de confirmação
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
          for (const b of buttons) {
            const txt = (b.textContent || '').toLowerCase();
            if (txt.includes('descartar') || txt.includes('discard')) {
              (b as HTMLElement).click();
            }
          }
        }).catch(() => {});
        await page.waitForTimeout(300);

        // 2. Envia 2 vezes o comando Escape para fechar popup e editor
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);

        // 3. Clica em botões com ícone de fechar (x)
        await page.evaluate(() => {
          const xIcons = Array.from(document.querySelectorAll('div[role="dialog"] [data-icon="x"], [data-icon="x"]'));
          for (const icon of xIcons) {
            const btn = (icon.closest('button, div[role="button"]') || icon) as HTMLElement;
            if (btn) btn.click();
          }
        }).catch(() => {});
        await page.waitForTimeout(300);

        const isStillInDom = await page.evaluate(() => !!document.querySelector('div[role="dialog"]')).catch(() => false);
        if (!isStillInDom) break;
      } catch {}
    }

    // REGRA DE SEGURANÇA ABSOLUTA: Se o modal ainda existir na DOM, executa page.reload() INCONDICIONALMENTE!
    const modalInDomAfter = await page.evaluate(() => !!document.querySelector('div[role="dialog"]')).catch(() => false);
    if (modalInDomAfter) {
      console.warn('[WA-PLAYWRIGHT] 🔄 Executando page.reload() incondicional para expurgar o modal travado no WhatsApp Web...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
  } catch {
    /* ignora */
  }
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
    
    // REGRA IMUTÁVEL: Limpa preventivamente qualquer modal travado antes de iniciar a busca
    await forceClearAllWaModals(page);

    const caption = formatIndividualOffer(offer);

    const targetSearchTerm = (targetGroupOrPhone && targetGroupOrPhone.trim()) ? targetGroupOrPhone.trim() : (process.env.WHATSAPP_GROUP_NAME || '');
    await selectWaGroupChat(page, targetSearchTerm);

    // SE WA_DIRECT_POST_MODE estiver ativo ou habilitado, faz o envio direto no chat principal (SEM ABRIR NENHUM MODAL DE MÍDIA)
    const useDirectPost = process.env.WA_DIRECT_POST_MODE === 'true' || process.env.WA_DISABLE_MEDIA_MODAL === 'true';

    if (!useDirectPost) {
      // 1. Prepara a URL da imagem garantindo extensão JPEG em alta resolução (NUNCA usa WEBP para não virar figurinha)
      let imageUrl = (offer.thumbnail || '').trim();
      if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
      imageUrl = imageUrl.replace(/\.webp$/i, '.jpg').replace(/-(I|V|F)\.(jpg|webp)/gi, '-O.jpg');

      if (imageUrl && imageUrl.startsWith('http') && !imageUrl.toLowerCase().endsWith('.webp')) {
        const tempImgPath = join(process.cwd(), `temp_offer_${Date.now()}.jpg`);
        try {
          // Limpeza preventiva da caixa de mensagem principal do chat
          try {
            const mainChatBox = page.locator('#main div[contenteditable="true"]').first();
            if ((await mainChatBox.count()) > 0) {
              await mainChatBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});
            }
          } catch { /* ignora */ }

          const response = await fetch(imageUrl);
          const buffer = await response.arrayBuffer();
          writeFileSync(tempImgPath, Buffer.from(buffer));

          // Expande o menu de anexar (+) se necessário
          const attachSelector = '[aria-label*="Anexar"], [title*="Anexar"], [data-icon="plus"], [data-icon="clip"]';
          try {
            const attachBtn = page.locator(attachSelector).first();
            if (await attachBtn.isVisible({ timeout: 2500 })) {
              await attachBtn.click();
              await page.waitForTimeout(600);
            }
          } catch { /* se já estiver expandido */ }

          // Injeta o arquivo JPG diretamente no <input type="file"> do DOM
          let fileUploaded = false;
          const fileInputSelectors = [
            'input[type="file"][accept*="image"]',
            'input[type="file"][accept*="video"]',
            'input[type="file"]',
          ];

          for (const selector of fileInputSelectors) {
            try {
              const fileInput = page.locator(selector).first();
              if ((await fileInput.count()) > 0) {
                await fileInput.setInputFiles(tempImgPath);
                fileUploaded = true;
                console.log(`[WA-PLAYWRIGHT] ✅ Foto JPG carregada no WhatsApp Web via injetor DOM (${selector})!`);
                break;
              }
            } catch { /* tenta próximo */ }
          }

          if (!fileUploaded) {
            try {
              const attachBtn = page.locator(attachSelector).first();
              await attachBtn.click().catch(() => {});
              await page.waitForTimeout(500);
              const photoInput = page.locator('input[type="file"]').first();
              await photoInput.setInputFiles(tempImgPath);
              fileUploaded = true;
            } catch (err) {
              console.warn('[WA-PLAYWRIGHT] ⚠️ Falha ao injetar foto no input:', err);
            }
          }

          await page.waitForTimeout(2000);

          // Digita a legenda DENTRO do modal de mídia
          const captionBox = page.locator('div[role="dialog"] div[contenteditable="true"]').first();
          let textConfirmed = false;

          if (await captionBox.isVisible({ timeout: 4000 })) {
            console.log(`[WA-PLAYWRIGHT] 📝 Inserindo legenda no modal para: "${offer.title.substring(0, 25)}..."`);
            const titleSnippet = offer.title.substring(0, 15);
            const targetLink = offer.affiliateLink || offer.permalink || '';

            for (let attempt = 1; attempt <= 3; attempt++) {
              await captionBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});
              await captionBox.click({ force: true }).catch(() => captionBox.focus().catch(() => {}));
              await page.waitForTimeout(300);

              try {
                await page.evaluate((textToPaste) => {
                  navigator.clipboard.writeText(textToPaste);
                }, caption);
                await page.keyboard.press('Control+v');
                await page.waitForTimeout(800);
              } catch { /* se clipboard falhar */ }

              const currentText = (await captionBox.textContent().catch(() => '')) || '';
              const hasCorrectTitle = currentText.toLowerCase().includes(titleSnippet.toLowerCase());
              const hasCorrectLink = targetLink ? currentText.includes(targetLink) : currentText.length > 50;

              if (currentText && (hasCorrectTitle || hasCorrectLink)) {
                textConfirmed = true;
                console.log(`[WA-PLAYWRIGHT] ✅ Legenda exata pareada com sucesso!`);
                break;
              }

              // Fallback: insertText API
              await captionBox.focus().catch(() => {});
              await page.keyboard.insertText(caption);
              await page.waitForTimeout(800);

              const fallbackText = (await captionBox.textContent().catch(() => '')) || '';
              if (fallbackText && fallbackText.length > 50) {
                textConfirmed = true;
                console.log(`[WA-PLAYWRIGHT] ✅ Legenda inserida via API insertText!`);
                break;
              }
            }
          }

          // TRAVA DE SEGURANÇA: Se a legenda NÃO foi confirmada no modal, CANCELA O MODAL para JAMAIS enviar foto isolada!
          if (!textConfirmed) {
            console.warn('[WA-PLAYWRIGHT] 🛡️ Legenda não confirmada no modal. Expurgando modal...');
            await forceClearAllWaModals(page);
            if (existsSync(tempImgPath)) rmSync(tempImgPath);
            throw new Error('Legenda não pareada no modal - acionando fallback de post padrão com preview de link.');
          }

          // Dispara envio do modal com triplo mecanismo de execução
          console.log(`[WA-PLAYWRIGHT] 🚀 Disparando envio do modal de mídia...`);

          // 1. Foca a caixa de legenda e envia a tecla Enter
          await captionBox.focus().catch(() => {});
          await page.keyboard.press('Enter').catch(() => {});
          await page.waitForTimeout(600);

          // 2. Clique via JS no container do botão verde de envio
          await page.evaluate(() => {
            const sendElements = Array.from(
              document.querySelectorAll('div[role="dialog"] [data-icon="send"], div[role="dialog"] [aria-label*="Enviar"], div[role="dialog"] [aria-label*="Send"]')
            );
            for (const el of sendElements) {
              const btn = (el.closest('button, div[role="button"], span[role="button"]') || el) as HTMLElement;
              if (btn) btn.click();
            }
          }).catch(() => {});
          await page.waitForTimeout(600);

          // 3. Clique direto via seletores Playwright no container do botão
          const sendBtnSelectors = [
            'div[role="dialog"] [data-icon="send"]',
            'div[role="dialog"] [aria-label*="Enviar"]',
            'div[role="dialog"] [aria-label*="Send"]',
            'div[role="dialog"] button:has([data-icon="send"])',
            'div[role="dialog"] div[role="button"]:has([data-icon="send"])',
            '[data-icon="send"]',
          ];

          for (const sel of sendBtnSelectors) {
            try {
              const btn = page.locator(sel).first();
              if ((await btn.count()) > 0) {
                await btn.scrollIntoViewIfNeeded().catch(() => {});
                await btn.click({ force: true }).catch(() => {});
                await btn.evaluate((el: HTMLElement) => {
                  const target = el.closest('button') || el.closest('[role="button"]') || el;
                  (target as HTMLElement).click();
                }).catch(() => {});
                break;
              }
            } catch {}
          }

          // AGUARDA O MODAL DESANEXAR COM TIMEOUT DE 4 SEGUNDOS
          let modalDetached = false;
          try {
            await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 4000 });
            modalDetached = true;
          } catch {
            modalDetached = false;
          }

          if (modalDetached) {
            if (existsSync(tempImgPath)) rmSync(tempImgPath);
            console.log(`[WA-PLAYWRIGHT] ✅ Foto JPG + Legenda enviada com sucesso: "${offer.title.substring(0, 30)}..."`);
            await page.waitForTimeout(4000);
            return true;
          }

          console.warn('[WA-PLAYWRIGHT] 🚨 ALERTA: Modal de mídia não fechou. Expurgando modal da tela...');
          await forceClearAllWaModals(page);
          if (existsSync(tempImgPath)) rmSync(tempImgPath);
        } catch (err) {
          console.error('[WA-PLAYWRIGHT] Aviso no envio com mídia modal:', (err as Error)?.message || err);
          await forceClearAllWaModals(page);
          if (existsSync(tempImgPath)) rmSync(tempImgPath);
        }
      }
    }

    // MODAL BYPASS / FALLBACK IMUTÁVEL DE SEGURANÇA: Envio direto no chat principal com texto formatado + Preview de Link!
    console.log('[WA-PLAYWRIGHT] 💬 Garantindo envio no chat principal com preview da imagem da oferta...');
    
    await forceClearAllWaModals(page);
    await selectWaGroupChat(page, targetSearchTerm);

    const messageBox = await page.waitForSelector('#main div[contenteditable="true"]', { timeout: 10000 });
    if (messageBox) {
      await messageBox.click();
      await messageBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});

      // Injeta o texto completo formatado
      await page.keyboard.insertText(caption);
      await page.waitForTimeout(2500);
      await page.keyboard.press('Enter');
      console.log(`[WA-PLAYWRIGHT] ✅ Post enviado com sucesso no WhatsApp: "${offer.title.substring(0, 30)}..."`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[WA-PLAYWRIGHT] Erro ao enviar mensagem:', error);
    if (waPage && !waPage.isClosed()) {
      await forceClearAllWaModals(waPage).catch(() => {});
    }
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

/**
 * Varre a lista de conversas do WhatsApp Web (#pane-side) e extrai os títulos de todos os grupos participados.
 */
export async function discoverWhatsAppGroupsPlaywright(page: Page): Promise<string[]> {
  try {
    console.log('[WA-PLAYWRIGHT] 🔍 Escaneando lista de conversas no WhatsApp Web para detectar grupos...');
    await forceClearAllWaModals(page);
    
    // Aguarda o container da lista de conversas carregar
    await page.waitForSelector('#pane-side', { timeout: 10000 }).catch(() => {});

    // Rola suavemente a lista para carregar mais chats
    await page.evaluate(() => {
      const pane = document.querySelector('#pane-side');
      if (pane) pane.scrollTop = pane.scrollHeight / 2;
    }).catch(() => {});
    await page.waitForTimeout(1000);

    const groupsFound: string[] = await page.evaluate(() => {
      const titles = new Set<string>();
      
      // Procura por todos os elementos de título no painel lateral
      const spanElements = Array.from(document.querySelectorAll('#pane-side span[title]'));
      for (const el of spanElements) {
        const title = (el.getAttribute('title') || el.textContent || '').trim();
        // Ignora contatos por telefone genéricos ou strings do sistema
        if (!title || title.length < 2) continue;
        if (/^\+?\d[\d\s-]{8,}$/.test(title)) continue; // ignora números de telefone individuais brutos
        
        // Verifica se o item possui ícone ou indicador de grupo no container pai
        const chatContainer = el.closest('div[role="listitem"], div[tabindex]') || el.parentElement?.parentElement?.parentElement;
        if (chatContainer) {
          const hasGroupIcon = !!chatContainer.querySelector('[data-icon="default-group"], [data-icon="avatar-group"], [data-icon="community-outline"]');
          const isGroupAria = (chatContainer.getAttribute('aria-label') || '').toLowerCase().includes('grupo');
          
          // Se tiver ícone de grupo, marca de grupo ou palavra indicativa no título
          if (hasGroupIcon || isGroupAria || /(grupo|gc|promo|oferta|achado|vip|desconto|clube|multirão)/i.test(title)) {
            titles.add(title);
          }
        }
      }
      return Array.from(titles);
    });

    console.log(`[WA-PLAYWRIGHT] 🔍 Escaneamento concluído: ${groupsFound.length} grupo(s) detectado(s).`);
    return groupsFound;
  } catch (err) {
    console.error('[WA-PLAYWRIGHT] Erro ao escanear grupos no WhatsApp Web:', err);
    return [];
  }
}



